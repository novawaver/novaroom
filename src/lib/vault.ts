import { inTauri } from "./desktop"

// Vault keeps tables in a file on this computer; nothing here touches the cloud.

export type VaultColumnKind = "text" | "number" | "date" | "checkbox" | "email" | "password" | "link"

export const VAULT_COLUMN_KINDS: Array<{ id: VaultColumnKind; label: string }> = [
  { id: "text", label: "Text" },
  { id: "number", label: "Number" },
  { id: "date", label: "Date" },
  { id: "checkbox", label: "Yes / no" },
  { id: "email", label: "Email" },
  { id: "password", label: "Password" },
  { id: "link", label: "Link" },
]

export type VaultCell = string | number | boolean | null

export type VaultColumn = {
  id: string
  name: string
  kind: VaultColumnKind
  // Link columns: the table whose rows the cells point to. Each cell holds one row id from it.
  target?: string
}
export type VaultRow = { id: string; cells: Record<string, VaultCell> }
export type VaultTable = { id: string; name: string; columns: VaultColumn[]; rows: VaultRow[] }
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

export function newTable(name: string): VaultTable {
  const nameColumn: VaultColumn = { id: crypto.randomUUID(), name: "Name", kind: "text" }
  return { id: crypto.randomUUID(), name, columns: [nameColumn], rows: [] }
}

export function newColumn(name: string): VaultColumn {
  return { id: crypto.randomUUID(), name, kind: "text" }
}

export function newRow(): VaultRow {
  return { id: crypto.randomUUID(), cells: {} }
}

/** Converts a cell to fit a column's new type, keeping what can be kept. */
export function convertCell(value: VaultCell, kind: VaultColumnKind): VaultCell {
  if (value === null || value === "") return null
  switch (kind) {
    case "text":
    case "email":
    case "password":
      return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)
    case "link":
      // Row ids only mean something to a Link column, so other values cannot become links.
      return null
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
  return String(value)
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
    if (value !== null && value !== undefined && value !== "") return String(value)
  }
  return `Row ${index + 1}`
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
    const shown = (value: VaultCell | undefined) =>
      column.kind === "link" && typeof value === "string" ? (linkLabel?.(value) ?? "") : value
    const left = shown(a.cells[column.id])
    const right = shown(b.cells[column.id])
    // An untouched box and an unticked one both mean "no".
    if (column.kind === "checkbox") return sign * (Number(left === true) - Number(right === true))
    if (empty(left) || empty(right)) return Number(empty(left)) - Number(empty(right))
    switch (column.kind) {
      case "number":
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
