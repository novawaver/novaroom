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
use tauri_plugin_opener::OpenerExt;

/// Marks a SQLite file as a Novaroom Vault, so opening some other database is refused.
const VAULT_APP: &str = "novaroom-vault";
/// The newest Vault this app can open. New files start at 1, and a save only raises the version
/// when the Vault needs it, so older Novaroom versions keep opening files that do not.
const VAULT_VERSION: i64 = 4;
/// Version 2 added List and Sub-table columns, whose cells hold arrays an older app cannot show.
const NESTED_KINDS: [&str; 2] = ["list", "subtable"];
/// Version 3 added List of links columns, whose cells hold row ids an older app would show as text.
const LINK_LIST_KINDS: [&str; 1] = ["links"];
/// Version 4 added Files columns, whose cells hold paths into the attachments folder.
const FILE_KINDS: [&str; 1] = ["files"];
/// Attached files are copied into this folder next to the Vault file, in a folder named after their
/// table. Cells keep paths relative to the Vault's folder, so moving the Vault together with this
/// folder keeps every attachment, and renaming a table later does not break its files.
const ATTACHMENTS_DIR: &str = "attachments";
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
    // A Sub-table's own columns are kept in its options, so they are checked too.
    let sub_kinds = |column: &VaultColumn| -> Vec<String> {
        column
            .options
            .get("columns")
            .and_then(|columns| columns.as_array())
            .map(|columns| {
                columns
                    .iter()
                    .filter_map(|sub| sub.get("kind").and_then(|kind| kind.as_str()).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    };
    let uses = |kinds: &[&str]| {
        data.tables.iter().any(|table| {
            table.columns.iter().any(|column| {
                kinds.contains(&column.kind.as_str())
                    || sub_kinds(column).iter().any(|kind| kinds.contains(&kind.as_str()))
            })
        })
    };
    let version = if uses(&FILE_KINDS) {
        "4"
    } else if uses(&LINK_LIST_KINDS) {
        "3"
    } else if uses(&NESTED_KINDS) {
        "2"
    } else {
        "1"
    };
    tx.execute(
        "INSERT INTO vault_info (key, value) VALUES ('version', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![version],
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

/// The folder a Vault keeps its attachments in.
fn attachments_dir(vault: &Path) -> Result<PathBuf, String> {
    vault
        .parent()
        .map(|folder| folder.join(ATTACHMENTS_DIR))
        .ok_or_else(|| "Could not find the Vault's folder.".to_string())
}

/// The folder name a table's attachments go in: its name, with what Windows does not allow in a
/// folder name taken out. A table without a usable name gets "Untitled".
fn table_folder(table: &str) -> String {
    let cleaned: String = table
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { ' ' } else { c })
        .collect();
    // Windows drops trailing dots and spaces from folder names, so they are left out here too.
    let mut name = cleaned.split_whitespace().collect::<Vec<_>>().join(" ").trim_end_matches('.').trim().to_string();
    if name.is_empty() || name == "." || name == ".." {
        name = "Untitled".into();
    }
    // Names Windows keeps for devices, with or without an extension, cannot be folders.
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        name.push('_');
    }
    name
}

/// Whether one part of an attachment's path is a plain name, not a way out of its folder.
fn plain_part(part: &str) -> bool {
    !part.is_empty() && part != "." && part != ".." && !part.contains(':')
}

/// A free file name in the attachments folder: the original name, or "name (2).ext" and so on.
fn free_name(dir: &Path, original: &Path) -> PathBuf {
    let stem = original.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
    let extension = original.extension().map(|extension| format!(".{}", extension.to_string_lossy())).unwrap_or_default();
    let mut candidate = dir.join(format!("{stem}{extension}"));
    let mut number = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem} ({number}){extension}"));
        number += 1;
    }
    candidate
}

/// Where an attachment a cell names is on disk: "attachments/<table>/<file>", or "attachments/<file>"
/// as the first Files columns saved them. Only plain names inside the attachments folder are
/// accepted, so a cell can never point the app at some other file on the computer.
fn attachment_path(vault: &str, file: &str) -> Result<PathBuf, String> {
    let parts: Vec<&str> = file.split(['/', '\\']).collect();
    let inside = match parts.as_slice() {
        [ATTACHMENTS_DIR, rest @ ..] if (1..=2).contains(&rest.len()) && rest.iter().all(|part| plain_part(part)) => rest,
        _ => return Err("That attachment is not in the attachments folder.".into()),
    };
    let name = inside[inside.len() - 1];
    let path = inside.iter().fold(attachments_dir(Path::new(vault))?, |path, part| path.join(part));
    if !path.is_file() {
        return Err(format!(
            "\"{name}\" was not found in the attachments folder next to the Vault file. It may have been moved, renamed or deleted."
        ));
    }
    Ok(path)
}

/// Asks which files to attach, copies them into the table's own folder inside the attachments
/// folder next to the Vault, and returns the paths the cell keeps, e.g.
/// "attachments/Documents/Passport.pdf". Files already in that folder are used where they are.
/// Returns None if the person closes the dialog.
#[tauri::command]
pub async fn vault_attach(app: tauri::AppHandle, path: String, table: String) -> Result<Option<Vec<String>>, String> {
    let picked = app.dialog().file().set_title("Attach files").blocking_pick_files();
    let Some(picked) = picked else { return Ok(None) };
    let folder = table_folder(&table);
    let dir = attachments_dir(Path::new(&path))?.join(&folder);
    std::fs::create_dir_all(&dir).map_err(|_| "Could not create the attachments folder.".to_string())?;
    let mut attached = Vec::new();
    for file in picked {
        let source = file.into_path().map_err(message)?;
        let already_there = source.parent().zip(dir.canonicalize().ok()).is_some_and(|(parent, dir)| {
            parent.canonicalize().is_ok_and(|parent| parent == dir)
        });
        let target = if already_there {
            source
        } else {
            let target = free_name(&dir, &source);
            std::fs::copy(&source, &target).map_err(|_| {
                format!("Could not copy \"{}\" into the attachments folder.", source.display())
            })?;
            target
        };
        if let Some(name) = target.file_name() {
            attached.push(format!("{ATTACHMENTS_DIR}/{folder}/{}", name.to_string_lossy()));
        }
    }
    Ok(Some(attached))
}

/// Opens an attachment in the app the computer uses for its type.
#[tauri::command]
pub async fn vault_open_attachment(app: tauri::AppHandle, path: String, file: String) -> Result<(), String> {
    let target = attachment_path(&path, &file)?;
    app.opener()
        .open_path(path_text(target), None::<&str>)
        .map_err(|_| "Could not open that file.".to_string())
}

/// Images larger than this are not previewed; they still open in their own app.
const PREVIEW_MAX_BYTES: u64 = 20 * 1024 * 1024;

/// The image type of an attachment, from its extension, or None when it is not an image.
fn image_type(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_string_lossy().to_ascii_lowercase();
    Some(match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" | "jfif" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// An image attachment as a data URL, for showing its preview.
#[tauri::command]
pub async fn vault_attachment_preview(path: String, file: String) -> Result<String, String> {
    use base64::Engine;
    let target = attachment_path(&path, &file)?;
    let mime = image_type(&target).ok_or_else(|| "That file is not an image.".to_string())?;
    let size = std::fs::metadata(&target).map_err(|_| "Could not read that file.".to_string())?.len();
    if size > PREVIEW_MAX_BYTES {
        return Err("That image is too large to preview.".into());
    }
    let bytes = std::fs::read(&target).map_err(|_| "Could not read that file.".to_string())?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Shows an attachment selected in its folder.
#[tauri::command]
pub async fn vault_reveal_attachment(app: tauri::AppHandle, path: String, file: String) -> Result<(), String> {
    let target = attachment_path(&path, &file)?;
    app.opener()
        .reveal_item_in_dir(target)
        .map_err(|_| "Could not show that file in its folder.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_folder_is_a_safe_folder_name() {
        assert_eq!(table_folder("Documents"), "Documents");
        assert_eq!(table_folder("  Bank / Cards: 2026?  "), "Bank Cards 2026");
        assert_eq!(table_folder("Notes..."), "Notes");
        assert_eq!(table_folder(""), "Untitled");
        assert_eq!(table_folder(".."), "Untitled");
        assert_eq!(table_folder("con"), "con_");
        assert_eq!(table_folder("COM1.txt"), "COM1.txt_");
        assert_eq!(table_folder("Company"), "Company");
    }

    #[test]
    fn attachments_stay_inside_their_folder() {
        let dir = std::env::temp_dir().join(format!("novaroom-vault-test-{}", std::process::id()));
        std::fs::create_dir_all(dir.join(ATTACHMENTS_DIR).join("Documents")).unwrap();
        std::fs::write(dir.join(ATTACHMENTS_DIR).join("Documents").join("a.txt"), "a").unwrap();
        std::fs::write(dir.join(ATTACHMENTS_DIR).join("b.txt"), "b").unwrap();
        let vault = path_text(dir.join("My Vault.vault"));

        assert!(attachment_path(&vault, "attachments/Documents/a.txt").is_ok());
        // Paths saved before attachments went into table folders still open.
        assert!(attachment_path(&vault, "attachments/b.txt").is_ok());
        assert!(attachment_path(&vault, "attachments/Documents/missing.txt").is_err());
        assert!(attachment_path(&vault, "attachments/../My Vault.vault").is_err());
        assert!(attachment_path(&vault, "attachments/Documents/../../x").is_err());
        assert!(attachment_path(&vault, "attachments/C:/Windows/win.ini").is_err());
        assert!(attachment_path(&vault, "other/a.txt").is_err());

        std::fs::remove_dir_all(dir).ok();
    }
}
