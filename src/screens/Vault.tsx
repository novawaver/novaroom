import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react"
import {
  VAULT_COLUMN_KINDS,
  cellText,
  convertCell,
  createVaultFile,
  fileName,
  moveBefore,
  newColumn,
  newRow,
  newTable,
  pickVaultFile,
  looksLikeEmail,
  readVault,
  rememberVaultFile,
  rememberedVaultFile,
  rowLabel,
  sortRows,
  vaultAvailable,
  writeVault,
  type VaultCell,
  type VaultColumn,
  type SortDirection,
  type VaultColumnKind,
  type VaultData,
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
    const created = newTable(`Table ${data.tables.length + 1}`)
    update((current) => ({ tables: [...current.tables, created] }))
    setTableId(created.id)
    setEditing(true)
  }

  function removeTable(id: string) {
    if (!data) return
    const index = data.tables.findIndex((item) => item.id === id)
    const removed = data.tables[index]
    // Links into the deleted table become Text holding the names they showed, so nothing is lost.
    const rest = data.tables
      .filter((item) => item.id !== id)
      .map((item) => {
        const orphaned = item.columns.filter((column) => column.kind === "link" && column.target === id)
        if (orphaned.length === 0) return item
        return {
          ...item,
          columns: item.columns.map((column) =>
            orphaned.includes(column) ? { id: column.id, name: column.name, kind: "text" as const } : column,
          ),
          rows: item.rows.map((row) => {
            const cells = { ...row.cells }
            for (const column of orphaned) {
              const value = cells[column.id]
              cells[column.id] = typeof value === "string" ? rowLabel(removed, value) : null
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
    case "date":
      return typeof value === "string" ? formatDate(value) : ""
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

function openEmail(address: string) {
  void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(`mailto:${address}`))
}

function CellView({ column, value, link }: { column: VaultColumn; value: VaultCell; link?: LinkTarget }) {
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

function TableEditor({ vault, table }: { vault: VaultState; table: VaultTable }) {
  const change = (next: (current: VaultTable) => VaultTable) => vault.updateTable(table.id, next)
  const { editing } = vault
  const [query, setQuery] = useState("")
  const [fit, setFit] = useState(readFit)

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
    if (column.kind !== "link") return undefined
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
  const matching = search
    ? table.rows.filter((row) =>
        table.columns.some((column) =>
          cellText(row.cells[column.id] ?? null, column.kind, labelIn(column)).toLowerCase().includes(search),
        ),
      )
    : table.rows
  const viewSortColumn = !editing && sorted ? table.columns.find((column) => column.id === sorted.columnId) : undefined
  const shown =
    viewSortColumn && sorted
      ? sortRows(matching, viewSortColumn, sorted.direction, labelIn(viewSortColumn))
      : matching
  // Reordering by hand only makes sense when every row is on screen.
  const canMove = editing && !search && table.rows.length > 1
  // Grip and delete columns either side of the cells, in Edit only.
  const extraColumns = editing ? 2 : 0
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
    const label = labelIn(before)
    // A new Link points at another table first, or at this one when it is the only table.
    const target = kind === "link" ? (tables.find((item) => item.id !== table.id) ?? table).id : undefined
    const convert = (value: VaultCell): VaultCell =>
      // A Link becomes the names it showed; everything else converts by value.
      before.kind === "link" ? convertCell(typeof value === "string" ? label(value) || null : null, kind) : convertCell(value, kind)
    change((current) => ({
      ...current,
      columns: current.columns.map((column) =>
        column.id === columnId ? { id: column.id, name: column.name, kind, ...(target ? { target } : {}) } : column,
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
              className="button secondary vault-small"
              onClick={() =>
                change((current) => ({ ...current, columns: [...current.columns, newColumn(`Column ${current.columns.length + 1}`)] }))
              }
            >
              <PlusIcon /> Column
            </button>
            <button
              type="button"
              className="button secondary vault-small"
              disabled={table.columns.length === 0}
              onClick={() => {
                // A new, empty row would not match the search, so show every row again.
                setQuery("")
                change((current) => ({ ...current, rows: [...current.rows, newRow()] }))
              }}
            >
              <PlusIcon /> Row
            </button>
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
      {table.columns.length === 0 ? (
        <p className="hint vault-note">
          {editing ? "Add a column to start this table." : "This table has no columns yet. Switch to Edit to add some."}
        </p>
      ) : (
        <div className="vault-grid-wrap" ref={wrapRef}>
          <table
            className={["vault-grid", !editing && "vault-viewing", fit && "vault-fit", columnDrag && "vault-col-dragging"]
              .filter(Boolean)
              .join(" ")}
          >
            <thead>
              <tr>
                {editing && <th className="vault-grip-cell" aria-label="Move rows" />}
                {table.columns.map((column, columnIndex) => (
                  <th key={column.id} scope="col" data-column className={columnClass(column, columnIndex)}>
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
                    {editing && column.kind === "link" && (
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
                {editing && <th className="vault-row-actions" aria-label="Row actions" />}
              </tr>
            </thead>
            <tbody ref={bodyRef} className={drag ? "dragging" : undefined}>
              {shown.length === 0 ? (
                <tr>
                  <td className="vault-empty" colSpan={table.columns.length + extraColumns}>
                    {table.rows.length === 0 ? "No rows yet." : "No rows match your search."}
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
                    {table.columns.map((column, columnIndex) => (
                      <td key={column.id} className={columnClass(column, columnIndex)}>
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
            {vault.table && (
              <div className="vault-mode" role="group" aria-label="Mode">
                <button type="button" aria-pressed={!vault.editing} onClick={() => vault.setEditing(false)}>
                  View
                </button>
                <button type="button" aria-pressed={vault.editing} onClick={() => vault.setEditing(true)}>
                  Edit
                </button>
              </div>
            )}
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
              title={vault.dirty ? "Save (Ctrl+S)" : "All changes saved"}
              disabled={!vault.dirty || vault.saving}
              onClick={() => void vault.save()}
            >
              <SaveIcon />
              {vault.dirty && <span className="vault-dot" aria-hidden="true" />}
            </button>
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
