import { inTauri } from "./desktop"

// Vault keeps tables in a file on this computer; nothing here touches the cloud.

export type VaultColumnKind =
  | "text"
  | "notes"
  | "number"
  | "date"
  | "checkbox"
  | "email"
  | "url"
  | "password"
  | "link"
  | "list"
  | "links"
  | "subtable"
  | "files"

export const VAULT_COLUMN_KINDS: Array<{ id: VaultColumnKind; label: string }> = [
  { id: "text", label: "Text" },
  { id: "notes", label: "Notes" },
  { id: "number", label: "Number" },
  { id: "date", label: "Date" },
  { id: "checkbox", label: "Yes / no" },
  { id: "email", label: "Email" },
  { id: "url", label: "URL" },
  { id: "password", label: "Password" },
  { id: "link", label: "Link" },
  { id: "list", label: "List" },
  { id: "links", label: "List of links" },
  { id: "subtable", label: "Sub-table" },
  { id: "files", label: "Files" },
]

/** Kinds a Sub-table's own columns can have: no Links and no Sub-tables inside Sub-tables. */
export type VaultSubKind = Exclude<VaultColumnKind, "link" | "links" | "subtable">

export const VAULT_SUB_KINDS = VAULT_COLUMN_KINDS.filter(
  (kind): kind is { id: VaultSubKind; label: string } =>
    kind.id !== "link" && kind.id !== "links" && kind.id !== "subtable",
)

/** Whether a column's cells point at rows of another table: one row (Link) or several (List of links). */
export function linksRows(kind: VaultColumnKind): kind is "link" | "links" {
  return kind === "link" || kind === "links"
}

// List cells hold their lines, List of links cells the ids of the rows they point to, Files cells
// the paths of their attachments (e.g. "attachments/Documents/Passport.pdf"), and Sub-table cells their own rows.
export type VaultCell = string | number | boolean | null | string[] | VaultRow[]

export type VaultColumn = {
  id: string
  name: string
  kind: VaultColumnKind
  // Link and List of links columns: the table whose rows the cells point to. A Link cell holds one
  // row id from it, a List of links cell several.
  target?: string
  // Sub-table columns: the columns of the small table inside each cell.
  columns?: VaultColumn[]
  // Files columns: false to list image attachments by name only, without their preview.
  preview?: boolean
}

/** Whether a Files column shows previews of its images. On unless turned off. */
export function showsPreview(column: VaultColumn) {
  return column.kind === "files" && column.preview !== false
}
export type VaultRow = { id: string; cells: Record<string, VaultCell> }
export type VaultTable = {
  id: string
  name: string
  // Groups tables in the sidebar; empty when the table has no category.
  category: string
  columns: VaultColumn[]
  rows: VaultRow[]
}
export type VaultData = { tables: VaultTable[] }

export const vaultAvailable = inTauri

async function call<T>(command: string, args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core")
  try {
    return await invoke<T>(command, args)
  } catch (caught) {
    throw new Error(typeof caught === "string" ? caught : "Something went wrong with the Vault file.")
  }
}

/** Asks where to keep a new Vault file and creates it. Null if the person cancels. */
export const createVaultFile = () => call<string | null>("vault_create")

/** Asks which Vault file to open. Null if the person cancels. */
export const pickVaultFile = () => call<string | null>("vault_pick")

export const readVault = (path: string) => call<VaultData>("vault_read", { path })

export const writeVault = (path: string, data: VaultData) => call<void>("vault_write", { path, data })

/**
 * Asks which files to attach and copies them into the table's folder inside the attachments folder
 * next to the Vault file. Returns the paths a Files cell keeps, or null if the person cancels.
 */
export const attachVaultFiles = (path: string, table: string) =>
  call<string[] | null>("vault_attach", { path, table })

/** Opens an attachment in the app the computer uses for its type. */
export const openVaultAttachment = (path: string, file: string) => call<void>("vault_open_attachment", { path, file })

/** Shows an attachment selected in its folder. */
export const revealVaultAttachment = (path: string, file: string) =>
  call<void>("vault_reveal_attachment", { path, file })

/** Whether an attachment is an image that can be previewed, judged by its extension. */
export function isImageAttachment(file: string) {
  return /\.(png|jpe?g|jfif|gif|webp|bmp|avif|ico|svg)$/i.test(file)
}

// Previews already loaded, or loading, by Vault file and attachment, so each image is read once.
const previews = new Map<string, Promise<string>>()

/** An image attachment as a data URL for its preview. A failed load is tried again next time. */
export function vaultAttachmentPreview(path: string, file: string) {
  const key = `${path}\n${file}`
  let preview = previews.get(key)
  if (!preview) {
    preview = call<string>("vault_attachment_preview", { path, file })
    preview.catch(() => previews.delete(key))
    previews.set(key, preview)
  }
  return preview
}

// The last Vault file each person used on this computer, so the page reopens it.
const fileKey = (userId: string) => `novaroom.vault-file.${userId}`

export function rememberedVaultFile(userId: string) {
  try {
    return localStorage.getItem(fileKey(userId))
  } catch {
    return null
  }
}

export function rememberVaultFile(userId: string, path: string | null) {
  try {
    if (path) localStorage.setItem(fileKey(userId), path)
    else localStorage.removeItem(fileKey(userId))
  } catch {
    // Not remembered; the person picks the file again next time.
  }
}

export function newTable(name: string, category = ""): VaultTable {
  const nameColumn: VaultColumn = { id: crypto.randomUUID(), name: "Name", kind: "text" }
  return { id: crypto.randomUUID(), name, category, columns: [nameColumn], rows: [] }
}

/** A table's category as grouped: trimmed, and the same whatever its capitals. */
function categoryKey(table: VaultTable) {
  return (table.category ?? "").trim().toLowerCase()
}

/**
 * Tables grouped by category for the sidebar. Tables without a category come first, then each
 * category in alphabetical order. Tables keep their own order inside a group.
 */
export function groupTables(tables: VaultTable[]): Array<{ category: string; tables: VaultTable[] }> {
  const groups = new Map<string, { category: string; tables: VaultTable[] }>()
  for (const table of tables) {
    const key = categoryKey(table)
    const group = groups.get(key) ?? { category: (table.category ?? "").trim(), tables: [] }
    group.tables.push(table)
    groups.set(key, group)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))
    .map(([, group]) => group)
}

/** Every category used in a Vault, for suggesting them when typing one. */
export function vaultCategories(tables: VaultTable[]) {
  return groupTables(tables)
    .map((group) => group.category)
    .filter(Boolean)
}

/** A spreadsheet cell as read for importing: text, a number, yes/no, or nothing. */
type ImportedCell = string | number | boolean | null
export type ImportedBook = { name: string; sheets: Array<{ name: string; rows: ImportedCell[][] }> }

/**
 * Asks which Excel file to import and reads its sheets. Null if the person cancels. Nothing is
 * added to the Vault yet; see importedTables.
 */
export const pickExcelFile = () => call<ImportedBook | null>("vault_import_excel")

/** The column type that fits every value of an imported column. Text when they are mixed. */
function importedKind(values: ImportedCell[]): VaultColumnKind {
  const filled = values.filter((value) => value !== null)
  if (filled.length === 0) return "text"
  if (filled.every((value) => typeof value === "boolean")) return "checkbox"
  if (filled.every((value) => typeof value === "number")) return "number"
  const texts = filled.filter((value): value is string => typeof value === "string")
  if (texts.length < filled.length) return "text"
  if (texts.every((text) => /^\d{4}-\d{2}-\d{2}$/.test(text))) return "date"
  if (texts.every(looksLikeEmail)) return "email"
  if (texts.every((text) => /^https?:\/\/\S+$/i.test(text))) return "url"
  if (texts.some((text) => text.includes("\n"))) return "notes"
  return "text"
}

/**
 * The tables an imported spreadsheet becomes: one per sheet that holds anything. A sheet's first
 * row gives the column names and every row under it becomes a row. Each column gets the type that
 * fits all its values (Number, Date, Yes / no, Email, URL, Notes), or Text.
 */
export function importedTables(book: ImportedBook, category = ""): VaultTable[] {
  const sheets = book.sheets.filter((sheet) => sheet.rows.length > 0)
  return sheets.map((sheet) => {
    const [header, ...body] = sheet.rows
    const width = Math.max(...sheet.rows.map((row) => row.length))
    const columns: VaultColumn[] = Array.from({ length: width }, (_, index) => {
      const title = header[index]
      const name = title === null || title === undefined ? "" : String(title).trim()
      return {
        id: crypto.randomUUID(),
        name: name || `Column ${index + 1}`,
        kind: importedKind(body.map((row) => row[index] ?? null)),
      }
    })
    const rows: VaultRow[] = body.map((row) => {
      const cells: Record<string, VaultCell> = {}
      columns.forEach((column, index) => {
        const value = row[index] ?? null
        if (value !== null) cells[column.id] = convertCell(value, column.kind)
      })
      return { id: crypto.randomUUID(), cells }
    })
    // A file with one sheet is named after the file, since the sheet is usually just "Sheet1".
    const name = (sheets.length === 1 ? book.name : sheet.name).trim() || "Imported table"
    return { id: crypto.randomUUID(), name, category, columns, rows }
  })
}

/** Anything a JSON file can hold. */
type Json = null | string | number | boolean | Json[] | { [key: string]: Json }
type JsonRecord = { [key: string]: Json }
export type ImportedJson = { name: string; value: Json }

/**
 * Asks which JSON file to import and reads it. Null if the person cancels. Nothing is added to the
 * Vault yet; see importedJsonTables.
 */
export const pickJsonFile = () => call<ImportedJson | null>("vault_import_json")

function isRecord(value: Json | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A record with the records inside it folded in, e.g. { address: { city } } gives "address.city". */
function flattenRecord(record: JsonRecord, prefix = "", out: JsonRecord = {}): JsonRecord {
  for (const [key, value] of Object.entries(record)) {
    const name = prefix ? `${prefix}.${key}` : key
    if (isRecord(value) && Object.keys(value).length > 0) flattenRecord(value, name, out)
    else out[name] = isRecord(value) ? null : value
  }
  return out
}

/** A JSON value as one cell: lists and records that have no column type of their own stay as JSON text. */
function jsonCell(value: Json): ImportedCell {
  if (value === null) return null
  if (typeof value === "object") return JSON.stringify(value)
  if (typeof value === "string") return value.trim() === "" ? null : value
  return value
}

/**
 * Columns and rows for a list of records: one column per key, in the order the keys first appear.
 * A key holding lists becomes a List column, or a Sub-table when the lists hold records (only when
 * `nested`, since a Sub-table cannot hold another).
 */
function tableFromRecords(records: JsonRecord[], nested: boolean): Pick<VaultTable, "columns" | "rows"> {
  const flat = records.map((record) => flattenRecord(record))
  const names = [...new Set(flat.flatMap((record) => Object.keys(record)))]
  const rows = flat.map(() => newRow())
  const columns = names.map((name): VaultColumn => {
    const id = crypto.randomUUID()
    const values = flat.map((record) => record[name] ?? null)
    const put = (index: number, cell: VaultCell) => {
      if (cell !== null) rows[index].cells[id] = cell
    }
    const lists = values.filter((value): value is Json[] => Array.isArray(value))
    const filled = values.filter((value) => value !== null)
    if (lists.length > 0 && lists.length === filled.length) {
      const items = lists.flat()
      if (nested && items.length > 0 && items.every(isRecord)) {
        // One set of columns for the items of every row, then each row takes its own items back.
        const inner = tableFromRecords(items, false)
        let next = 0
        values.forEach((value, index) => {
          if (!Array.isArray(value) || value.length === 0) return
          put(index, inner.rows.slice(next, next + value.length))
          next += value.length
        })
        return { id, name, kind: "subtable", columns: inner.columns }
      }
      values.forEach((value, index) => {
        if (!Array.isArray(value)) return
        put(index, convertCell(value.map((item) => String(jsonCell(item) ?? "")), "list"))
      })
      return { id, name, kind: "list" }
    }
    const cells = values.map(jsonCell)
    const kind = importedKind(cells)
    cells.forEach((cell, index) => put(index, cell === null ? null : convertCell(cell, kind)))
    return { id, name, kind }
  })
  return { columns, rows }
}

/**
 * A JSON list as records: a list of records as it is, a list of lists with its first list as the
 * column names (like a sheet), and a list of plain values as one "Value" column. Null for anything else.
 */
function jsonRecords(value: Json | undefined): JsonRecord[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  if (value.every(isRecord)) return value
  if (value.every((item): item is Json[] => Array.isArray(item))) {
    const [header, ...body] = value
    const width = Math.max(...value.map((row) => row.length))
    const names: string[] = []
    for (let index = 0; index < width; index++) {
      const title = String(jsonCell(header[index] ?? null) ?? "").trim() || `Column ${index + 1}`
      names.push(names.includes(title) ? `${title} (${index + 1})` : title)
    }
    return body.map((row) => Object.fromEntries(names.map((name, index) => [name, row[index] ?? null])))
  }
  return value.map((item) => (isRecord(item) ? item : { Value: item }))
}

/**
 * The tables a JSON file becomes. A list of records is one table named after the file, with a
 * column per key. A record holding such lists, e.g. { "people": [...], "orders": [...] }, gives a
 * table per list, named by its key. A record of records gives a row per key, and any other record
 * a single row. Records inside records become columns like "address.city"; lists inside a record
 * become a List column, or a Sub-table when they hold records.
 */
export function importedJsonTables(file: ImportedJson, category = ""): VaultTable[] {
  const make = (name: string, records: JsonRecord[]): VaultTable[] => {
    const { columns, rows } = tableFromRecords(records, true)
    if (columns.length === 0) return []
    return [{ id: crypto.randomUUID(), name: name.trim() || "Imported table", category, columns, rows }]
  }
  const whole = jsonRecords(file.value)
  if (whole) return make(file.name, whole)
  if (!isRecord(file.value)) return []
  const entries = Object.entries(file.value)
  const parts = entries.flatMap(([key, inner]) => {
    const holdsRecords = Array.isArray(inner) && inner.some((item) => typeof item === "object" && item !== null)
    const records = holdsRecords ? jsonRecords(inner) : null
    return records ? make(key, records) : []
  })
  if (parts.length > 0) return parts
  if (entries.length > 0 && entries.every(([, inner]) => isRecord(inner))) {
    return make(
      file.name,
      entries.map(([key, inner]) => ({ Key: key, ...(inner as JsonRecord) })),
    )
  }
  return make(file.name, [file.value])
}

// Merging ---------------------------------------------------------------------

const columnNameKey = (column: VaultColumn) => column.name.trim().toLowerCase()

/**
 * Pairs each column of `from` with a column of `into` that has the same name (whatever its capitals)
 * and type, and passes `same`. A column of `into` is paired once; the rest of `from` is `added`.
 */
function matchColumns(into: VaultColumn[], from: VaultColumn[], same: (a: VaultColumn, b: VaultColumn) => boolean) {
  const taken = new Set<string>()
  const shared: Array<{ into: VaultColumn; from: VaultColumn }> = []
  const added: VaultColumn[] = []
  for (const column of from) {
    const match = into.find(
      (item) =>
        !taken.has(item.id) &&
        columnNameKey(item) === columnNameKey(column) &&
        item.kind === column.kind &&
        same(item, column),
    )
    if (match) {
      taken.add(match.id)
      shared.push({ into: match, from: column })
    } else added.push(column)
  }
  return { shared, added }
}

/**
 * What merging `from` into `into` does to the columns: `shared` ones have the same name and type
 * (and, for Links, point to the same table) and are combined; `added` ones become new columns.
 */
export function mergePlan(into: VaultTable, from: VaultTable) {
  // Once merged, links to either table point to the merged one.
  const target = (column: VaultColumn) => (column.target === from.id ? into.id : column.target)
  return matchColumns(into.columns, from.columns, (a, b) => !linksRows(a.kind) || target(a) === target(b))
}

/**
 * Merges one table into another: the rows of `from` go under the rows of `into`, with columns
 * combined as mergePlan says, and `from` is removed. Rows keep their ids and links to `from` are
 * pointed at `into`, so links to the moved rows keep working.
 */
export function mergeTables(tables: VaultTable[], intoId: string, fromId: string): VaultTable[] {
  const into = tables.find((table) => table.id === intoId)
  const from = tables.find((table) => table.id === fromId)
  if (!into || !from || into === from) return tables
  const { shared, added } = mergePlan(into, from)
  // Where each column of `from` goes: its id there, to its id in the merged table.
  const ids = new Map<string, string>()
  for (const column of added) {
    ids.set(column.id, into.columns.some((item) => item.id === column.id) ? crypto.randomUUID() : column.id)
  }
  // Shared Sub-tables combine their own columns the same way.
  const subIds = new Map<string, Map<string, string>>()
  const subColumns = new Map<string, VaultColumn[]>()
  for (const pair of shared) {
    ids.set(pair.from.id, pair.into.id)
    if (pair.into.kind !== "subtable") continue
    const inner = matchColumns(pair.into.columns ?? [], pair.from.columns ?? [], () => true)
    subColumns.set(pair.into.id, [...(pair.into.columns ?? []), ...inner.added])
    subIds.set(
      pair.from.id,
      new Map([
        ...inner.shared.map((item) => [item.from.id, item.into.id] as const),
        ...inner.added.map((item) => [item.id, item.id] as const),
      ]),
    )
  }
  const rekey = (cells: Record<string, VaultCell>, map: Map<string, string>) =>
    Object.fromEntries(
      Object.entries(cells).flatMap(([id, value]) => {
        const to = map.get(id)
        return to ? [[to, value] as const] : []
      }),
    )
  const moved = from.rows.map((row): VaultRow => {
    const cells: Record<string, VaultCell> = {}
    for (const [id, value] of Object.entries(row.cells)) {
      const to = ids.get(id)
      if (!to) continue
      const inner = subIds.get(id)
      if (!inner) cells[to] = value
      else {
        const items = subRows(value).map((item) => ({ ...item, cells: rekey(item.cells, inner) }))
        cells[to] = items.length > 0 ? items : null
      }
    }
    return { ...row, cells }
  })
  const merged: VaultTable = {
    ...into,
    columns: [
      ...into.columns.map((column) =>
        subColumns.has(column.id) ? { ...column, columns: subColumns.get(column.id) } : column,
      ),
      ...added.map((column) => ({ ...column, id: ids.get(column.id) ?? column.id })),
    ],
    rows: [...into.rows, ...moved],
  }
  return tables
    .filter((table) => table.id !== fromId)
    .map((table) => {
      const next = table.id === intoId ? merged : table
      if (!next.columns.some((column) => column.target === fromId)) return next
      return {
        ...next,
        columns: next.columns.map((column) => (column.target === fromId ? { ...column, target: intoId } : column)),
      }
    })
}

export function newColumn(name: string): VaultColumn {
  return { id: crypto.randomUUID(), name, kind: "text" }
}

/** The lines of a List cell, or none for any other value. */
export function listItems(value: VaultCell | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

/** The rows inside a Sub-table cell, or none for any other value. */
export function subRows(value: VaultCell | undefined): VaultRow[] {
  return Array.isArray(value)
    ? value.filter((item): item is VaultRow => typeof item === "object" && item !== null && "cells" in item)
    : []
}

export function newRow(): VaultRow {
  return { id: crypto.randomUUID(), cells: {} }
}

/** Converts a cell to fit a column's new type, keeping what can be kept. */
export function convertCell(value: VaultCell, kind: VaultColumnKind): VaultCell {
  if (value === null || value === "") return null
  // Sub-table rows only fit a Sub-table; nothing else can become one.
  if (kind === "subtable" || (Array.isArray(value) && subRows(value).length > 0)) return null
  // Row ids only mean something to a Link column, so other values cannot become links, and only
  // attached files belong in a Files column.
  if (linksRows(kind) || kind === "files") return null
  if (kind === "list") {
    const text = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)
    const lines = Array.isArray(value) ? listItems(value) : text.split(/\r?\n/)
    const kept = lines.map((line) => line.trim()).filter(Boolean)
    return kept.length > 0 ? kept : null
  }
  // A List becomes its lines on separate lines of text, then converts like text.
  if (Array.isArray(value)) {
    const text = listItems(value).join("\n")
    return text ? convertCell(text, kind) : null
  }
  switch (kind) {
    case "text":
    case "notes":
    case "email":
    case "url":
    case "password":
      return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)
    case "number": {
      const number = typeof value === "number" ? value : Number(value)
      return Number.isFinite(number) && typeof value !== "boolean" ? number : null
    }
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
    case "checkbox":
      return typeof value === "boolean" ? value : /^(yes|true|1)$/i.test(String(value).trim())
  }
}

/** A short file name for display, e.g. "My Vault.vault". */
export function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path
}

/** What an attachment is called: its file name without the folder, e.g. "Passport.pdf". */
export function attachmentName(file: string) {
  return fileName(file)
}

/** The text a search matches a cell against. Passwords are never matched. */
export function cellText(value: VaultCell, kind: VaultColumnKind, linkLabel?: (rowId: string) => string) {
  if (value === null || value === undefined || kind === "password") return ""
  if (kind === "checkbox") return value === true ? "yes" : "no"
  if (kind === "link") return linkLabel && typeof value === "string" ? linkLabel(value) : ""
  if (kind === "links") return linkLabel ? listItems(value).map(linkLabel).join(" ") : ""
  if (kind === "list") return listItems(value).join(" ")
  if (kind === "files") return listItems(value).map(attachmentName).join(" ")
  if (kind === "subtable") return ""
  return String(value)
}

/** The text a search matches a Sub-table cell against: every value inside it except passwords. */
export function subTableText(value: VaultCell, columns: VaultColumn[]) {
  return subRows(value)
    .flatMap((row) => columns.map((column) => cellText(row.cells[column.id] ?? null, column.kind)))
    .filter(Boolean)
    .join(" ")
}

/** Kinds whose value can name a row in a Link, in the order they are tried. */
const LABEL_KINDS: VaultColumnKind[] = ["text", "email", "number", "date"]

/**
 * What a Link shows for a row: its first text-like cell that has a value, e.g. a name.
 * Falls back to the row's position, so a row with no such cell can still be told apart.
 */
export function rowLabel(table: VaultTable, rowId: string) {
  const index = table.rows.findIndex((row) => row.id === rowId)
  return index === -1 ? null : labelOfRow(table, table.rows[index], index)
}

function labelOfRow(table: VaultTable, row: VaultRow, index: number) {
  for (const column of table.columns) {
    if (!LABEL_KINDS.includes(column.kind)) continue
    const value = row.cells[column.id]
    if (value !== null && value !== undefined && value !== "" && !Array.isArray(value)) return String(value)
  }
  return `Row ${index + 1}`
}

/** One place a search of the whole Vault matched: a table's name, a cell, or a value inside a Sub-table cell. */
export type VaultHit = {
  tableId: string
  tableName: string
  // Null when the table's own name matched.
  rowId: string | null
  /** What the row is called, as a Link to it would show. */
  row: string
  /** Where in the row: the column, and for a Sub-table the item and its column. */
  where: string
  /** The whole matching value. */
  text: string
}

/**
 * Searches every table of a Vault, including the items inside Sub-table cells. Passwords are never
 * matched, and Yes / no columns are left out, since "no" would match every unticked box.
 * Stops at `limit` matches; `more` says there were others.
 */
export function searchVault(tables: VaultTable[], query: string, limit = 200) {
  const search = query.trim().toLowerCase()
  const hits: VaultHit[] = []
  let more = false
  if (!search) return { hits, more }
  // What Links show, by table, worked out once per table that a matching column points to.
  const labels = new Map<string, Map<string, string>>()
  const labelsOf = (tableId: string | undefined) => {
    const target = tables.find((item) => item.id === tableId)
    if (!target) return null
    let known = labels.get(target.id)
    if (!known) {
      known = new Map(target.rows.map((row, index) => [row.id, labelOfRow(target, row, index)]))
      labels.set(target.id, known)
    }
    return known
  }
  const add = (hit: VaultHit) => {
    if (hits.length >= limit) {
      more = true
      return false
    }
    hits.push(hit)
    return true
  }
  const matches = (text: string) => text.toLowerCase().includes(search)

  scan: for (const table of tables) {
    const tableName = table.name || "Untitled"
    const base = { tableId: table.id, tableName }
    if (matches(tableName) && !add({ ...base, rowId: null, row: "", where: "Table name", text: tableName })) break
    for (let index = 0; index < table.rows.length; index++) {
      const row = table.rows[index]
      let label: string | null = null
      const hit = (where: string, text: string): VaultHit => ({
        ...base,
        rowId: row.id,
        row: (label ??= labelOfRow(table, row, index)),
        where,
        text,
      })
      for (const column of table.columns) {
        if (column.kind === "checkbox") continue
        const value = row.cells[column.id] ?? null
        const name = column.name || "Untitled"
        if (column.kind === "subtable") {
          const items = subRows(value)
          for (let item = 0; item < items.length; item++) {
            for (const sub of column.columns ?? []) {
              if (sub.kind === "checkbox") continue
              const text = cellText(items[item].cells[sub.id] ?? null, sub.kind)
              if (matches(text) && !add(hit(`${name} \u203a item ${item + 1} \u203a ${sub.name || "Untitled"}`, text))) {
                break scan
              }
            }
          }
          continue
        }
        const linked = linksRows(column.kind) ? labelsOf(column.target) : null
        const text = cellText(value, column.kind, linked ? (rowId) => linked.get(rowId) ?? "" : undefined)
        if (matches(text) && !add(hit(name, text))) break scan
      }
    }
  }
  return { hits, more }
}

/**
 * The web address a URL cell opens, or null when it is not one. A missing "https://" is added, so
 * "example.com" works; only http and https addresses are opened.
 */
export function webAddress(value: string): string | null {
  const text = value.trim()
  if (!text || /\s/.test(text)) return null
  // Only "scheme://" counts as already having one, so "example.com:8080" still gets https://.
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    // A bare word like "notes" is not an address; real hosts have a dot (or are localhost).
    if (!url.hostname.includes(".") && url.hostname !== "localhost") return null
    return url.href
  } catch {
    return null
  }
}

export function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export type SortDirection = "asc" | "desc"

/** Orders rows by one column. Empty cells always go last, whichever way the column is sorted. */
export function sortRows(
  rows: VaultRow[],
  column: VaultColumn,
  direction: SortDirection,
  linkLabel?: (rowId: string) => string,
) {
  const sign = direction === "asc" ? 1 : -1
  const empty = (value: VaultCell | undefined) => value === null || value === undefined || value === ""
  return [...rows].sort((a, b) => {
    // Links sort by the name they show, not by the row id behind them.
    // Lists sort by their first line and Sub-tables by how many rows they hold.
    const shown = (value: VaultCell | undefined): VaultCell | undefined =>
      column.kind === "link" && typeof value === "string"
        ? (linkLabel?.(value) ?? "")
        : column.kind === "links"
          ? (listItems(value).map((id) => linkLabel?.(id) ?? "")[0] ?? null)
          : column.kind === "list"
            ? (listItems(value)[0] ?? null)
            : column.kind === "files"
            ? (listItems(value).map(attachmentName)[0] ?? null)
            : column.kind === "subtable"
              ? subRows(value).length || null
              : value
    const left = shown(a.cells[column.id])
    const right = shown(b.cells[column.id])
    // An untouched box and an unticked one both mean "no".
    if (column.kind === "checkbox") return sign * (Number(left === true) - Number(right === true))
    if (empty(left) || empty(right)) return Number(empty(left)) - Number(empty(right))
    switch (column.kind) {
      case "number":
      case "subtable":
        return sign * (Number(left) - Number(right))
      default:
        // Dates are stored as YYYY-MM-DD, so comparing them as text puts them in date order.
        return sign * String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" })
    }
  })
}

/** Moves one item so it lands before the item now at `to` (or at the end when `to` is the length). */
export function moveBefore<T>(items: T[], from: number, to: number) {
  if (from === to || from + 1 === to) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to > from ? to - 1 : to, 0, item)
  return next
}

// Filters ---------------------------------------------------------------------

export type FilterOp =
  | "contains"
  | "notContains"
  | "is"
  | "isNot"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "before"
  | "after"
  | "yes"
  | "no"
  | "empty"
  | "notEmpty"

/** One rule of a table's filter: rows must pass every rule to be shown. */
export type VaultFilter = { id: string; columnId: string; op: FilterOp; value: string }

const TEXT_OPS: Array<{ id: FilterOp; label: string }> = [
  { id: "contains", label: "contains" },
  { id: "notContains", label: "does not contain" },
  { id: "is", label: "is" },
  { id: "isNot", label: "is not" },
  { id: "empty", label: "is empty" },
  { id: "notEmpty", label: "is not empty" },
]

/** The conditions a column's type can be filtered by, the first being the default. */
export function filterOps(kind: VaultColumnKind): Array<{ id: FilterOp; label: string }> {
  switch (kind) {
    case "number":
      return [
        { id: "is", label: "=" },
        { id: "isNot", label: "≠" },
        { id: "gt", label: ">" },
        { id: "gte", label: "≥" },
        { id: "lt", label: "<" },
        { id: "lte", label: "≤" },
        { id: "empty", label: "is empty" },
        { id: "notEmpty", label: "is not empty" },
      ]
    case "date":
      return [
        { id: "is", label: "is" },
        { id: "before", label: "is before" },
        { id: "after", label: "is after" },
        { id: "empty", label: "is empty" },
        { id: "notEmpty", label: "is not empty" },
      ]
    case "checkbox":
      return [
        { id: "yes", label: "is yes" },
        { id: "no", label: "is no" },
      ]
    case "password":
      return [
        { id: "notEmpty", label: "is set" },
        { id: "empty", label: "is empty" },
      ]
    case "subtable":
      return [
        { id: "contains", label: "contains" },
        { id: "notContains", label: "does not contain" },
        { id: "notEmpty", label: "has items" },
        { id: "empty", label: "has no items" },
      ]
    case "list":
    case "links":
    case "files":
      return [
        { id: "contains", label: "has an item containing" },
        { id: "notContains", label: "has no item containing" },
        { id: "is", label: "has the item" },
        { id: "notEmpty", label: "is not empty" },
        { id: "empty", label: "is empty" },
      ]
    default:
      return TEXT_OPS
  }
}

/** Whether a condition needs a value typed in, rather than standing on its own like "is empty". */
export function filterNeedsValue(op: FilterOp) {
  return op !== "empty" && op !== "notEmpty" && op !== "yes" && op !== "no"
}

export function newFilter(column: VaultColumn): VaultFilter {
  return { id: crypto.randomUUID(), columnId: column.id, op: filterOps(column.kind)[0].id, value: "" }
}

/**
 * Whether a row passes one filter rule. Rules for a deleted column, with a condition its type no
 * longer has, or still waiting for a value let every row through, so a half-made rule hides nothing.
 */
export function passesFilter(
  row: VaultRow,
  column: VaultColumn | undefined,
  filter: VaultFilter,
  linkLabel?: (rowId: string) => string,
) {
  if (!column || !filterOps(column.kind).some((op) => op.id === filter.op)) return true
  const value = row.cells[column.id] ?? null
  const wanted = filter.value.trim().toLowerCase()
  if (filterNeedsValue(filter.op) && wanted === "") return true

  const isEmpty =
    column.kind === "subtable"
      ? subRows(value).length === 0
      : column.kind === "list" || column.kind === "links" || column.kind === "files"
        ? listItems(value).length === 0
        : value === null || value === ""
  switch (filter.op) {
    case "empty":
      return isEmpty
    case "notEmpty":
      return !isEmpty
    case "yes":
      return value === true
    case "no":
      return value !== true
  }

  if (column.kind === "number") {
    const target = Number(filter.value)
    if (!Number.isFinite(target)) return true
    if (typeof value !== "number") return filter.op === "isNot"
    switch (filter.op) {
      case "is":
        return value === target
      case "isNot":
        return value !== target
      case "gt":
        return value > target
      case "gte":
        return value >= target
      case "lt":
        return value < target
      case "lte":
        return value <= target
    }
    return true
  }

  if (column.kind === "date") {
    // Dates are stored as YYYY-MM-DD, so comparing them as text puts them in date order.
    if (typeof value !== "string" || !value) return false
    if (filter.op === "before") return value < filter.value
    if (filter.op === "after") return value > filter.value
    return value === filter.value
  }

  // Lists match item by item; everything else matches the text it shows.
  const texts =
    column.kind === "list"
      ? listItems(value).map((item) => item.toLowerCase())
      : column.kind === "links"
        ? listItems(value).map((id) => (linkLabel?.(id) ?? "").toLowerCase())
        : column.kind === "files"
        ? listItems(value).map((file) => attachmentName(file).toLowerCase())
        : [
            (column.kind === "subtable"
              ? subTableText(value, column.columns ?? [])
              : cellText(value, column.kind, linkLabel)
            ).toLowerCase(),
          ]
  switch (filter.op) {
    case "contains":
      return texts.some((text) => text.includes(wanted))
    case "notContains":
      return !texts.some((text) => text.includes(wanted))
    case "is":
      return texts.some((text) => text.trim() === wanted)
    case "isNot":
      return !texts.some((text) => text.trim() === wanted)
  }
  return true
}

// Duplicates ------------------------------------------------------------------

/** A value as compared for duplicates: text ignores capitals and extra spaces; empty is "". */
function duplicateKey(value: VaultCell | undefined, column: VaultColumn): string {
  if (column.kind === "checkbox") return value === true ? "yes" : "no"
  if (column.kind === "subtable") {
    const inner = column.columns ?? []
    const rows = subRows(value)
    return rows.length === 0 ? "" : JSON.stringify(rows.map((row) => inner.map((sub) => duplicateKey(row.cells[sub.id], sub))))
  }
  if (Array.isArray(value)) return JSON.stringify(listItems(value).map((item) => duplicateKey(item, column)))
  if (value === null || value === undefined) return ""
  // Links compare the row they point to, which is the same whatever that row is called.
  if (typeof value === "string" && !linksRows(column.kind)) return value.trim().replace(/\s+/g, " ").toLowerCase()
  return String(value)
}

/**
 * Rows that have the same values as another row in the given columns, as row id → group number.
 * Groups are numbered in the order their first row appears. Rows empty in every compared column
 * are not counted as duplicates of each other.
 */
export function findDuplicates(rows: VaultRow[], columns: VaultColumn[]): Map<string, number> {
  const byKey = new Map<string, string[]>()
  for (const row of rows) {
    const values = columns.map((column) => duplicateKey(row.cells[column.id], column))
    const blank = columns.every((column, index) => values[index] === "" || (column.kind === "checkbox" && values[index] === "no"))
    if (blank) continue
    const key = JSON.stringify(values)
    byKey.set(key, [...(byKey.get(key) ?? []), row.id])
  }
  const groups = new Map<string, number>()
  let group = 0
  for (const ids of byKey.values()) {
    if (ids.length < 2) continue
    for (const id of ids) groups.set(id, group)
    group += 1
  }
  return groups
}

/**
 * For every column, the cells whose value also appears in another row of that column, as
 * column id → (row id → how many other rows share it). Yes / no columns are left out, since
 * they only have two values, and empty cells never count.
 */
export function duplicateCells(rows: VaultRow[], columns: VaultColumn[]): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>()
  for (const column of columns) {
    if (column.kind === "checkbox") continue
    const byKey = new Map<string, string[]>()
    for (const row of rows) {
      const key = duplicateKey(row.cells[column.id], column)
      if (key === "") continue
      byKey.set(key, [...(byKey.get(key) ?? []), row.id])
    }
    const marked = new Map<string, number>()
    for (const ids of byKey.values()) {
      if (ids.length < 2) continue
      for (const id of ids) marked.set(id, ids.length - 1)
    }
    if (marked.size > 0) result.set(column.id, marked)
  }
  return result
}
