import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  VAULT_COLUMN_KINDS,
  VAULT_SUB_KINDS,
  cellText,
  convertCell,
  createVaultFile,
  duplicateCells,
  fileName,
  filterNeedsValue,
  filterOps,
  findDuplicates,
  moveBefore,
  newColumn,
  newFilter,
  newRow,
  newTable,
  passesFilter,
  pickVaultFile,
  linksRows,
  listItems,
  looksLikeEmail,
  webAddress,
  readVault,
  rememberVaultFile,
  rememberedVaultFile,
  rowLabel,
  sortRows,
  subRows,
  vaultCategories,
  subTableText,
  vaultAvailable,
  writeVault,
  type VaultCell,
  type VaultColumn,
  type SortDirection,
  type VaultColumnKind,
  type VaultData,
  type VaultFilter,
  type FilterOp,
  type VaultRow,
  type VaultSubKind,
  type VaultTable,
} from "../lib/vault"
import { setExitGuard } from "../lib/unsaved"

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4h11.5L20 7.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1z" />
      <path d="M8 4v4.5h7V4M7.5 20v-6h9v6" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5l-6 6M4.5 19.5l6-6" />
    </svg>
  )
}

function OpenFileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 18.5V6.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v1.5" />
      <path d="M3.5 18.5l2.6-7.2a1.5 1.5 0 0 1 1.4-1h13.3l-2.9 8.2H3.5z" />
    </svg>
  )
}

function NewFileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13.5 3.5h-7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-9" />
      <path d="M13.5 3.5v6h6M12 12.5v5M9.5 15h5" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13" />
      <path d="M17.6 3.9a2 2 0 0 1 2.8 2.8L12.5 14.6 9 15.5l.9-3.5 7.7-8.1z" />
    </svg>
  )
}

function CancelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
      {!open && <path d="M4 4l16 16" />}
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
    </svg>
  )
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5.5h16l-6.2 7.3v5.4l-3.6 1.8v-7.2z" />
    </svg>
  )
}

/** Two stacked cards with a check: repeated values are being marked. */
function RepeatedIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="3.5" width="11" height="11" rx="2" />
      <path d="M18 8.5h.5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V18" />
      <path d="M6.5 9l2 2 3.5-4" />
    </svg>
  )
}

function DuplicatesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="11" height="11" rx="2" />
      <rect x="9" y="9" width="11" height="11" rx="2" />
    </svg>
  )
}

function TableIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M4 10h16M10 10v9" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12M10 11v6M14 11v6" />
    </svg>
  )
}

function FitWidthIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5v14M20 5v14M7.5 12h9M10 9.5L7.5 12l2.5 2.5M14 9.5l2.5 2.5-2.5 2.5" />
    </svg>
  )
}

// Whether wide tables shrink to fit the page instead of scrolling sideways; remembered on this computer.
const FIT_KEY = "novaroom.vault-fit"

function readFit() {
  try {
    return localStorage.getItem(FIT_KEY) === "true"
  } catch {
    return false
  }
}

// Whether a table marks cells repeating a value from another row. Set per table on this computer,
// and on unless turned off, so toggling it never leaves the Vault file with unsaved changes.
const repeatedKey = (tableId: string) => `novaroom.vault-mark-repeated.${tableId}`

function readMarkRepeated(tableId: string) {
  try {
    return localStorage.getItem(repeatedKey(tableId)) !== "false"
  } catch {
    return true
  }
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </svg>
  )
}

function SortIcon({ direction }: { direction: SortDirection | null }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {direction === "asc" ? (
        <path d="M12 19V5M6.5 10.5L12 5l5.5 5.5" />
      ) : direction === "desc" ? (
        <path d="M12 5v14M6.5 13.5L12 19l5.5-5.5" />
      ) : (
        <path d="M8 19V5M4.5 8.5L8 5l3.5 3.5M16 5v14M12.5 15.5L16 19l3.5-3.5" />
      )}
    </svg>
  )
}

function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="7" r="1.2" />
      <circle cx="15" cy="7" r="1.2" />
      <circle cx="9" cy="12" r="1.2" />
      <circle cx="15" cy="12" r="1.2" />
      <circle cx="9" cy="17" r="1.2" />
      <circle cx="15" cy="17" r="1.2" />
    </svg>
  )
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export type VaultState = ReturnType<typeof useVault>

/**
 * Holds the open Vault file and its edits. Edits stay in memory until the person saves, so the
 * app can warn before they leave the page with changes that are not in the file yet.
 */
export function useVault(userId: string | null, active: boolean) {
  const available = vaultAvailable()
  const [file, setFile] = useState<string | null>(() => (userId ? rememberedVaultFile(userId) : null))
  const [saved, setSaved] = useState<VaultData | null>(null)
  const [data, setData] = useState<VaultData | null>(null)
  const [status, setStatus] = useState<"idle" | "loading" | "saving">("idle")
  const [error, setError] = useState("")
  const [tableId, setTableId] = useState<string | null>(null)
  // Tables open read-only; Edit shows the controls for changing them.
  const [editing, setEditing] = useState(false)
  // A row to scroll to and highlight, after following a Link to it.
  const [focusRow, setFocusRow] = useState<{ tableId: string; rowId: string } | null>(null)
  // What to do once the person answers the "save or discard?" question.
  const [pending, setPending] = useState<{ run: () => void } | null>(null)
  // Each table's filter rules, kept while the file is open. They only change what is shown.
  const [filters, setFilters] = useState<Record<string, VaultFilter[]>>({})

  const dirty = useMemo(
    () => data !== null && saved !== null && JSON.stringify(data) !== JSON.stringify(saved),
    [data, saved],
  )
  const table = data?.tables.find((item) => item.id === tableId) ?? data?.tables[0] ?? null

  const load = useCallback(
    async (path: string) => {
      setStatus("loading")
      setError("")
      try {
        const next = await readVault(path)
        setFile(path)
        setSaved(next)
        setData(next)
        setTableId(next.tables[0]?.id ?? null)
        setEditing(false)
        setFilters({})
        if (userId) rememberVaultFile(userId, path)
      } catch (caught) {
        setFile(null)
        setSaved(null)
        setData(null)
        if (userId) rememberVaultFile(userId, null)
        setError(caught instanceof Error ? caught.message : "Could not open the Vault file.")
      } finally {
        setStatus("idle")
      }
    },
    [userId],
  )

  // Open the remembered file the first time the page is shown.
  useEffect(() => {
    if (active && available && file && data === null && status === "idle" && !error) void load(file)
  }, [active, available, file, data, status, error, load])

  // Quitting from the tray or restarting for an update asks the same question first.
  useEffect(() => {
    setExitGuard(dirty ? (proceed) => setPending({ run: proceed }) : null)
  }, [dirty])
  useEffect(() => () => setExitGuard(null), [])

  /** Runs the action now, or after the person decides what to do with unsaved changes. */
  const guard = useCallback(
    (run: () => void) => {
      if (dirty) setPending({ run })
      else run()
    },
    [dirty],
  )

  async function save() {
    if (!file || !data || !dirty) return true
    const snapshot = data
    setStatus("saving")
    setError("")
    try {
      await writeVault(file, snapshot)
      setSaved(snapshot)
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the Vault file.")
      return false
    } finally {
      setStatus("idle")
    }
  }

  function discard() {
    setData(saved)
    if (saved && !saved.tables.some((item) => item.id === tableId)) setTableId(saved.tables[0]?.id ?? null)
  }

  function chooseFile(mode: "create" | "open") {
    guard(() => {
      setError("")
      void (mode === "create" ? createVaultFile() : pickVaultFile())
        .then((path) => {
          if (path) {
            setSaved(null)
            setData(null)
            return load(path)
          }
        })
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not use that file."))
    })
  }

  function update(change: (current: VaultData) => VaultData) {
    setData((current) => (current ? change(current) : current))
  }

  function updateTable(id: string, change: (current: VaultTable) => VaultTable) {
    update((current) => ({
      tables: current.tables.map((item) => (item.id === id ? change(item) : item)),
    }))
  }

  function addTable() {
    if (!data) return
    // A new table joins the category of the table that is open.
    const created = newTable(`Table ${data.tables.length + 1}`, table?.category.trim() ?? "")
    update((current) => ({ tables: [...current.tables, created] }))
    setTableId(created.id)
    setEditing(true)
  }

  function removeTable(id: string) {
    if (!data) return
    const index = data.tables.findIndex((item) => item.id === id)
    const removed = data.tables[index]
    // Links into the deleted table become Text (and Lists of links become Lists) holding the names
    // they showed, so nothing is lost.
    const rest = data.tables
      .filter((item) => item.id !== id)
      .map((item) => {
        const orphaned = item.columns.filter((column) => linksRows(column.kind) && column.target === id)
        if (orphaned.length === 0) return item
        return {
          ...item,
          columns: item.columns.map((column) =>
            orphaned.includes(column)
              ? { id: column.id, name: column.name, kind: column.kind === "links" ? ("list" as const) : ("text" as const) }
              : column,
          ),
          rows: item.rows.map((row) => {
            const cells = { ...row.cells }
            for (const column of orphaned) {
              const value = cells[column.id]
              if (column.kind === "links") {
                const names = listItems(value)
                  .map((rowId) => rowLabel(removed, rowId))
                  .filter((name): name is string => name !== null)
                cells[column.id] = names.length > 0 ? names : null
              } else cells[column.id] = typeof value === "string" ? rowLabel(removed, value) : null
            }
            return { ...row, cells }
          }),
        }
      })
    update(() => ({ tables: rest }))
    setTableId(rest[Math.min(index, rest.length - 1)]?.id ?? null)
  }

  /** Follows a Link: opens the table it points to and shows the row. */
  function openRow(targetTableId: string, rowId: string) {
    setTableId(targetTableId)
    setFocusRow({ tableId: targetTableId, rowId })
  }

  return {
    available,
    file,
    data,
    table,
    dirty,
    loading: status === "loading",
    saving: status === "saving",
    error,
    pending,
    setPending,
    selectTable: setTableId,
    editing,
    setEditing,
    focusRow,
    clearFocusRow: () => setFocusRow(null),
    filtersOf: (id: string) => filters[id] ?? [],
    setTableFilters: (id: string, next: VaultFilter[]) => setFilters((current) => ({ ...current, [id]: next })),
    openRow,
    guard,
    save,
    discard,
    chooseFile,
    updateTable,
    addTable,
    removeTable,
  }
}

/** A link's target: the table it points to, the name to show, and how to go there. */
type LinkTarget = {
  table: VaultTable | null
  label: (rowId: string) => string | null
  open: (rowId: string) => void
}

function PasswordEditor({ label, value, onChange }: { label: string; value: VaultCell; onChange: (value: VaultCell) => void }) {
  const [visible, setVisible] = useState(false)
  return (
    <span className="vault-secret">
      <input
        type={visible ? "text" : "password"}
        aria-label={label}
        autoComplete="new-password"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value || null)}
      />
      <button
        type="button"
        className="vault-cell-action"
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide" : "Show"}
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
      >
        <EyeIcon open={!visible} />
      </button>
    </span>
  )
}

function CellEditor({
  column,
  value,
  onChange,
  link,
}: {
  column: VaultColumn
  value: VaultCell
  onChange: (value: VaultCell) => void
  link?: LinkTarget
}) {
  const label = column.name || "Cell"
  switch (column.kind) {
    case "notes":
      return <NotesEditor label={label} value={value} onChange={onChange} />
    case "list":
      return <ListEditor label={label} value={value} onChange={onChange} />
    case "links":
      return <LinksEditor label={label} value={value} onChange={onChange} link={link} />
    case "subtable":
      return <SubTableCell column={column} value={value} editing onChange={onChange} />
    case "email":
      return (
        <input
          type="email"
          aria-label={label}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value || null)}
        />
      )
    case "password":
      return <PasswordEditor label={label} value={value} onChange={onChange} />
    case "url": {
      const text = typeof value === "string" ? value : ""
      const address = webAddress(text)
      return (
        <span className="vault-secret">
          <input
            type="url"
            aria-label={label}
            placeholder="https://"
            value={text}
            onChange={(event) => onChange(event.target.value || null)}
          />
          {address && (
            <button
              type="button"
              className="vault-cell-action"
              aria-label={`Open ${text}`}
              title="Open in your browser"
              onClick={() => openWebAddress(address)}
            >
              <OpenLinkIcon />
            </button>
          )}
        </span>
      )
    }
    case "link": {
      const rowId = typeof value === "string" ? value : ""
      const missing = rowId !== "" && link?.label(rowId) === null
      return (
        <span className="vault-secret">
          <select
            className="vault-link-select"
            aria-label={label}
            value={rowId}
            disabled={!link?.table}
            onChange={(event) => onChange(event.target.value || null)}
          >
            <option value="">{link?.table ? "—" : "No table to link to"}</option>
            {missing && <option value={rowId}>Deleted row</option>}
            {link?.table?.rows.map((row) => (
              <option key={row.id} value={row.id}>
                {link.label(row.id)}
              </option>
            ))}
          </select>
          {rowId && !missing && link && (
            <button
              type="button"
              className="vault-cell-action"
              aria-label={`Go to ${link.label(rowId)}`}
              title="Go to this row"
              onClick={() => link.open(rowId)}
            >
              <LinkIcon />
            </button>
          )}
        </span>
      )
    }
    case "checkbox":
      return (
        <input
          type="checkbox"
          className="vault-check"
          aria-label={label}
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
      )
    case "number":
      return (
        <input
          type="number"
          aria-label={label}
          value={typeof value === "number" ? value : ""}
          onChange={(event) => {
            const next = event.target.valueAsNumber
            onChange(Number.isFinite(next) ? next : null)
          }}
        />
      )
    case "date":
      return (
        <input
          type="date"
          aria-label={label}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value || null)}
        />
      )
    default:
      return (
        <input
          type="text"
          aria-label={label}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(event) => onChange(event.target.value || null)}
        />
      )
  }
}

/** Copies text to the clipboard, showing a check mark for a moment once it has. */
function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <button
      type="button"
      className={className ? `vault-cell-action ${className}` : "vault-cell-action"}
      aria-label={label}
      title={copied ? "Copied" : "Copy"}
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => {
            // The clipboard was not available; the text can still be selected and copied by hand.
          },
        )
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { dateStyle: "medium" })
}

/**
 * The text a cell's copy button puts on the clipboard: what the cell shows, except that numbers
 * are copied without thousands separators so they paste cleanly into other apps.
 */
function copyText(column: VaultColumn, value: VaultCell, link?: LinkTarget) {
  if (value === null || value === "") return ""
  switch (column.kind) {
    case "checkbox":
      return value === true ? "Yes" : "No"
    case "link":
      return typeof value === "string" ? (link?.label(value) ?? "") : ""
    case "links":
      return listItems(value)
        .map((rowId) => link?.label(rowId))
        .filter(Boolean)
        .join("\n")
    case "date":
      return typeof value === "string" ? formatDate(value) : ""
    case "list":
      return listItems(value).join("\n")
    case "subtable":
      return ""
    default:
      return String(value)
  }
}

function PasswordView({ value }: { value: string }) {
  const [visible, setVisible] = useState(false)

  return (
    <span className="vault-cell-view vault-secret">
      <span className={visible ? "vault-secret-text" : "vault-secret-text vault-masked"}>
        {visible ? value : "••••••••"}
      </span>
      <button
        type="button"
        className="vault-cell-action"
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide" : "Show"}
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
      >
        <EyeIcon open={!visible} />
      </button>
      <CopyButton text={value} label="Copy password" />
    </span>
  )
}

function openWebAddress(address: string) {
  void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(address))
}

function OpenLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13.5 4.5h6v6M19.5 4.5l-8 8" />
      <path d="M17.5 13.5v4a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h4" />
    </svg>
  )
}

function openEmail(address: string) {
  void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(`mailto:${address}`))
}

function CellView({ column, value, link }: { column: VaultColumn; value: VaultCell; link?: LinkTarget }) {
  if (column.kind === "list") {
    return (
      <span className="vault-cell-view vault-list">
        {listItems(value).map((item, index) => (
          <span key={index}>{item}</span>
        ))}
      </span>
    )
  }
  if (column.kind === "subtable") return <SubTableCell column={column} value={value} editing={false} />
  if (column.kind === "notes") {
    return typeof value === "string" && value ? (
      <NotesView title={column.name || "Notes"} text={value} />
    ) : (
      <span className="vault-cell-view" />
    )
  }
  if (column.kind === "links") {
    const ids = listItems(value)
    if (!link || ids.length === 0) return <span className="vault-cell-view" />
    return (
      <span className="vault-cell-view vault-list">
        {ids.map((rowId) => {
          const name = link.label(rowId)
          return name === null ? (
            <span key={rowId} className="vault-no">
              Deleted row
            </span>
          ) : (
            <span key={rowId}>
              <button
                type="button"
                className="vault-link"
                title={`Open in ${link.table?.name || "its table"}`}
                onClick={() => link.open(rowId)}
              >
                <LinkIcon />
                {name}
              </button>
            </span>
          )
        })}
      </span>
    )
  }
  if (column.kind === "link") {
    if (typeof value !== "string" || !link) return <span className="vault-cell-view" />
    const name = link.label(value)
    return name === null ? (
      <span className="vault-cell-view vault-no">Deleted row</span>
    ) : (
      <span className="vault-cell-view">
        <button type="button" className="vault-link" title={`Open in ${link.table?.name || "its table"}`} onClick={() => link.open(value)}>
          <LinkIcon />
          {name}
        </button>
      </span>
    )
  }
  if (column.kind === "password") {
    return typeof value === "string" && value ? <PasswordView value={value} /> : <span className="vault-cell-view" />
  }
  if (column.kind === "url" && typeof value === "string" && webAddress(value)) {
    const address = webAddress(value)!
    return (
      <span className="vault-cell-view">
        <button type="button" className="vault-link" title={`Open ${address} in your browser`} onClick={() => openWebAddress(address)}>
          <OpenLinkIcon />
          {value.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "")}
        </button>
      </span>
    )
  }
  if (column.kind === "email" && typeof value === "string" && looksLikeEmail(value)) {
    return (
      <span className="vault-cell-view">
        <button type="button" className="vault-link" title={`Write to ${value}`} onClick={() => openEmail(value)}>
          {value}
        </button>
      </span>
    )
  }
  if (column.kind === "checkbox") {
    return value === true ? (
      <span className="vault-cell-view vault-yes" aria-label="Yes">
        <CheckIcon />
      </span>
    ) : (
      <span className="vault-cell-view vault-no" aria-label="No">
        —
      </span>
    )
  }
  if (value === null || value === "") return <span className="vault-cell-view" />
  if (column.kind === "number" && typeof value === "number") {
    return <span className="vault-cell-view vault-number">{value.toLocaleString()}</span>
  }
  if (column.kind === "date" && typeof value === "string") {
    return <span className="vault-cell-view">{formatDate(value)}</span>
  }
  return <span className="vault-cell-view">{String(value)}</span>
}

/** A read-only cell with a copy button that appears while the pointer is over it. */
function CopyableCell({ column, value, link }: { column: VaultColumn; value: VaultCell; link?: LinkTarget }) {
  const text = copyText(column, value, link)
  return (
    <div className="vault-copyable">
      <CellView column={column} value={value} link={link} />
      {/* Passwords have their own copy button, always shown. */}
      {text && column.kind !== "password" && (
        <CopyButton text={text} label={`Copy ${column.name || "value"}`} className="vault-copy" />
      )}
    </div>
  )
}

/** A List cell in Edit: one item per line. Blank lines are left out of what is saved. */
function ListEditor({ label, value, onChange }: { label: string; value: VaultCell; onChange: (value: VaultCell) => void }) {
  // What is typed, kept while editing so a new, still-empty line does not vanish.
  const [draft, setDraft] = useState<string | null>(null)
  const items = listItems(value)
  return (
    <textarea
      className="vault-list-input"
      aria-label={`${label}, one item per line`}
      placeholder="One item per line"
      rows={Math.max(1, Math.min(items.length + 1, 6))}
      value={draft ?? items.join("\n")}
      onChange={(event) => {
        setDraft(event.target.value)
        const lines = event.target.value
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        onChange(lines.length > 0 ? lines : null)
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

/** A List of links cell in Edit: the rows it links to, each removable, and a menu to add another. */
function LinksEditor({
  label,
  value,
  onChange,
  link,
}: {
  label: string
  value: VaultCell
  onChange: (value: VaultCell) => void
  link?: LinkTarget
}) {
  const ids = listItems(value)
  const addable = link?.table?.rows.filter((row) => !ids.includes(row.id)) ?? []
  return (
    <span className="vault-links">
      {ids.map((rowId) => {
        const name = link?.label(rowId) ?? null
        return (
          <span key={rowId} className="vault-link-chip">
            {name === null ? (
              <span className="vault-no">Deleted row</span>
            ) : (
              <button type="button" className="vault-link" title="Go to this row" onClick={() => link?.open(rowId)}>
                <LinkIcon />
                {name}
              </button>
            )}
            <button
              type="button"
              className="vault-cell-action"
              aria-label={`Remove ${name ?? "deleted row"} from ${label}`}
              title="Remove"
              onClick={() => {
                const next = ids.filter((id) => id !== rowId)
                onChange(next.length > 0 ? next : null)
              }}
            >
              <RemoveIcon />
            </button>
          </span>
        )
      })}
      <select
        className="vault-link-select"
        aria-label={`Add a link to ${label}`}
        value=""
        disabled={addable.length === 0}
        onChange={(event) => {
          if (event.target.value) onChange([...ids, event.target.value])
        }}
      >
        <option value="">
          {!link?.table
            ? "No table to link to"
            : addable.length > 0
              ? "+ Add a link"
              : ids.length > 0
                ? "Every row is linked"
                : "No rows to link to"}
        </option>
        {addable.map((row) => (
          <option key={row.id} value={row.id}>
            {link?.label(row.id)}
          </option>
        ))}
      </select>
    </span>
  )
}

/** Notes cells are shown cut short in the table once they are longer than this. */
const NOTES_PREVIEW_LINES = 3
const NOTES_PREVIEW_CHARS = 160

/** The whole text of a Notes cell in a panel, editable when onChange is given (Edit mode). */
function NotesDialog({
  title,
  text,
  onChange,
  onClose,
}: {
  title: string
  text: string
  onChange?: (value: VaultCell) => void
  onClose: () => void
}) {
  return (
    <VaultModal title={title} wide onClose={onClose}>
      {onChange ? (
        <textarea
          className="vault-notes-full"
          aria-label={title}
          autoFocus
          value={text}
          onChange={(event) => onChange(event.target.value || null)}
        />
      ) : (
        <div className="vault-notes-full vault-notes-text">{text}</div>
      )}
    </VaultModal>
  )
}

/** A Notes cell in Edit: a box for longer text, and a bigger one in a panel. */
function NotesEditor({ label, value, onChange }: { label: string; value: VaultCell; onChange: (value: VaultCell) => void }) {
  const [open, setOpen] = useState(false)
  const text = typeof value === "string" ? value : ""
  return (
    <span className="vault-notes-edit">
      <textarea
        className="vault-list-input"
        aria-label={label}
        placeholder="Notes"
        rows={Math.max(2, Math.min(text.split("\n").length, 6))}
        value={text}
        onChange={(event) => onChange(event.target.value || null)}
      />
      <button
        type="button"
        className="vault-cell-action"
        aria-label={`Edit ${label} in a bigger box`}
        title="Edit in a bigger box"
        onClick={() => setOpen(true)}
      >
        <ExpandIcon />
      </button>
      {open && <NotesDialog title={label} text={text} onChange={onChange} onClose={() => setOpen(false)} />}
    </span>
  )
}

/** A Notes cell: its first few lines, and the whole text in a panel when it is longer. */
function NotesView({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.split("\n").length > NOTES_PREVIEW_LINES || text.length > NOTES_PREVIEW_CHARS
  return (
    <span className="vault-cell-view vault-notes">
      <span className="vault-notes-preview">{text}</span>
      {long && (
        <button type="button" className="vault-link vault-notes-more" onClick={() => setOpen(true)}>
          Show all
        </button>
      )}
      {open && <NotesDialog title={title} text={text} onClose={() => setOpen(false)} />}
    </span>
  )
}

function itemCount(count: number) {
  return count === 1 ? "1 item" : `${count} items`
}

/** A Sub-table cell: how many items it holds, opening a panel with the items themselves. */
function SubTableCell({
  column,
  value,
  editing,
  onChange,
}: {
  column: VaultColumn
  value: VaultCell
  editing: boolean
  onChange?: (value: VaultCell) => void
}) {
  const [open, setOpen] = useState(false)
  const rows = subRows(value)
  if (!editing && rows.length === 0) return <span className="vault-cell-view" />
  return (
    <span className="vault-cell-view">
      <button type="button" className="vault-link" title={`Open ${column.name || "sub-table"}`} onClick={() => setOpen(true)}>
        <TableIcon />
        {rows.length === 0 ? "Add items" : itemCount(rows.length)}
      </button>
      {open && (
        <SubTableDialog
          column={column}
          rows={rows}
          onChange={editing && onChange ? (next) => onChange(next.length > 0 ? next : null) : undefined}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  )
}

/** A Vault panel over the page. Closes on Escape or a click outside, like the app's other dialogs. */
function VaultModal({
  title,
  wide,
  onClose,
  children,
}: {
  title: string
  wide?: boolean
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  return createPortal(
    <div className="desk-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={wide ? "vault-modal wide" : "vault-modal"} role="dialog" aria-label={title}>
        <div className="vault-modal-head">
          <h2>{title}</h2>
          <button type="button" className="vault-remove" aria-label="Close" title="Close" onClick={onClose}>
            <RemoveIcon />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Every second column is shaded (through its <col>, so row and cell highlights still show over it). */
const altColumn = (index: number) => (index % 2 === 1 ? "vault-col-alt" : undefined)

/** The items inside one Sub-table cell. Read-only unless onChange is given (Edit mode). */
function SubTableDialog({
  column,
  rows,
  onChange,
  onClose,
}: {
  column: VaultColumn
  rows: VaultRow[]
  onChange?: (rows: VaultRow[]) => void
  onClose: () => void
}) {
  const columns = column.columns ?? []
  const editing = Boolean(onChange)
  const setCell = (rowId: string, columnId: string, value: VaultCell) =>
    onChange?.(rows.map((row) => (row.id === rowId ? { ...row, cells: { ...row.cells, [columnId]: value } } : row)))

  return (
    <VaultModal title={column.name || "Sub-table"} wide onClose={onClose}>
      {columns.length === 0 ? (
        <p className="hint">
          {editing
            ? "This sub-table has no columns yet. Add some with Columns in its header."
            : "This sub-table has no columns yet."}
        </p>
      ) : (
        <div className="vault-grid-wrap vault-sub-wrap">
          <table className={editing ? "vault-grid vault-fit" : "vault-grid vault-viewing vault-fit"}>
            <colgroup>
              <col />
              {columns.map((sub, columnIndex) => (
                <col key={sub.id} className={altColumn(columnIndex)} />
              ))}
              {editing && <col />}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="vault-no">
                  No
                </th>
                {columns.map((sub, columnIndex) => (
                  <th key={sub.id} scope="col" className={altColumn(columnIndex)}>
                    <span className="vault-col-name">{sub.name}</span>
                  </th>
                ))}
                {editing && <th className="vault-row-actions" aria-label="Item actions" />}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="vault-empty" colSpan={columns.length + (editing ? 2 : 1)}>
                    No items yet.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={row.id}>
                    <td className="vault-no">{index + 1}</td>
                    {columns.map((sub) => (
                      <td key={sub.id}>
                        {editing ? (
                          <CellEditor
                            column={sub}
                            value={row.cells[sub.id] ?? null}
                            onChange={(value) => setCell(row.id, sub.id, value)}
                          />
                        ) : (
                          <CopyableCell column={sub} value={row.cells[sub.id] ?? null} />
                        )}
                      </td>
                    ))}
                    {editing && (
                      <td className="vault-row-actions">
                        <button
                          type="button"
                          className="vault-remove"
                          aria-label="Delete item"
                          title="Delete item"
                          onClick={() => onChange?.(rows.filter((item) => item.id !== row.id))}
                        >
                          <RemoveIcon />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="form-actions">
        {editing && columns.length > 0 && (
          <button type="button" className="button secondary vault-small" onClick={() => onChange?.([...rows, newRow()])}>
            <PlusIcon /> Item
          </button>
        )}
        <button type="button" className="button vault-small" onClick={onClose}>
          Done
        </button>
      </div>
    </VaultModal>
  )
}

type SubColumnsChange = (columns: VaultColumn[], convert?: { columnId: string; kind: VaultSubKind }) => void

/** Names and types of a Sub-table column's own columns, shared by every cell in it. */
function SubColumnsDialog({
  column,
  onChange,
  onClose,
}: {
  column: VaultColumn
  onChange: SubColumnsChange
  onClose: () => void
}) {
  const columns = column.columns ?? []

  return (
    <VaultModal title={`Columns in ${column.name || "sub-table"}`} onClose={onClose}>
      {columns.length === 0 && <p className="hint">No columns yet.</p>}
      <div className="vault-sub-columns">
        {columns.map((sub, index) => (
          <div key={sub.id} className="vault-sub-column">
            <input
              aria-label={`Name of column ${index + 1}`}
              value={sub.name}
              onChange={(event) =>
                onChange(columns.map((item) => (item.id === sub.id ? { ...item, name: event.target.value } : item)))
              }
            />
            <select
              aria-label={`Type of ${sub.name}`}
              value={sub.kind}
              onChange={(event) => {
                const kind = event.target.value as VaultSubKind
                onChange(
                  columns.map((item) => (item.id === sub.id ? { ...item, kind } : item)),
                  { columnId: sub.id, kind },
                )
              }}
            >
              {VAULT_SUB_KINDS.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="vault-remove"
              aria-label={`Delete column ${sub.name}`}
              title="Delete column"
              onClick={() => onChange(columns.filter((item) => item.id !== sub.id))}
            >
              <RemoveIcon />
            </button>
          </div>
        ))}
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="button secondary vault-small"
          onClick={() => onChange([...columns, newColumn(`Column ${columns.length + 1}`)])}
        >
          <PlusIcon /> Column
        </button>
        <button type="button" className="button vault-small" onClick={onClose}>
          Done
        </button>
      </div>
    </VaultModal>
  )
}

function SubColumnsButton({ column, onChange }: { column: VaultColumn; onChange: SubColumnsChange }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="vault-sub-columns-button"
        title="Columns inside this sub-table"
        onClick={() => setOpen(true)}
      >
        Columns ({column.columns?.length ?? 0})
      </button>
      {open && <SubColumnsDialog column={column} onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  )
}

/** The filter rules of one table: column, condition, and value, one rule per line. */
function FilterBar({
  table,
  filters,
  onChange,
}: {
  table: VaultTable
  filters: VaultFilter[]
  onChange: (filters: VaultFilter[]) => void
}) {
  const set = (id: string, patch: Partial<VaultFilter>) =>
    onChange(filters.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter)))

  return (
    <div className="vault-filters" role="group" aria-label="Filters">
      {filters.length === 0 && <p className="hint">No filters yet. Add one to show only the rows you need.</p>}
      {filters.map((filter, index) => {
        const column = table.columns.find((item) => item.id === filter.columnId)
        const ops = column ? filterOps(column.kind) : []
        const op = ops.some((item) => item.id === filter.op) ? filter.op : ops[0]?.id
        return (
          <div key={filter.id} className="vault-filter">
            <span className="vault-filter-join">{index === 0 ? "Where" : "and"}</span>
            <select
              aria-label="Column to filter"
              value={column ? filter.columnId : ""}
              onChange={(event) => {
                const next = table.columns.find((item) => item.id === event.target.value)
                if (next) set(filter.id, { columnId: next.id, op: filterOps(next.kind)[0].id, value: "" })
              }}
            >
              {!column && <option value="">Deleted column</option>}
              {table.columns.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name || "Untitled"}
                </option>
              ))}
            </select>
            {column && (
              <select
                aria-label="Condition"
                value={op}
                onChange={(event) => set(filter.id, { op: event.target.value as FilterOp })}
              >
                {ops.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            )}
            {column && op && filterNeedsValue(op) && (
              <input
                type={column.kind === "number" ? "number" : column.kind === "date" ? "date" : "text"}
                aria-label="Filter value"
                placeholder="Value"
                value={filter.value}
                onChange={(event) => set(filter.id, { op, value: event.target.value })}
              />
            )}
            <button
              type="button"
              className="vault-remove"
              aria-label="Remove filter"
              title="Remove filter"
              onClick={() => onChange(filters.filter((item) => item.id !== filter.id))}
            >
              <RemoveIcon />
            </button>
          </div>
        )
      })}
      <div className="vault-filter-actions">
        <button
          type="button"
          className="button secondary vault-small"
          disabled={table.columns.length === 0}
          onClick={() => onChange([...filters, newFilter(table.columns[0])])}
        >
          <PlusIcon /> Filter
        </button>
        {filters.length > 0 && (
          <button type="button" className="button secondary vault-small" onClick={() => onChange([])}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}

/** Marks a cell whose value is also in other rows; clicking it lists those rows together. */
function RepeatedMark({ others, column, onShow }: { others: number; column: VaultColumn; onShow: () => void }) {
  const text = `Same ${column.name || "value"} as ${others === 1 ? "1 other row" : `${others} other rows`}`
  return (
    <button type="button" className="vault-repeated-mark" aria-label={`${text}. Show them together.`} title={`${text}. Click to show them together.`} onClick={onShow}>
      <DuplicatesIcon />
    </button>
  )
}

/** Which columns to compare when looking for duplicate rows, and what was found. */
function DuplicatesBar({
  table,
  columnIds,
  rowCount,
  groupCount,
  onChange,
  onClose,
}: {
  table: VaultTable
  columnIds: string[]
  rowCount: number
  groupCount: number
  onChange: (columnIds: string[]) => void
  onClose: () => void
}) {
  const all = columnIds.length === table.columns.length
  return (
    <div className="vault-filters vault-duplicates" role="group" aria-label="Duplicates">
      <div className="vault-duplicates-head">
        <strong>Rows with the same</strong>
        <button
          type="button"
          className="vault-chip"
          aria-pressed={all}
          onClick={() => onChange(table.columns.map((column) => column.id))}
        >
          All columns
        </button>
        {table.columns.map((column) => {
          const on = !all && columnIds.includes(column.id)
          return (
            <button
              key={column.id}
              type="button"
              className="vault-chip"
              aria-pressed={on}
              onClick={() =>
                // From "All columns", picking one compares just that column; otherwise it toggles.
                onChange(all ? [column.id] : on ? columnIds.filter((id) => id !== column.id) : [...columnIds, column.id])
              }
            >
              {column.name || "Untitled"}
            </button>
          )
        })}
      </div>
      <p className="hint" role="status">
        {columnIds.length === 0
          ? "Pick at least one column to compare."
          : groupCount === 0
            ? "No duplicates found."
            : `${rowCount} rows in ${groupCount} group${groupCount === 1 ? "" : "s"} have the same values. Rows with the same values are listed together.`}{" "}
        Capitals and extra spaces are ignored.
      </p>
      <div className="vault-filter-actions">
        <button type="button" className="button secondary vault-small" onClick={onClose}>
          Show all rows
        </button>
      </div>
    </div>
  )
}

function TableEditor({ vault, table }: { vault: VaultState; table: VaultTable }) {
  const change = (next: (current: VaultTable) => VaultTable) => vault.updateTable(table.id, next)
  const { editing } = vault
  const [query, setQuery] = useState("")
  const [fit, setFit] = useState(readFit)
  const [markRepeated, setMarkRepeated] = useState(() => readMarkRepeated(table.id))

  function toggleMarkRepeated() {
    const next = !markRepeated
    setMarkRepeated(next)
    try {
      // Only "off" is stored; on is the default, so tables never turned off leave nothing behind.
      if (next) localStorage.removeItem(repeatedKey(table.id))
      else localStorage.setItem(repeatedKey(table.id), "false")
    } catch {
      // Not remembered; the choice still applies until the page is closed.
    }
  }
  const filters = vault.filtersOf(table.id)
  const setFilters = (next: VaultFilter[]) => vault.setTableFilters(table.id, next)
  // The filter rules show under the toolbar; open from the start when the table already has some.
  const [showFilters, setShowFilters] = useState(filters.length > 0)
  // The columns compared when looking for duplicate rows; null when the check is off.
  const [duplicateColumnIds, setDuplicateColumnIds] = useState<string[] | null>(null)

  function toggleFit() {
    const next = !fit
    setFit(next)
    try {
      localStorage.setItem(FIT_KEY, String(next))
    } catch {
      // Not remembered; the choice still applies until the page is closed.
    }
  }
  // In Edit, the column the rows were last sorted by, to show its arrow; moving a row by hand clears it.
  // In View, sorting only changes how the rows are shown, not their saved order.
  const [sorted, setSorted] = useState<{ columnId: string; direction: SortDirection } | null>(null)

  // A View sort was never applied to the rows, so its arrow would be wrong in Edit, and the other way round.
  useEffect(() => setSorted(null), [editing])
  // The row being dragged, and where it would land: before the row at `target`, or last.
  const [drag, setDrag] = useState<{ id: string; target: number } | null>(null)
  // The same for a column being dragged sideways: it would land before the column at `target`.
  const [columnDrag, setColumnDrag] = useState<{ id: string; target: number } | null>(null)
  const [focusGrip, setFocusGrip] = useState<string | null>(null)
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const tables = vault.data?.tables ?? []
  /** Where a Link column points, for showing, searching, and following its cells. */
  function linkFor(column: VaultColumn): LinkTarget | undefined {
    if (!linksRows(column.kind)) return undefined
    const target = tables.find((item) => item.id === column.target) ?? null
    return {
      table: target,
      label: (rowId) => (target ? rowLabel(target, rowId) : null),
      open: (rowId) => target && vault.openRow(target.id, rowId),
    }
  }
  const links = new Map(table.columns.map((column) => [column.id, linkFor(column)]))
  const labelIn = (column: VaultColumn) => (rowId: string) => links.get(column.id)?.label(rowId) ?? ""

  const search = query.trim().toLowerCase()
  const columnById = new Map(table.columns.map((column) => [column.id, column]))
  // Duplicates are found across the whole table, then search and filters narrow what is shown.
  const duplicateColumns = (duplicateColumnIds ?? [])
    .map((id) => columnById.get(id))
    .filter((column): column is VaultColumn => column !== undefined)
  const duplicates =
    duplicateColumnIds && duplicateColumns.length > 0 ? findDuplicates(table.rows, duplicateColumns) : null
  const duplicateGroups = duplicates ? new Set(duplicates.values()).size : 0
  // Always on: every cell whose value also appears in another row of its column is marked.
  const repeated = useMemo(
    () => (markRepeated ? duplicateCells(table.rows, table.columns) : new Map<string, Map<string, number>>()),
    [markRepeated, table.rows, table.columns],
  )
  const candidates = duplicateColumnIds ? table.rows.filter((row) => duplicates?.has(row.id)) : table.rows
  const filtered = filters.length
    ? candidates.filter((row) =>
        filters.every((filter) => {
          const column = columnById.get(filter.columnId)
          return passesFilter(row, column, filter, column && labelIn(column))
        }),
      )
    : candidates
  const matching = search
    ? filtered.filter((row) =>
        table.columns.some((column) =>
          (column.kind === "subtable"
            ? subTableText(row.cells[column.id] ?? null, column.columns ?? [])
            : cellText(row.cells[column.id] ?? null, column.kind, labelIn(column))
          )
            .toLowerCase()
            .includes(search),
        ),
      )
    : filtered
  const viewSortColumn = !editing && sorted ? table.columns.find((column) => column.id === sorted.columnId) : undefined
  const shown =
    viewSortColumn && sorted
      ? sortRows(matching, viewSortColumn, sorted.direction, labelIn(viewSortColumn))
      : duplicates
        ? // Each group of duplicates is listed together, groups in the order they first appear.
          [...matching].sort((a, b) => duplicates.get(a.id)! - duplicates.get(b.id)!)
        : matching
  // Reordering by hand only makes sense when every row is on screen.
  const canMove = editing && !duplicateColumnIds && shown.length === table.rows.length && table.rows.length > 1
  // Grip and delete columns either side of the cells, in Edit only.
  // The No column, plus the row handles and row actions while editing.
  const extraColumns = editing ? 3 : 1
  // Where to draw the drop line; none when letting go would leave the row where it is.
  const dragFrom = drag ? table.rows.findIndex((row) => row.id === drag.id) : -1
  const dropAt = drag && drag.target !== dragFrom && drag.target !== dragFrom + 1 ? drag.target : null
  const columnFrom = columnDrag ? table.columns.findIndex((column) => column.id === columnDrag.id) : -1
  const columnDropAt =
    columnDrag && columnDrag.target !== columnFrom && columnDrag.target !== columnFrom + 1 ? columnDrag.target : null
  /** Classes that mark the dragged column and draw the drop line, on its header and every cell. */
  const columnClass = (column: VaultColumn, index: number) =>
    [
      columnDrag?.id === column.id && "vault-col-dragged",
      columnDropAt === index && "vault-col-drop-before",
      columnDropAt === table.columns.length && index === table.columns.length - 1 && "vault-col-drop-after",
    ]
      .filter(Boolean)
      .join(" ") || undefined

  // After following a Link here, show every row, then scroll to the linked one and highlight it.
  const [highlight, setHighlight] = useState<string | null>(null)
  const focusRow = vault.focusRow?.tableId === table.id ? vault.focusRow.rowId : null
  const { clearFocusRow } = vault
  useEffect(() => {
    if (!focusRow) return
    setQuery("")
    setHighlight(focusRow)
    clearFocusRow()
  }, [focusRow, clearFocusRow])
  useEffect(() => {
    if (!highlight) return
    bodyRef.current?.querySelector(`[data-row-id="${highlight}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" })
    const timer = window.setTimeout(() => setHighlight(null), 2000)
    return () => window.clearTimeout(timer)
  }, [highlight])

  // Keep focus on a row's or column's handle after moving it with the keyboard.
  useEffect(() => {
    if (!focusGrip) return
    wrapRef.current?.querySelector<HTMLButtonElement>(`[data-grip="${focusGrip}"]`)?.focus()
    setFocusGrip(null)
  }, [focusGrip])

  function sortBy(column: VaultColumn) {
    const direction: SortDirection =
      sorted?.columnId === column.id && sorted.direction === "asc" ? "desc" : "asc"
    setSorted({ columnId: column.id, direction })
    if (editing) change((current) => ({ ...current, rows: sortRows(current.rows, column, direction, labelIn(column)) }))
  }

  function moveRow(id: string, to: number) {
    const from = table.rows.findIndex((row) => row.id === id)
    if (from === -1 || from === to || from + 1 === to) return
    setSorted(null)
    change((current) => ({ ...current, rows: moveBefore(current.rows, from, to) }))
  }

  /** Where a dragged row would land for a pointer at this height. */
  function dropIndex(clientY: number) {
    const rows = [...(bodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr[data-row]") ?? [])]
    const index = rows.findIndex((row) => {
      const box = row.getBoundingClientRect()
      return clientY < box.top + box.height / 2
    })
    return index === -1 ? rows.length : index
  }

  function moveColumn(id: string, to: number) {
    const from = table.columns.findIndex((column) => column.id === id)
    if (from === -1 || from === to || from + 1 === to) return
    change((current) => ({ ...current, columns: moveBefore(current.columns, from, to) }))
  }

  /** Where a dragged column would land for a pointer at this position. */
  function columnDropIndex(clientX: number) {
    const headers = [...(wrapRef.current?.querySelectorAll<HTMLTableCellElement>("th[data-column]") ?? [])]
    const index = headers.findIndex((header) => {
      const box = header.getBoundingClientRect()
      return clientX < box.left + box.width / 2
    })
    return index === -1 ? headers.length : index
  }

  function onColumnGripMove(event: PointerEvent<HTMLButtonElement>) {
    if (!columnDrag) return
    // Scroll the grid when dragging near its left or right edge.
    const wrap = wrapRef.current
    if (wrap) {
      const box = wrap.getBoundingClientRect()
      if (event.clientX < box.left + 40) wrap.scrollBy(-12, 0)
      else if (event.clientX > box.right - 40) wrap.scrollBy(12, 0)
    }
    const target = columnDropIndex(event.clientX)
    if (target !== columnDrag.target) setColumnDrag({ ...columnDrag, target })
  }

  function onGripMove(event: PointerEvent<HTMLButtonElement>) {
    if (!drag) return
    // Scroll the grid when dragging near its top or bottom edge.
    const wrap = wrapRef.current
    if (wrap) {
      const box = wrap.getBoundingClientRect()
      if (event.clientY < box.top + 40) wrap.scrollBy(0, -12)
      else if (event.clientY > box.bottom - 24) wrap.scrollBy(0, 12)
    }
    const target = dropIndex(event.clientY)
    if (target !== drag.target) setDrag({ ...drag, target })
  }

  function setColumn(columnId: string, patch: Partial<VaultColumn>) {
    change((current) => ({
      ...current,
      columns: current.columns.map((column) => (column.id === columnId ? { ...column, ...patch } : column)),
    }))
  }

  function setKind(columnId: string, kind: VaultColumnKind) {
    const before = table.columns.find((column) => column.id === columnId)
    if (!before || before.kind === kind) return
    if (
      before.kind === "subtable" &&
      table.rows.some((row) => subRows(row.cells[columnId]).length > 0) &&
      !window.confirm(
        `Changing the type of "${before.name}" clears the items inside it. You can still discard this before you save.`,
      )
    ) {
      return
    }
    const label = labelIn(before)
    // A new Link points at another table first, or at this one when it is the only table. Switching
    // between Link and List of links keeps the table.
    const target = linksRows(kind)
      ? (linksRows(before.kind) && before.target) || (tables.find((item) => item.id !== table.id) ?? table).id
      : undefined
    const convert = (value: VaultCell): VaultCell => {
      // Between Link and List of links, the linked rows stay linked (a Link keeps the first one).
      if (linksRows(before.kind) && linksRows(kind)) {
        const ids = typeof value === "string" ? [value] : listItems(value)
        return kind === "links" ? (ids.length > 0 ? ids : null) : (ids[0] ?? null)
      }
      // Links become the names they showed; everything else converts by value.
      if (before.kind === "link") return convertCell(typeof value === "string" ? label(value) || null : null, kind)
      if (before.kind === "links") {
        const names = listItems(value).map(label).filter(Boolean)
        return convertCell(names.length > 0 ? names : null, kind)
      }
      return convertCell(value, kind)
    }
    change((current) => ({
      ...current,
      columns: current.columns.map((column) =>
        column.id === columnId
          ? {
              id: column.id,
              name: column.name,
              kind,
              ...(target ? { target } : {}),
              // A new Sub-table starts with one column to fill in.
              ...(kind === "subtable" ? { columns: [newColumn("Name")] } : {}),
            }
          : column,
      ),
      rows: current.rows.map((row) =>
        columnId in row.cells ? { ...row, cells: { ...row.cells, [columnId]: convert(row.cells[columnId]) } } : row,
      ),
    }))
  }

  /** Points a Link column at another table. Its cells named rows of the old one, so they are cleared. */
  function setTarget(columnId: string, target: string) {
    change((current) => ({
      ...current,
      columns: current.columns.map((column) => (column.id === columnId ? { ...column, target } : column)),
      rows: current.rows.map((row) => {
        const { [columnId]: _cleared, ...cells } = row.cells
        return { ...row, cells }
      }),
    }))
  }

  /**
   * Changes a Sub-table column's own columns. Values of a removed sub-column are dropped, and a
   * sub-column whose type changed has its values converted, inside every cell of the column.
   */
  function setSubColumns(columnId: string, columns: VaultColumn[], convert?: { columnId: string; kind: VaultSubKind }) {
    const kept = new Set(columns.map((sub) => sub.id))
    const fix = (row: VaultRow): VaultRow => ({
      ...row,
      cells: Object.fromEntries(
        Object.entries(row.cells)
          .filter(([id]) => kept.has(id))
          .map(([id, value]) => [id, convert?.columnId === id ? convertCell(value, convert.kind) : value]),
      ),
    })
    change((current) => ({
      ...current,
      columns: current.columns.map((column) => (column.id === columnId ? { ...column, columns } : column)),
      rows: current.rows.map((row) => {
        const inner = subRows(row.cells[columnId])
        return inner.length > 0 ? { ...row, cells: { ...row.cells, [columnId]: inner.map(fix) } } : row
      }),
    }))
  }

  function addColumn() {
    change((current) => ({ ...current, columns: [...current.columns, newColumn(`Column ${current.columns.length + 1}`)] }))
    // Show the new column, which is added at the far right.
    window.requestAnimationFrame(() => wrapRef.current?.scrollTo({ left: wrapRef.current.scrollWidth, behavior: "smooth" }))
  }

  function addRow() {
    // A new, empty row would not match the search, filters or duplicates, so show every row again.
    setQuery("")
    setFilters([])
    setDuplicateColumnIds(null)
    change((current) => ({ ...current, rows: [...current.rows, newRow()] }))
    // Show the new row, which is added at the bottom.
    window.requestAnimationFrame(() => wrapRef.current?.scrollTo({ top: wrapRef.current.scrollHeight, behavior: "smooth" }))
  }

  function removeColumn(columnId: string) {
    change((current) => ({
      ...current,
      columns: current.columns.filter((column) => column.id !== columnId),
      rows: current.rows.map((row) => {
        const { [columnId]: _removed, ...cells } = row.cells
        return { ...row, cells }
      }),
    }))
  }

  function setCell(rowId: string, columnId: string, value: VaultCell) {
    change((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row.id === rowId ? { ...row, cells: { ...row.cells, [columnId]: value } } : row,
      ),
    }))
  }

  return (
    <div className="vault-body">
      <div className="vault-toolbar">
        {editing && (
          <input
            className="vault-table-name"
            aria-label="Table name"
            value={table.name}
            onChange={(event) => change((current) => ({ ...current, name: event.target.value }))}
          />
        )}
        {editing && (
          <>
            <input
              className="vault-table-category"
              aria-label="Category"
              placeholder="Category"
              title="Tables with the same category are listed together"
              list="vault-categories"
              value={table.category ?? ""}
              onChange={(event) => change((current) => ({ ...current, category: event.target.value }))}
            />
            <datalist id="vault-categories">
              {vaultCategories(tables).map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </>
        )}
        <label className="vault-search">
          <SearchIcon />
          <input
            type="search"
            aria-label="Search rows"
            placeholder="Search rows"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("")
            }}
          />
        </label>
        <button
          type="button"
          className="button secondary vault-small vault-filter-toggle"
          aria-pressed={showFilters}
          aria-expanded={showFilters}
          title={filters.length > 0 ? `${filters.length} filter${filters.length === 1 ? "" : "s"} on` : "Filter rows"}
          onClick={() => {
            // Opening an empty filter bar starts a first rule right away.
            if (!showFilters && filters.length === 0 && table.columns.length > 0) setFilters([newFilter(table.columns[0])])
            // Closing it drops rules still waiting for a value, so the count only shows filters in use.
            if (showFilters) setFilters(filters.filter((filter) => !filterNeedsValue(filter.op) || filter.value.trim()))
            setShowFilters(!showFilters)
          }}
        >
          <FilterIcon /> Filter
          {filters.length > 0 && <span className="vault-filter-count">{filters.length}</span>}
        </button>
        <button
          type="button"
          className="button secondary vault-small vault-filter-toggle"
          aria-pressed={duplicateColumnIds !== null}
          title="Find rows with the same values"
          disabled={table.rows.length < 2 && duplicateColumnIds === null}
          onClick={() => setDuplicateColumnIds(duplicateColumnIds ? null : table.columns.map((column) => column.id))}
        >
          <DuplicatesIcon /> Duplicates
          {duplicateGroups > 0 && <span className="vault-filter-count">{duplicateGroups}</span>}
        </button>
        <button
          type="button"
          className="button secondary vault-small vault-icon-button vault-fit-toggle"
          aria-pressed={markRepeated}
          aria-label="Mark repeated values"
          title={
            markRepeated
              ? "This table marks values that also appear in another row of the same column. Click to turn this off for this table."
              : "This table does not mark repeated values. Click to mark values that also appear in another row of the same column."
          }
          onClick={toggleMarkRepeated}
        >
          <RepeatedIcon />
        </button>
        <button
          type="button"
          className="button secondary vault-small vault-icon-button vault-fit-toggle"
          aria-pressed={fit}
          aria-label="Fit to width"
          title={
            fit
              ? "Columns fit the page and long values wrap. Click to keep each value on one line and scroll sideways."
              : "Each value stays on one line and wide tables scroll sideways. Click to fit columns to the page."
          }
          onClick={toggleFit}
        >
          <FitWidthIcon />
        </button>
        {editing && (
          <>
            <button
              type="button"
              className="button danger vault-small vault-icon-button"
              aria-label="Delete table"
              title="Delete table"
              onClick={() => {
                if (window.confirm(`Delete the table "${table.name || "Untitled"}"? You can still discard this before you save.`)) {
                  vault.removeTable(table.id)
                }
              }}
            >
              <TrashIcon />
            </button>
          </>
        )}
      </div>
      {showFilters && table.columns.length > 0 && <FilterBar table={table} filters={filters} onChange={setFilters} />}
      {duplicateColumnIds && table.columns.length > 0 && (
        <DuplicatesBar
          table={table}
          columnIds={duplicateColumns.map((column) => column.id)}
          rowCount={duplicates?.size ?? 0}
          groupCount={duplicateGroups}
          onChange={setDuplicateColumnIds}
          onClose={() => setDuplicateColumnIds(null)}
        />
      )}
      {table.columns.length === 0 ? (
        <p className="hint vault-note">
          {editing ? (
            <button type="button" className="button secondary vault-small" onClick={addColumn}>
              <PlusIcon /> Add a column
            </button>
          ) : (
            "This table has no columns yet. Click Edit to add some."
          )}
        </p>
      ) : (
        <div className="vault-grid-wrap" ref={wrapRef}>
          <table
            className={["vault-grid", !editing && "vault-viewing", fit && "vault-fit", columnDrag && "vault-col-dragging"]
              .filter(Boolean)
              .join(" ")}
          >
            <colgroup>
              {editing && <col />}
              <col />
              {table.columns.map((column, columnIndex) => (
                <col key={column.id} className={altColumn(columnIndex)} />
              ))}
              {editing && <col />}
            </colgroup>
            <thead>
              <tr>
                {editing && <th className="vault-grip-cell" aria-label="Move rows" />}
                <th scope="col" className="vault-no">
                  No
                </th>
                {table.columns.map((column, columnIndex) => (
                  <th
                    key={column.id}
                    scope="col"
                    data-column
                    className={[columnClass(column, columnIndex), altColumn(columnIndex)].filter(Boolean).join(" ") || undefined}
                  >
                    <div className="vault-col-head">
                      {editing && table.columns.length > 1 && (
                        <button
                          type="button"
                          className="vault-grip vault-col-grip"
                          data-grip={column.id}
                          aria-label={`Move column ${column.name}. Use the left and right arrow keys.`}
                          title="Drag to move, or use the arrow keys"
                          onPointerDown={(event) => {
                            if (event.button !== 0) return
                            event.preventDefault()
                            event.currentTarget.setPointerCapture(event.pointerId)
                            setColumnDrag({ id: column.id, target: columnIndex })
                          }}
                          onPointerMove={onColumnGripMove}
                          onPointerUp={() => {
                            if (columnDrag) moveColumn(columnDrag.id, columnDrag.target)
                            setColumnDrag(null)
                          }}
                          onPointerCancel={() => setColumnDrag(null)}
                          onKeyDown={(event) => {
                            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
                            event.preventDefault()
                            const to = event.key === "ArrowLeft" ? columnIndex - 1 : columnIndex + 2
                            if (to < 0 || to > table.columns.length) return
                            moveColumn(column.id, to)
                            setFocusGrip(column.id)
                          }}
                        >
                          <GripIcon />
                        </button>
                      )}
                      {editing ? (
                        <input
                          aria-label="Column name"
                          value={column.name}
                          onChange={(event) => setColumn(column.id, { name: event.target.value })}
                        />
                      ) : (
                        <span className="vault-col-name">{column.name}</span>
                      )}
                      <button
                        type="button"
                        className="vault-sort"
                        aria-label={`Sort by ${column.name}`}
                        aria-pressed={sorted?.columnId === column.id}
                        title={
                          sorted?.columnId === column.id && sorted.direction === "asc"
                            ? "Sort descending"
                            : "Sort ascending"
                        }
                        disabled={table.rows.length < 2 || column.kind === "password"}
                        onClick={() => sortBy(column)}
                      >
                        <SortIcon direction={sorted?.columnId === column.id ? sorted.direction : null} />
                      </button>
                      {editing && (
                        <button
                          type="button"
                          className="vault-remove"
                          aria-label={`Delete column ${column.name}`}
                          title="Delete column"
                          onClick={() => removeColumn(column.id)}
                        >
                          <RemoveIcon />
                        </button>
                      )}
                    </div>
                    {editing && (
                      <select
                        className="vault-kind"
                        aria-label={`Type of ${column.name}`}
                        value={column.kind}
                        onChange={(event) => setKind(column.id, event.target.value as VaultColumnKind)}
                      >
                        {VAULT_COLUMN_KINDS.map(({ id, label }) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    )}
                    {editing && column.kind === "subtable" && (
                      <SubColumnsButton
                        column={column}
                        onChange={(columns, convert) => setSubColumns(column.id, columns, convert)}
                      />
                    )}
                    {editing && linksRows(column.kind) && (
                      <select
                        className="vault-kind"
                        aria-label={`Table ${column.name} links to`}
                        title="Table this column links to"
                        value={column.target ?? ""}
                        onChange={(event) => setTarget(column.id, event.target.value)}
                      >
                        {!tables.some((item) => item.id === column.target) && <option value="">Choose a table</option>}
                        {tables.map((item) => (
                          <option key={item.id} value={item.id}>
                            → {item.name || "Untitled"}
                          </option>
                        ))}
                      </select>
                    )}
                  </th>
                ))}
                {editing && (
                  <th className="vault-row-actions">
                    <button type="button" className="vault-add" aria-label="Add column" title="Add column" onClick={addColumn}>
                      <PlusIcon />
                    </button>
                  </th>
                )}
              </tr>
            </thead>
            <tbody ref={bodyRef} className={drag ? "dragging" : undefined}>
              {shown.length === 0 ? (
                <tr>
                  <td className="vault-empty" colSpan={table.columns.length + extraColumns}>
                    {table.rows.length === 0
                      ? "No rows yet."
                      : duplicateColumnIds && !search && !filters.length
                        ? "No duplicate rows."
                        : search && filters.length
                        ? "No rows match your search and filters."
                        : search
                          ? "No rows match your search."
                          : "No rows match your filters."}
                  </td>
                </tr>
              ) : (
                shown.map((row, index) => (
                  <tr
                    key={row.id}
                    data-row
                    data-row-id={row.id}
                    className={
                      [
                        highlight === row.id && "vault-highlight",
                        // Alternate shading tells one group of duplicates from the next.
                        duplicates?.has(row.id) && (duplicates.get(row.id)! % 2 === 0 ? "vault-dup-even" : "vault-dup-odd"),
                        duplicates?.has(row.id) &&
                          index > 0 &&
                          duplicates.get(shown[index - 1].id) !== duplicates.get(row.id) &&
                          "vault-dup-start",
                        drag?.id === row.id && "vault-dragged",
                        dropAt === index && "vault-drop-before",
                        dropAt === shown.length && index === shown.length - 1 && "vault-drop-after",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                  >
                    {editing && (
                      <td className="vault-grip-cell">
                        {canMove && (
                          <button
                            type="button"
                            className="vault-grip"
                            data-grip={row.id}
                            aria-label="Move row. Use the up and down arrow keys."
                            title="Drag to move, or use the arrow keys"
                            onPointerDown={(event) => {
                              if (event.button !== 0) return
                              event.preventDefault()
                              event.currentTarget.setPointerCapture(event.pointerId)
                              setDrag({ id: row.id, target: index })
                            }}
                            onPointerMove={onGripMove}
                            onPointerUp={() => {
                              if (drag) moveRow(drag.id, drag.target)
                              setDrag(null)
                            }}
                            onPointerCancel={() => setDrag(null)}
                            onKeyDown={(event) => {
                              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
                              event.preventDefault()
                              const to = event.key === "ArrowUp" ? index - 1 : index + 2
                              if (to < 0 || to > shown.length) return
                              moveRow(row.id, to)
                              setFocusGrip(row.id)
                            }}
                          >
                            <GripIcon />
                          </button>
                        )}
                      </td>
                    )}
                    <td className="vault-no">{index + 1}</td>
                    {table.columns.map((column, columnIndex) => (
                      <td
                        key={column.id}
                        className={
                          [columnClass(column, columnIndex), repeated.get(column.id)?.has(row.id) && "vault-cell-repeated"]
                            .filter(Boolean)
                            .join(" ") || undefined
                        }
                      >
                        {editing ? (
                          <CellEditor
                            column={column}
                            value={row.cells[column.id] ?? null}
                            onChange={(value) => setCell(row.id, column.id, value)}
                            link={links.get(column.id)}
                          />
                        ) : (
                          <CopyableCell column={column} value={row.cells[column.id] ?? null} link={links.get(column.id)} />
                        )}
                        {repeated.get(column.id)?.has(row.id) && (
                          <RepeatedMark
                            others={repeated.get(column.id)!.get(row.id)!}
                            column={column}
                            onShow={() => setDuplicateColumnIds([column.id])}
                          />
                        )}
                      </td>
                    ))}
                    {editing && (
                      <td className="vault-row-actions">
                        <button
                          type="button"
                          className="vault-remove"
                          aria-label="Delete row"
                          title="Delete row"
                          onClick={() =>
                            change((current) => ({ ...current, rows: current.rows.filter((item) => item.id !== row.id) }))
                          }
                        >
                          <RemoveIcon />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
            {editing && (
              <tfoot>
                <tr>
                  <td className="vault-grip-cell">
                    <button type="button" className="vault-add" aria-label="Add row" title="Add row" onClick={addRow}>
                      <PlusIcon />
                    </button>
                  </td>
                  <td className="vault-add-row-rest" colSpan={table.columns.length + 2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}

export function Vault({ vault }: { vault: VaultState }) {
  const { save, dirty } = vault

  // Ctrl+S saves, as in most desktop apps.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        if (dirty) void save()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [dirty, save])

  if (!vault.available) {
    return (
      <section className="settings">
        <header className="thread-bar profile-bar">
          <h1>Vault</h1>
        </header>
        <p className="hint vault-note">Vault is only in the Novaroom desktop app.</p>
      </section>
    )
  }

  const opened = vault.file && vault.data

  return (
    <section className="settings vault">
      <header className="thread-bar profile-bar">
        <div className="vault-title">
          <h1>{opened ? vault.table?.name || "Vault" : "Vault"}</h1>
          {opened && (
            <p className="thread-email vault-path" title={vault.file!}>
              {/* Marks keep the path in reading order while long ones are cut from the start. */}
              <span className="vault-path-text">{`‎${vault.file}‎`}</span>
              {vault.dirty && <span className="vault-unsaved"> · Unsaved changes</span>}
            </p>
          )}
        </div>
        {opened && (
          <div className="profile-bar-actions">
            <button
              type="button"
              className="bar-icon"
              aria-label="Open another Vault file"
              title="Open another Vault file"
              onClick={() => vault.chooseFile("open")}
            >
              <OpenFileIcon />
            </button>
            <button
              type="button"
              className="bar-icon"
              aria-label="Create a new Vault file"
              title="Create a new Vault file"
              onClick={() => vault.chooseFile("create")}
            >
              <NewFileIcon />
            </button>
            <button
              type="button"
              className="bar-icon vault-save"
              aria-label="Save (Ctrl+S)"
              title={vault.dirty ? "Save (Ctrl+S)" : vault.editing ? "Done editing" : "All changes saved"}
              // In Edit it stays on, so it also leaves Edit when there is nothing to save.
              disabled={(!vault.dirty && !vault.editing) || vault.saving}
              onClick={() => {
                void vault.save().then((ok) => {
                  if (ok) vault.setEditing(false)
                })
              }}
            >
              <SaveIcon />
              {vault.dirty && <span className="vault-dot" aria-hidden="true" />}
            </button>
            {vault.table &&
              (vault.editing ? (
                <button
                  type="button"
                  className="bar-icon vault-cancel"
                  aria-label="Cancel editing"
                  title="Cancel editing"
                  // With unsaved changes, first asks whether to save or discard them.
                  onClick={() => vault.guard(() => vault.setEditing(false))}
                >
                  <CancelIcon />
                </button>
              ) : (
                <button
                  type="button"
                  className="bar-icon"
                  aria-label="Edit table"
                  title="Edit table"
                  onClick={() => vault.setEditing(true)}
                >
                  <EditIcon />
                </button>
              ))}
          </div>
        )}
      </header>
      {vault.error && (
        <p className="form-error vault-note" role="alert">
          {vault.error}
        </p>
      )}
      {vault.loading ? (
        <div className="page-loading" role="status" aria-label="Opening your Vault">
          <span className="loading-spinner" aria-hidden="true" />
        </div>
      ) : !opened ? (
        <div className="settings-panel vault-welcome">
          <h2>Keep important data on your computer</h2>
          <p className="hint">
            Your Vault is a file on this computer. It is never uploaded to the cloud. Choose where to keep it, or
            open a Vault file you already have.
          </p>
          <div className="form-actions">
            <button type="button" className="button" onClick={() => vault.chooseFile("create")}>
              Create a Vault file
            </button>
            <button type="button" className="button secondary" onClick={() => vault.chooseFile("open")}>
              Open a Vault file
            </button>
          </div>
        </div>
      ) : vault.table ? (
        <TableEditor key={vault.table.id} vault={vault} table={vault.table} />
      ) : (
        <div className="settings-panel">
          <p className="hint">This Vault has no tables yet.</p>
          <div className="form-actions">
            <button type="button" className="button" onClick={vault.addTable}>
              Create a table
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/** Asks whether to save or discard unsaved Vault changes before leaving them behind. */
export function VaultLeaveDialog({ vault }: { vault: VaultState }) {
  const { pending, setPending } = vault

  useEffect(() => {
    if (!pending) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPending(null)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [pending, setPending])

  if (!pending) return null

  return (
    <div className="desk-backdrop" onPointerDown={(event) => event.target === event.currentTarget && setPending(null)}>
      <div className="desk-modal" role="alertdialog" aria-labelledby="vault-leave-title" aria-describedby="vault-leave-text">
        <h2 id="vault-leave-title">Save changes to your Vault?</h2>
        <p className="hint" id="vault-leave-text">
          You have changes that are not saved to {vault.file ? fileName(vault.file) : "your Vault file"} yet. If you
          discard them, they are lost.
        </p>
        {vault.error && (
          <p className="form-error" role="alert">
            {vault.error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" disabled={vault.saving} onClick={() => setPending(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="button danger"
            disabled={vault.saving}
            onClick={() => {
              vault.discard()
              setPending(null)
              pending.run()
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className="button"
            disabled={vault.saving}
            autoFocus
            onClick={() => {
              void vault.save().then((ok) => {
                if (!ok) return
                setPending(null)
                pending.run()
              })
            }}
          >
            {vault.saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}
