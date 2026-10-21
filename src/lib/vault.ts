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

// List cells hold their lines, List of links cells the ids of the rows they point to, and
// Sub-table cells their own rows.
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
  // Row ids only mean something to a Link column, so other values cannot become links.
  if (linksRows(kind)) return null
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

/** The text a search matches a cell against. Passwords are never matched. */
export function cellText(value: VaultCell, kind: VaultColumnKind, linkLabel?: (rowId: string) => string) {
  if (value === null || value === undefined || kind === "password") return ""
  if (kind === "checkbox") return value === true ? "yes" : "no"
  if (kind === "link") return linkLabel && typeof value === "string" ? linkLabel(value) : ""
  if (kind === "links") return linkLabel ? listItems(value).map(linkLabel).join(" ") : ""
  if (kind === "list") return listItems(value).join(" ")
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
  if (index === -1) return null
  const row = table.rows[index]
  for (const column of table.columns) {
    if (!LABEL_KINDS.includes(column.kind)) continue
    const value = row.cells[column.id]
    if (value !== null && value !== undefined && value !== "" && !Array.isArray(value)) return String(value)
  }
  return `Row ${index + 1}`
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
      : column.kind === "list" || column.kind === "links"
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
