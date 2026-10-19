//! Vault: tables the person keeps in a SQLite file on their own computer, never in the cloud.
//!
//! The file holds the person's tables, their columns, and their rows. Each row's cells are stored as
//! JSON keyed by column id, so adding, renaming, or retyping a column never needs a schema change.
//! Settings a column type needs, such as the table a Link column points to, are kept as JSON too.
//! The app keeps edits in memory and writes the whole Vault in one transaction when the person saves.

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;

/// Marks a SQLite file as a Novaroom Vault, so opening some other database is refused.
const VAULT_APP: &str = "novaroom-vault";
/// The newest Vault this app can open. New files start at 1, and a save only raises the version
/// when the Vault needs it, so older Novaroom versions keep opening files that do not.
const VAULT_VERSION: i64 = 2;
/// Version 2 added List and Sub-table columns, whose cells hold arrays an older app cannot show.
const NESTED_KINDS: [&str; 2] = ["list", "subtable"];
const VAULT_EXTENSION: &str = "vault";

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS vault_info (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS vault_tables (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS vault_columns (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES vault_tables(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  position INTEGER NOT NULL,
  options TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS vault_rows (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES vault_tables(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  cells TEXT NOT NULL
);
";

#[derive(Serialize, Deserialize)]
pub struct VaultColumn {
    id: String,
    name: String,
    kind: String,
    /// Any other settings the app gives a column (e.g. `target` for Link), saved as they come.
    #[serde(flatten)]
    options: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize)]
pub struct VaultRow {
    id: String,
    cells: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize)]
pub struct VaultTable {
    id: String,
    name: String,
    /// Groups tables in the sidebar; empty when the table has no category.
    #[serde(default)]
    category: String,
    columns: Vec<VaultColumn>,
    rows: Vec<VaultRow>,
}

#[derive(Serialize, Deserialize)]
pub struct VaultData {
    tables: Vec<VaultTable>,
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// Opens an existing Vault file for reading and writing. Never creates a file, so a Vault that was
/// moved or deleted since it was opened is reported instead of silently recreated empty.
fn connect(path: &Path) -> Result<Connection, String> {
    if !path.is_file() {
        return Err("The Vault file was not found. It may have been moved or deleted.".into());
    }
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "Could not open that file.".to_string())?;
    let app: Option<String> = connection
        .query_row("SELECT value FROM vault_info WHERE key = 'app'", [], |row| row.get(0))
        .ok();
    if app.as_deref() != Some(VAULT_APP) {
        return Err("That file is not a Novaroom Vault.".into());
    }
    let version: i64 = connection
        .query_row("SELECT value FROM vault_info WHERE key = 'version'", [], |row| {
            row.get::<_, String>(0)
        })
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    if version > VAULT_VERSION {
        return Err("This Vault was saved by a newer Novaroom. Update the app to open it.".into());
    }
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(message)?;
    upgrade(&connection)?;
    Ok(connection)
}

/// Brings a Vault made by an earlier Novaroom up to date. Older apps still open the result.
fn upgrade(connection: &Connection) -> Result<(), String> {
    let has_options = connection
        .prepare("SELECT 1 FROM pragma_table_info('vault_columns') WHERE name = 'options'")
        .and_then(|mut statement| statement.exists([]))
        .map_err(message)?;
    if !has_options {
        connection
            .execute_batch("ALTER TABLE vault_columns ADD COLUMN options TEXT NOT NULL DEFAULT '{}';")
            .map_err(message)?;
    }
    let has_category = connection
        .prepare("SELECT 1 FROM pragma_table_info('vault_tables') WHERE name = 'category'")
        .and_then(|mut statement| statement.exists([]))
        .map_err(message)?;
    if !has_category {
        connection
            .execute_batch("ALTER TABLE vault_tables ADD COLUMN category TEXT NOT NULL DEFAULT '';")
            .map_err(message)?;
    }
    Ok(())
}

fn create(path: &Path) -> Result<(), String> {
    // The save dialog already asked before replacing an existing file.
    if path.exists() {
        std::fs::remove_file(path).map_err(|_| "Could not replace that file.".to_string())?;
    }
    let connection = Connection::open(path).map_err(|_| "Could not create the Vault file.".to_string())?;
    connection.execute_batch(SCHEMA).map_err(message)?;
    connection
        .execute(
            "INSERT INTO vault_info (key, value) VALUES ('app', ?1), ('version', ?2)",
            params![VAULT_APP, "1"],
        )
        .map_err(message)?;
    Ok(())
}

fn read(connection: &Connection) -> Result<VaultData, String> {
    let mut tables: Vec<VaultTable> = connection
        .prepare("SELECT id, name, category FROM vault_tables ORDER BY position")
        .map_err(message)?
        .query_map([], |row| {
            Ok(VaultTable {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                columns: Vec::new(),
                rows: Vec::new(),
            })
        })
        .map_err(message)?
        .collect::<Result<_, _>>()
        .map_err(message)?;

    let mut columns = connection
        .prepare("SELECT id, name, kind, options FROM vault_columns WHERE table_id = ?1 ORDER BY position")
        .map_err(message)?;
    let mut rows = connection
        .prepare("SELECT id, cells FROM vault_rows WHERE table_id = ?1 ORDER BY position")
        .map_err(message)?;
    for table in &mut tables {
        table.columns = columns
            .query_map([&table.id], |row| {
                let options: String = row.get(3)?;
                Ok(VaultColumn {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    kind: row.get(2)?,
                    options: serde_json::from_str(&options).unwrap_or_default(),
                })
            })
            .map_err(message)?
            .collect::<Result<_, _>>()
            .map_err(message)?;
        table.rows = rows
            .query_map([&table.id], |row| {
                let cells: String = row.get(1)?;
                Ok(VaultRow {
                    id: row.get(0)?,
                    cells: serde_json::from_str(&cells).unwrap_or_default(),
                })
            })
            .map_err(message)?
            .collect::<Result<_, _>>()
            .map_err(message)?;
    }
    Ok(VaultData { tables })
}

fn write(connection: &mut Connection, data: &VaultData) -> Result<(), String> {
    // One transaction: if anything fails, the file keeps its last saved state.
    let tx = connection.transaction().map_err(message)?;
    tx.execute_batch("DELETE FROM vault_rows; DELETE FROM vault_columns; DELETE FROM vault_tables;")
        .map_err(message)?;
    {
        let mut insert_table = tx
            .prepare("INSERT INTO vault_tables (id, name, position, category) VALUES (?1, ?2, ?3, ?4)")
            .map_err(message)?;
        let mut insert_column = tx
            .prepare(
                "INSERT INTO vault_columns (id, table_id, name, kind, position, options) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .map_err(message)?;
        let mut insert_row = tx
            .prepare("INSERT INTO vault_rows (id, table_id, position, cells) VALUES (?1, ?2, ?3, ?4)")
            .map_err(message)?;
        for (table_position, table) in data.tables.iter().enumerate() {
            insert_table
                .execute(params![table.id, table.name, table_position as i64, table.category.trim()])
                .map_err(message)?;
            for (position, column) in table.columns.iter().enumerate() {
                let options = serde_json::to_string(&column.options).map_err(message)?;
                insert_column
                    .execute(params![column.id, table.id, column.name, column.kind, position as i64, options])
                    .map_err(message)?;
            }
            for (position, row) in table.rows.iter().enumerate() {
                let cells = serde_json::to_string(&row.cells).map_err(message)?;
                insert_row
                    .execute(params![row.id, table.id, position as i64, cells])
                    .map_err(message)?;
            }
        }
    }
    let nested = data
        .tables
        .iter()
        .any(|table| table.columns.iter().any(|column| NESTED_KINDS.contains(&column.kind.as_str())));
    tx.execute(
        "INSERT INTO vault_info (key, value) VALUES ('version', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![if nested { "2" } else { "1" }],
    )
    .map_err(message)?;
    tx.commit().map_err(message)
}

fn path_text(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

/// Asks where to keep a new Vault, creates it there, and returns its path.
/// Returns None if the person closes the dialog.
#[tauri::command]
pub async fn vault_create(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Create a Vault file")
        .set_file_name("My Vault.vault")
        .add_filter("Novaroom Vault", &[VAULT_EXTENSION])
        .blocking_save_file();
    let Some(picked) = picked else { return Ok(None) };
    let mut path = picked.into_path().map_err(message)?;
    if path.extension().is_none() {
        path.set_extension(VAULT_EXTENSION);
    }
    create(&path)?;
    Ok(Some(path_text(path)))
}

/// Asks which existing Vault to open and returns its path, after checking it is a Vault.
/// Returns None if the person closes the dialog.
#[tauri::command]
pub async fn vault_pick(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Open a Vault file")
        .add_filter("Novaroom Vault", &[VAULT_EXTENSION])
        .blocking_pick_file();
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(message)?;
    connect(&path)?;
    Ok(Some(path_text(path)))
}

#[tauri::command]
pub async fn vault_read(path: String) -> Result<VaultData, String> {
    read(&connect(Path::new(&path))?)
}

#[tauri::command]
pub async fn vault_write(path: String, data: VaultData) -> Result<(), String> {
    write(&mut connect(Path::new(&path))?, &data)
}
