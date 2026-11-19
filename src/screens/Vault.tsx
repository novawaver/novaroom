import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import {
  VAULT_COLUMN_KINDS,
  VAULT_SUB_KINDS,
  searchVault,
  type VaultHit,
  attachVaultFiles,
  attachmentName,
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
  importedTables,
  importedJsonTables,
  pickExcelFile,
  pickJsonFile,
  groupTables,
  mergePlan,
  mergeTables,
  openVaultAttachment,
  passesFilter,
  pickVaultFile,
  linksRows,
  listItems,
  looksLikeEmail,
  webAddress,
  readVault,
  rememberVaultFile,
  rememberedVaultFile,
  isImageAttachment,
  showsPreview,
  vaultAttachmentPreview,
  revealVaultAttachment,
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
import { listUsers } from "../lib/users"
import { localAvatars, localPeers } from "../lib/localChat"
import {
  SHARE_NOTE_LIMIT,
  cancelLocalShare,
  listLocalShares,
  listSentShares,
  listShares,
  pickShared,
  removeLocalShare,
  removeShare,
  sendLocalShares,
  sendShares,
  sharedAs,
  sharedTable,
  subscribeToLocalShares,
  subscribeToShares,
  tableFromShare,
  type SentShare,
  type ShareVia,
  type SharedTable,
  type VaultShare,
} from "../lib/vaultShare"
import { ImageViewer } from "./ImageViewer"

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

function CardsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  )
}

// Whether a table shows its rows as cards instead of a grid. Set per table on this computer, so
// switching never leaves the Vault file with unsaved changes.
const cardsKey = (tableId: string) => `novaroom.vault-cards.${tableId}`

function readCards(tableId: string) {
  try {
    return localStorage.getItem(cardsKey(tableId)) === "true"
  } catch {
    return false
  }
}

// The columns a table's cards show, in column order; nothing stored means the first few filled-in
// values. Set per table on this computer, like the Cards view itself.
const cardFieldsKey = (tableId: string) => `novaroom.vault-card-fields.${tableId}`

function readCardFields(tableId: string): string[] | null {
  try {
    const stored = JSON.parse(localStorage.getItem(cardFieldsKey(tableId)) ?? "null")
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : null
  } catch {
    return null
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

// Whether a table shows the items of its Sub-table cells in the cells themselves.
const subInlineKey = (tableId: string) => `novaroom.vault-sub-inline.${tableId}`

function readSubInline(tableId: string) {
  try {
    return localStorage.getItem(subInlineKey(tableId)) === "true"
  } catch {
    return false
  }
}

// Column widths set by dragging a header's edge, by column id. Kept on this computer, like the other
// choices about how a table is shown, so resizing never counts as a change to the Vault file.
const widthsKey = (tableId: string) => `novaroom.vault-widths.${tableId}`
const MIN_COLUMN_WIDTH = 60

function readWidths(tableId: string): Record<string, number> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(widthsKey(tableId)) ?? "{}")
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {}
    return Object.fromEntries(
      Object.entries(saved).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] >= MIN_COLUMN_WIDTH,
      ),
    )
  } catch {
    return {}
  }
}

// Columns fixed in place, so scrolling sideways never hides them. Kept on this computer per table,
// like column widths.
const fixedKey = (tableId: string) => `novaroom.vault-fixed.${tableId}`

function readFixed(tableId: string): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(fixedKey(tableId)) ?? "[]")
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}

// The tables shown beside the open one and whether they are stacked, per Vault file on this computer.
const splitKey = (file: string) => `novaroom.vault-split.${file}`
const MAX_PANES = 4

function readSplit(file: string): { ids: string[]; stacked: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(splitKey(file)) ?? "null")
    const ids = Array.isArray(saved?.ids) ? saved.ids.filter((id: unknown): id is string => typeof id === "string") : []
    return { ids, stacked: saved?.stacked === true }
  } catch {
    return { ids: [], stacked: false }
  }
}

/** A pin: the column stays in place while the table scrolls sideways. */
function FixIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4.5h6l-1 5.5 3 3.5H7l3-3.5-1-5.5zM12 13.5V20" />
    </svg>
  )
}

function AddRowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="14.5" width="16" height="5.5" rx="1.5" />
      <path d="M12 3.5v7M8.5 7h7" />
    </svg>
  )
}

function AddColumnIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="14.5" y="4" width="5.5" height="16" rx="1.5" />
      <path d="M7 8.5v7M3.5 12h7" />
    </svg>
  )
}

function MergeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4.5v3a6 6 0 0 0 6 6M18 4.5v3a6 6 0 0 1-6 6v6M9 17l3 3 3-3" />
    </svg>
  )
}

/** Two panes, side by side or one above the other. */
function PanesIcon({ stacked }: { stacked?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d={stacked ? "M3.5 12h17" : "M12 4.5v15"} />
    </svg>
  )
}

/** A pane with a plus beside it: show another table. */
function AddPaneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="10" height="15" rx="2" />
      <path d="M18.5 9v6M15.5 12h6" />
    </svg>
  )
}

/** A table row with a smaller table hanging under it: Sub-table items shown in their cells. */
function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.5" cy="5.5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.5" cy="18.5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m8.2 10.8 7.1-4.1M8.2 13.2l7.1 4.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function InboxIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 13.5 6.4 6h11.2l2.4 7.5V18H4v-4.5Zm0 0h4.5a3.5 3.5 0 0 0 7 0H20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SubRowsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4" width="17" height="6" rx="1.5" />
      <path d="M7 10v7.5h13.5M11.5 13.5h9" />
    </svg>
  )
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
  // Tables shown beside the open one, each in its own pane, and whether the panes are stacked.
  const [split, setSplit] = useState<string[]>([])
  const [stacked, setStacked] = useState(false)
  // What other people have shared with this person and they have not removed yet.
  const [shares, setShares] = useState<VaultShare[]>([])
  // What this person has shared and can still cancel.
  const [sent, setSent] = useState<SentShare[]>([])
  const refreshShares = useCallback(async () => {
    if (!userId) return
    // The two ways of sharing are read apart, so one being unreachable does not hide the other.
    const [online, local] = await Promise.allSettled([
      Promise.all([listShares(userId), listSentShares(userId)]),
      listLocalShares(userId),
    ])
    const near = local.status === "fulfilled" ? local.value : { received: [], sent: [] }
    const far = online.status === "fulfilled" ? online.value : ([[], []] as [VaultShare[], SentShare[]])
    const newestFirst = (a: { createdAt: string }, b: { createdAt: string }) => b.createdAt.localeCompare(a.createdAt)
    setShares([...far[0], ...near.received].sort(newestFirst))
    setSent([...far[1], ...near.sent].sort(newestFirst))
    if (online.status === "rejected") throw online.reason
  }, [userId])
  useEffect(() => {
    if (!active || !available || !userId) return
    // Quietly: offline, or before the sharing SQL script is run, there is simply nothing shared.
    const refresh = () => void refreshShares().catch(() => undefined)
    refresh()
    const stopOnline = subscribeToShares(userId, refresh)
    const stopLocal = subscribeToLocalShares(refresh)
    return () => {
      stopOnline()
      stopLocal()
    }
  }, [active, available, userId, refreshShares])
  // The tables on the page: the open one first, then the ones beside it.
  const panes = useMemo(() => {
    if (!data || !table) return []
    const shown = [table]
    for (const id of split) {
      const other = data.tables.find((item) => item.id === id)
      if (other && !shown.includes(other) && shown.length < MAX_PANES) shown.push(other)
    }
    return shown
  }, [data, table, split])

  // Remember the panes for this file.
  const loaded = data !== null
  useEffect(() => {
    if (!file || !loaded) return
    try {
      if (split.length > 0 || stacked) localStorage.setItem(splitKey(file), JSON.stringify({ ids: split, stacked }))
      else localStorage.removeItem(splitKey(file))
    } catch {
      // Not remembered; the panes still show until the file is closed.
    }
  }, [file, loaded, split, stacked])

  /** Shows a table in a pane. A table already in another pane swaps places with it. */
  function showInPane(index: number, id: string) {
    const ids = panes.map((pane) => pane.id)
    if (index >= ids.length) return
    const other = ids.indexOf(id)
    if (other !== -1) ids[other] = ids[index]
    ids[index] = id
    setTableId(ids[0])
    setSplit(ids.slice(1))
  }

  /** Adds a pane showing the first table that is not on the page yet. */
  function addPane() {
    const next = data?.tables.find((item) => !panes.includes(item))
    if (next && panes.length < MAX_PANES) setSplit([...panes.slice(1).map((pane) => pane.id), next.id])
  }

  function closePane(index: number) {
    const ids = panes.map((pane) => pane.id).filter((_, at) => at !== index)
    setTableId(ids[0] ?? null)
    setSplit(ids.slice(1))
  }

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
        const view = readSplit(path)
        setSplit(view.ids)
        setStacked(view.stacked)
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

  /**
   * Adds the tables read from a file the person picks; `read` gives null if they cancel. The tables
   * join the category of the open table and are saved like any other change.
   */
  function importTables(read: (category: string) => Promise<VaultTable[] | null>, nothing: string) {
    if (!data) return
    setError("")
    void read((table?.category ?? "").trim())
      .then((created) => {
        if (!created) return
        if (created.length === 0) {
          setError(nothing)
          return
        }
        update((current) => ({ tables: [...current.tables, ...created] }))
        setTableId(created[0].id)
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not import that file."))
  }

  /** Asks for an Excel file and adds a table for each of its sheets. */
  function importExcel() {
    importTables(
      (category) => pickExcelFile().then((book) => book && importedTables(book, category)),
      "That file has nothing to import: its sheets are empty.",
    )
  }

  /** Asks for a JSON file and adds a table for each list of records in it. */
  function importJson() {
    importTables(
      (category) => pickJsonFile().then((picked) => picked && importedJsonTables(picked, category)),
      'That file has nothing to import. It needs a list of records, such as [{ "name": "Ada" }].',
    )
  }

  /** Adds what someone shared as a new table. It is saved like any other change. */
  function addShared(share: VaultShare) {
    if (!data) return
    const created = tableFromShare(share, data.tables, "Shared with me")
    update((current) => ({ tables: [...current.tables, created] }))
    setTableId(created.id)
  }

  /** Takes a share off the list. A table already added from it stays. */
  async function dropShare(share: VaultShare) {
    await (share.via === "local" ? removeLocalShare(share.id) : removeShare(share.id))
    setShares((current) => current.filter((item) => item.id !== share.id))
  }

  /** Cancels something this person shared: the other person no longer has it to add. */
  async function cancelShare(share: SentShare) {
    await (share.via === "local" ? cancelLocalShare(share.id) : removeShare(share.id))
    setSent((current) => current.filter((item) => item.id !== share.id))
  }

  /** Moves the rows of one table into another and removes the emptied table. */
  function mergeInto(intoId: string, fromId: string) {
    update((current) => ({ tables: mergeTables(current.tables, intoId, fromId) }))
    if (table?.id === fromId) setTableId(intoId)
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
    // A table already in a pane shows the row there.
    if (!panes.some((pane) => pane.id === targetTableId)) setTableId(targetTableId)
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
    reportError: setError,
    pending,
    setPending,
    // Choosing a table shows it in the first pane.
    selectTable: (id: string | null) => (id && panes.length > 0 ? showInPane(0, id) : setTableId(id)),
    panes,
    stacked,
    setStacked,
    canSplit: data !== null && panes.length > 0 && panes.length < Math.min(MAX_PANES, data.tables.length),
    showInPane,
    addPane,
    closePane,
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
    importExcel,
    importJson,
    mergeInto,
    removeTable,
    userId,
    shares,
    sent,
    refreshShares,
    addShared,
    dropShare,
    cancelShare,
  }
}

/**
 * The open Vault file, which Files cells need to find their attachments, the table whose folder new
 * attachments go in, and where to report problems.
 */
const AttachmentsContext = createContext<{ file: string | null; table: string; report: (message: string) => void }>({
  file: null,
  table: "",
  report: () => {},
})

/** Whether Sub-table cells show their items in the cell, under the count that opens them. */
const SubTablesInlineContext = createContext(false)

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" />
      <path d="M14 3.5V8h4.5" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    </svg>
  )
}

/** Opening and showing attachments, with any problem shown at the top of the Vault. */
function useAttachments() {
  const { file, table, report } = useContext(AttachmentsContext)
  const run = (action: (vault: string) => Promise<unknown>) => {
    if (!file) return
    action(file).catch((caught) => report(caught instanceof Error ? caught.message : "Could not use that file."))
  }
  return {
    open: (attachment: string) => run((vault) => openVaultAttachment(vault, attachment)),
    reveal: (attachment: string) => run((vault) => revealVaultAttachment(vault, attachment)),
    attach: (then: (attached: string[]) => void) =>
      run((vault) => attachVaultFiles(vault, table).then((attached) => attached && then(attached))),
  }
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17.5l4.5-4.5 3.5 3.5 3-3 5 5" />
    </svg>
  )
}

/**
 * An image attachment's preview, loaded once its element scrolls into view, so a long table only
 * reads the images on screen. The url is null until it loads, and stays null if it cannot.
 */
function useAttachmentPreview<T extends Element>(file: string) {
  const { file: vault } = useContext(AttachmentsContext)
  const ref = useRef<T>(null)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!vault || !element) return
    let cancelled = false
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      vaultAttachmentPreview(vault, file)
        .then((loaded) => !cancelled && setUrl(loaded))
        .catch(() => {
          // No preview; the attachment is still listed by name and opens in its own app.
        })
    })
    observer.observe(element)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [vault, file])
  return { ref, url }
}

/** An image attachment's preview; clicking it shows the image over the app. */
function AttachmentThumb({ file }: { file: string }) {
  const { ref, url } = useAttachmentPreview<HTMLButtonElement>(file)
  const [viewing, setViewing] = useState(false)
  const name = attachmentName(file)
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={url ? "vault-thumb" : "vault-thumb loading"}
        aria-label={`View ${name}`}
        title={`View ${name}`}
        disabled={!url}
        onClick={() => setViewing(true)}
      >
        {url && <img src={url} alt="" draggable={false} />}
      </button>
      {viewing && url && <ImageViewer url={url} name={name} onClose={() => setViewing(false)} />}
    </>
  )
}

/** The first image of a row, across the top of its card. */
function CardCover({ file }: { file: string }) {
  const { ref, url } = useAttachmentPreview<HTMLSpanElement>(file)
  return <span ref={ref} className="vault-card-cover">{url && <img src={url} alt="" draggable={false} />}</span>
}

/** Turns image previews on or off for a Files column. */
function PreviewToggle({ column, onChange }: { column: VaultColumn; onChange: (preview: boolean) => void }) {
  const on = showsPreview(column)
  return (
    <button
      type="button"
      className="vault-cell-action vault-preview-toggle"
      aria-pressed={on}
      aria-label={`Show image previews in ${column.name || "this column"}`}
      title={
        on
          ? "Images show a preview. Click to list them by name only."
          : "Images are listed by name only. Click to show a preview of each image."
      }
      onClick={() => onChange(!on)}
    >
      <ImageIcon />
    </button>
  )
}

/** One attachment: its name opens it, and the folder button shows it in its folder. */
function AttachmentChip({ file, preview, children }: { file: string; preview: boolean; children?: ReactNode }) {
  const attachments = useAttachments()
  const name = attachmentName(file)
  const chip = (
    <span className="vault-link-chip">
      <button type="button" className="vault-link" title={`Open ${name}`} onClick={() => attachments.open(file)}>
        <FileIcon />
        {name}
      </button>
      <button
        type="button"
        className="vault-cell-action"
        aria-label={`Show ${name} in its folder`}
        title="Show in folder"
        onClick={() => attachments.reveal(file)}
      >
        <FolderIcon />
      </button>
      {children}
    </span>
  )
  if (!preview || !isImageAttachment(file)) return chip
  return (
    <span className="vault-attachment">
      <AttachmentThumb file={file} />
      {chip}
    </span>
  )
}

function FilesView({ value, preview }: { value: VaultCell; preview: boolean }) {
  const files = listItems(value)
  if (files.length === 0) return <span className="vault-cell-view" />
  return (
    <span className="vault-cell-view vault-links vault-files">
      {files.map((file) => (
        <AttachmentChip key={file} file={file} preview={preview} />
      ))}
    </span>
  )
}

/**
 * A Files cell in Edit. Attaching copies the files into the attachments folder right away;
 * removing one only takes it out of the cell, and the file stays in the folder.
 */
function FilesEditor({
  label,
  value,
  preview,
  onChange,
}: {
  label: string
  value: VaultCell
  preview: boolean
  onChange: (value: VaultCell) => void
}) {
  const attachments = useAttachments()
  const files = listItems(value)
  return (
    <span className="vault-links vault-files">
      {files.map((file) => (
        <AttachmentChip key={file} file={file} preview={preview}>
          <button
            type="button"
            className="vault-cell-action"
            aria-label={`Remove ${attachmentName(file)} from ${label}`}
            title="Remove from this cell. The file stays in the attachments folder."
            onClick={() => {
              const next = files.filter((item) => item !== file)
              onChange(next.length > 0 ? next : null)
            }}
          >
            <RemoveIcon />
          </button>
        </AttachmentChip>
      ))}
      <button
        type="button"
        className="vault-attach"
        title="Copies the files into this table's folder inside the attachments folder next to the Vault file"
        onClick={() =>
          attachments.attach((attached) => {
            const next = [...files, ...attached.filter((file) => !files.includes(file))]
            onChange(next.length > 0 ? next : null)
          })
        }
      >
        <PlusIcon /> Attach files
      </button>
    </span>
  )
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
    case "files":
      return <FilesEditor label={label} value={value} preview={showsPreview(column)} onChange={onChange} />
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
    case "files":
      return listItems(value).map(attachmentName).join("\n")
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
  if (column.kind === "files") return <FilesView value={value} preview={showsPreview(column)} />
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
  const inline = useContext(SubTablesInlineContext)
  const rows = subRows(value)
  const subColumns = column.columns ?? []
  if (!editing && rows.length === 0) return <span className="vault-cell-view" />
  return (
    <div className="vault-cell-view">
      <button type="button" className="vault-link" title={`Open ${column.name || "sub-table"}`} onClick={() => setOpen(true)}>
        <TableIcon />
        {rows.length === 0 ? "Add items" : itemCount(rows.length)}
      </button>
      {/* Read-only here, also in Edit: items are changed in the panel the count opens. */}
      {inline && rows.length > 0 && subColumns.length > 0 && (
        <table className="vault-sub-inline">
          <thead>
            <tr>
              {subColumns.map((sub) => (
                <th key={sub.id} scope="col">
                  {sub.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {subColumns.map((sub) => (
                  <td key={sub.id}>
                    <CellView column={sub} value={row.cells[sub.id] ?? null} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && (
        <SubTableDialog
          column={column}
          rows={rows}
          onChange={editing && onChange ? (next) => onChange(next.length > 0 ? next : null) : undefined}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
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
      // An image being viewed over the dialog closes first.
      if (event.key === "Escape" && !document.querySelector(".image-viewer")) onClose()
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
            <thead>
              <tr>
                <th scope="col" className="vault-no">
                  No
                </th>
                {columns.map((sub) => (
                  <th key={sub.id} scope="col">
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
            {sub.kind === "files" && (
              <PreviewToggle
                column={sub}
                onChange={(preview) =>
                  onChange(
                    columns.map((item) => (item.id === sub.id ? { ...item, preview: preview ? undefined : false } : item)),
                  )
                }
              />
            )}
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

/** How many fields a card shows under its title; the rest are in the row panel. */
const CARD_FIELDS = 4

/** The short text a card shows for one value. */
function cardText(column: VaultColumn, value: VaultCell, label: (rowId: string) => string) {
  if (value === null || value === "") return ""
  if (column.kind === "password") return typeof value === "string" && value ? "••••••••" : ""
  if (column.kind === "subtable") {
    const count = subRows(value).length
    return count > 0 ? itemCount(count) : ""
  }
  if (column.kind === "checkbox") return value === true ? "Yes" : ""
  if (column.kind === "date" && typeof value === "string") return formatDate(value)
  if (column.kind === "list" || column.kind === "links" || column.kind === "files") {
    const items = listItems(value)
    return (column.kind === "links" ? items.map(label) : column.kind === "files" ? items.map(attachmentName) : items)
      .filter(Boolean)
      .join(", ")
  }
  return cellText(value, column.kind, label)
}

/** One row as a card: its name, then its first few filled-in values. */
function RowCard({
  table,
  row,
  index,
  selected,
  fieldIds,
  className,
  labelIn,
  onOpen,
}: {
  table: VaultTable
  row: VaultRow
  index: number
  selected: boolean
  /** The columns to show; null for the first few filled-in values. */
  fieldIds: string[] | null
  className?: string
  labelIn: (column: VaultColumn) => (rowId: string) => string
  onOpen: () => void
}) {
  const title = rowLabel(table, row.id) ?? `Row ${index + 1}`
  const columns = fieldIds ? table.columns.filter((column) => fieldIds.includes(column.id)) : table.columns
  const cover = columns
    .filter(showsPreview)
    .flatMap((column) => listItems(row.cells[column.id]))
    .find(isImageAttachment)
  const values = columns
    .map((column) => ({ column, text: cardText(column, row.cells[column.id] ?? null, labelIn(column)) }))
  const fields = fieldIds
    ? values.filter(({ text }) => text)
    : values
        // The title is already shown above the fields.
        .filter(({ text }, at, all) => text && !(text === title && all.findIndex((item) => item.text) === at))
        .slice(0, CARD_FIELDS)
  return (
    <button
      type="button"
      className={["vault-card", selected && "selected", className].filter(Boolean).join(" ")}
      data-row-id={row.id}
      aria-pressed={selected}
      onClick={onOpen}
    >
      {cover && <CardCover key={cover} file={cover} />}
      <span className="vault-card-title">
        <span className="vault-card-no">{index + 1}</span>
        {title}
      </span>
      {fields.length > 0 ? (
        <dl className="vault-card-fields">
          {fields.map(({ column, text }) => (
            <div key={column.id}>
              <dt>{column.name || "Untitled"}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <span className="vault-card-empty">{fieldIds ? "No values in the chosen fields" : "No values yet"}</span>
      )}
    </button>
  )
}

/** Picks the columns a table's cards show, under the toolbar. */
function CardFieldsBar({
  table,
  fieldIds,
  onChange,
  onClose,
}: {
  table: VaultTable
  fieldIds: string[] | null
  onChange: (fieldIds: string[] | null) => void
  onClose: () => void
}) {
  return (
    <div className="vault-filters vault-duplicates" role="group" aria-label="Card fields">
      <div className="vault-duplicates-head">
        <strong>Show on cards</strong>
        <button type="button" className="vault-chip" aria-pressed={fieldIds === null} onClick={() => onChange(null)}>
          Automatic
        </button>
        {table.columns.map((column) => {
          const on = fieldIds?.includes(column.id) ?? false
          return (
            <button
              key={column.id}
              type="button"
              className="vault-chip"
              aria-pressed={on}
              onClick={() =>
                onChange(on ? fieldIds!.filter((id) => id !== column.id) : [...(fieldIds ?? []), column.id])
              }
            >
              {column.name || "Untitled"}
            </button>
          )
        })}
      </div>
      <p className="hint" role="status">
        {fieldIds === null
          ? `Cards show the first ${CARD_FIELDS} filled-in values. Pick columns to choose them yourself.`
          : fieldIds.length === 0
            ? "Cards show only their title. Click a card to see all its values."
            : "Cards show the chosen columns, in table order, when they have a value."}{" "}
        Remembered for this table on this computer.
      </p>
      <div className="vault-filter-actions">
        <button type="button" className="button secondary vault-small" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}

/** Every value of one row, in a panel that slides in from the right. Editable in Edit. */
function RowPanel({
  table,
  row,
  index,
  editing,
  links,
  onChange,
  onRemove,
  onClose,
}: {
  table: VaultTable
  row: VaultRow
  index: number
  editing: boolean
  links: Map<string, LinkTarget | undefined>
  onChange: (columnId: string, value: VaultCell) => void
  onRemove: () => void
  onClose: () => void
}) {
  const title = rowLabel(table, row.id) ?? `Row ${index + 1}`
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // A dialog opened from inside the panel closes first.
      if (event.key === "Escape" && !document.querySelector(".desk-backdrop, .image-viewer")) onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <aside className="vault-row-panel" aria-label={title}>
      <div className="vault-modal-head">
        <h2>
          <span className="vault-card-no">{index + 1}</span>
          {title}
        </h2>
        <button type="button" className="vault-remove" aria-label="Close" title="Close" onClick={onClose}>
          <RemoveIcon />
        </button>
      </div>
      <div className={["vault-grid vault-panel-fields", !editing && "vault-viewing"].filter(Boolean).join(" ")}>
        {table.columns.map((column) => (
          <div key={column.id} className="vault-panel-field">
            <span className="vault-panel-label">{column.name || "Untitled"}</span>
            {editing ? (
              <CellEditor
                column={column}
                value={row.cells[column.id] ?? null}
                onChange={(value) => onChange(column.id, value)}
                link={links.get(column.id)}
              />
            ) : (
              <CopyableCell column={column} value={row.cells[column.id] ?? null} link={links.get(column.id)} />
            )}
          </div>
        ))}
      </div>
      {editing && (
        <div className="form-actions">
          <button type="button" className="button danger vault-small" onClick={onRemove}>
            <TrashIcon /> Delete row
          </button>
        </div>
      )}
    </aside>
  )
}

function columnNames(columns: VaultColumn[]) {
  return columns.map((column) => column.name.trim() || "Untitled").join(", ")
}

/** Picks the table to merge into this one, and says what the merge does before it happens. */
function MergeDialog({ vault, table, onClose }: { vault: VaultState; table: VaultTable; onClose: () => void }) {
  const others = (vault.data?.tables ?? []).filter((item) => item.id !== table.id)
  const [fromId, setFromId] = useState(others[0]?.id ?? "")
  const from = others.find((item) => item.id === fromId) ?? null
  const plan = from ? mergePlan(table, from) : null
  const name = table.name || "Untitled"
  const fromName = from?.name || "Untitled"

  return (
    <VaultModal title={`Merge a table into ${name}`} onClose={onClose}>
      <label className="vault-merge-pick">
        <span>Table to merge in</span>
        <select value={fromId} onChange={(event) => setFromId(event.target.value)}>
          {others.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name || "Untitled"} ({item.rows.length === 1 ? "1 row" : `${item.rows.length} rows`})
            </option>
          ))}
        </select>
      </label>
      {from && plan && (
        <div className="vault-merge-plan" role="status">
          <p>
            {from.rows.length === 1 ? "The 1 row" : `The ${from.rows.length} rows`} of “{fromName}” go under the{" "}
            {table.rows.length === 1 ? "1 row" : `${table.rows.length} rows`} of “{name}”, and “{fromName}” is
            removed. Links to its rows keep working.
          </p>
          <p>
            {plan.shared.length > 0
              ? `Combined, because they have the same name and type: ${columnNames(plan.shared.map((pair) => pair.into))}.`
              : "No columns have the same name and type, so none are combined."}
          </p>
          {plan.added.length > 0 && <p>Added as new columns: {columnNames(plan.added)}.</p>}
          <p>You can still discard this before you save.</p>
        </div>
      )}
      <div className="form-actions">
        <button type="button" className="button secondary vault-small" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button vault-small"
          disabled={!from}
          onClick={() => {
            if (from) vault.mergeInto(table.id, from.id)
            onClose()
          }}
        >
          <MergeIcon /> Merge
        </button>
      </div>
    </VaultModal>
  )
}

/** What a cell of a shared copy shows in a preview. Passwords stay covered. */
function sharedCellText(column: VaultColumn, value: VaultCell | undefined) {
  if (value === null || value === undefined) return ""
  if (column.kind === "password") return "••••••"
  if (column.kind === "subtable") {
    const count = subRows(value).length
    return count === 0 ? "" : count === 1 ? "1 item" : `${count} items`
  }
  if (column.kind === "list") return listItems(value).join(", ")
  return cellText(value, column.kind)
}

function counted(count: number, one: string, many = `${one}s`) {
  return count === 1 ? `1 ${one}` : `${count} ${many}`
}

/** A shared copy as a small read-only table, with a tick box per row when rows can be chosen. */
function SharedPreview({
  table,
  limit,
  picked,
  onPick,
  onPickAll,
}: {
  table: SharedTable
  limit?: number
  picked?: ReadonlySet<string>
  onPick?: (rowId: string, on: boolean) => void
  onPickAll?: (on: boolean) => void
}) {
  const rows = limit ? table.rows.slice(0, limit) : table.rows
  const all = picked ? table.rows.length > 0 && table.rows.every((row) => picked.has(row.id)) : false
  return (
    <div className="vault-share-rows">
      <table className="vault-share-grid">
        <thead>
          <tr>
            {picked && (
              <th className="vault-share-tick">
                <input
                  type="checkbox"
                  aria-label="Choose every row"
                  title={all ? "Choose no rows" : "Choose every row"}
                  checked={all}
                  onChange={(event) => onPickAll?.(event.target.checked)}
                />
              </th>
            )}
            {table.columns.map((column) => (
              <th key={column.id}>{column.name || "Untitled"}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id} className={picked && !picked.has(row.id) ? "vault-share-off" : undefined}>
              {picked && (
                <td className="vault-share-tick">
                  <input
                    type="checkbox"
                    aria-label={`Share row ${index + 1}`}
                    checked={picked.has(row.id)}
                    onChange={(event) => onPick?.(row.id, event.target.checked)}
                  />
                </td>
              )}
              {table.columns.map((column) => (
                <td key={column.id}>{sharedCellText(column, row.cells[column.id])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {limit !== undefined && table.rows.length > limit && (
        <p className="hint vault-share-more">and {counted(table.rows.length - limit, "more row")}</p>
      )}
    </div>
  )
}

type SharePerson = { userId: string; name: string; detail: string; avatarUrl: string | null }

/** A round photo of someone, or their initials when they have none. */
function ShareAvatar({ person }: { person: SharePerson }) {
  const letters = person.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
  return (
    <span className="avatar event-avatar" aria-hidden="true">
      {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : <span>{letters || "?"}</span>}
    </span>
  )
}

/**
 * Sends a copy of chosen rows and columns to chosen people. `rows` are the rows on screen when it
 * was opened, so a search or filter narrows what is offered.
 */
function ShareDialog({
  vault,
  table,
  rows,
  labelIn,
  onClose,
}: {
  vault: VaultState
  table: VaultTable
  rows: VaultRow[]
  labelIn: (column: VaultColumn) => (rowId: string) => string
  onClose: () => void
}) {
  // The copy as it was when the dialog opened.
  const [copy] = useState(() => sharedTable(table, rows, labelIn))
  // Passwords are left out unless the person ticks them.
  const [columnIds, setColumnIds] = useState(
    () => new Set(copy.columns.filter((column) => column.kind !== "password").map((column) => column.id)),
  )
  const [rowIds, setRowIds] = useState(() => new Set(copy.rows.map((row) => row.id)))
  // Through Novaroom to any registered person, or straight to someone on the office network.
  const [via, setVia] = useState<ShareVia>("online")
  const [people, setPeople] = useState<SharePerson[] | null>(null)
  // True while the list of people to add is open under the photos.
  const [picking, setPicking] = useState(true)
  const [peopleError, setPeopleError] = useState("")
  const [find, setFind] = useState("")
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [note, setNote] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [sentTo, setSentTo] = useState<string[] | null>(null)
  const { userId } = vault

  useEffect(() => {
    let stale = false
    setPeople(null)
    setPeopleError("")
    setPicked(new Set())
    const load =
      via === "local"
        ? Promise.all([localPeers(), localAvatars().catch(() => ({}) as Record<string, string>)]).then(([peers, avatars]) =>
            peers.map((peer) => ({
              userId: peer.userId,
              name: peer.name || "Unnamed",
              detail: peer.idle ? "Away" : "",
              avatarUrl: avatars[peer.userId] ?? null,
            })),
          )
        : listUsers().then((users) =>
            users.map((user) => ({
              userId: user.userId,
              name: user.displayName || "Unnamed",
              detail: user.role,
              avatarUrl: user.avatarUrl,
            })),
          )
    load
      .then((list) => {
        if (!stale) setPeople(list.filter((person) => person.userId !== userId))
      })
      .catch(() => {
        if (stale) return
        setPeopleError(
          via === "local"
            ? "Local chat is not running on this computer, so nobody on the network can be reached."
            : "Could not load the list of people. Check your connection, or share over the local network.",
        )
      })
    return () => {
      stale = true
    }
  }, [userId, via])

  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set)
    if (on) next.add(id)
    else next.delete(id)
    return next
  }
  const chosen = useMemo(() => pickShared(copy, columnIds, new Set(copy.rows.map((row) => row.id))), [copy, columnIds])
  const wanted = find.trim().toLowerCase()
  const chosenPeople = (people ?? []).filter((person) => picked.has(person.userId))
  // People who can still be added, narrowed by the search.
  const addable = (people ?? []).filter((person) => !picked.has(person.userId))
  const listed = addable.filter(
    (person) => !wanted || `${person.name} ${person.detail}`.toLowerCase().includes(wanted),
  )
  const sharesPassword = copy.columns.some((column) => column.kind === "password" && columnIds.has(column.id))
  const ready = picked.size > 0 && rowIds.size > 0 && columnIds.size > 0 && !sending

  async function send() {
    if (!userId || !ready) return
    setSending(true)
    setError("")
    try {
      const part = pickShared(copy, columnIds, rowIds)
      if (via === "local") await sendLocalShares([...picked], part, note)
      else await sendShares(userId, [...picked], part, note)
      setSentTo((people ?? []).filter((person) => picked.has(person.userId)).map((person) => person.name))
      void vault.refreshShares().catch(() => undefined)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not share that.")
    } finally {
      setSending(false)
    }
  }

  if (sentTo) {
    return (
      <VaultModal title="Shared" onClose={onClose}>
        <p className="vault-share-done" role="status">
          {counted(rowIds.size, "row")} and {counted(columnIds.size, "column")} of “{copy.name}” shared with{" "}
          {sentTo.join(", ")}
          {via === "local" ? " over the local network" : ""}. They will find it under “Shared with you” in their
          Vault. You can cancel it there too, under “Shared by you”.
        </p>
        <div className="form-actions">
          <button type="button" className="button vault-small" onClick={onClose}>
            Done
          </button>
        </div>
      </VaultModal>
    )
  }

  return (
    <VaultModal title={`Share from ${copy.name}`} wide onClose={onClose}>
      <div className="vault-share-section">
        <div className="vault-share-heading">
          <h3>People</h3>
          <span className="hint">{picked.size > 0 ? `${picked.size} chosen` : "Choose who gets a copy"}</span>
        </div>
        <div className="desk-segmented vault-share-via" role="group" aria-label="How to send it">
          <button
            type="button"
            aria-pressed={via === "online"}
            title="Send through Novaroom to any registered person. Needs internet."
            onClick={() => setVia("online")}
          >
            Through Novaroom
          </button>
          <button
            type="button"
            aria-pressed={via === "local"}
            title="Send straight to people on the same office network, as in Local chat. Works without internet."
            onClick={() => setVia("local")}
          >
            Local network
          </button>
        </div>
        {/* As when assigning a task: the chosen people as photos (click one to remove it), then a "+". */}
        <div className="task-form-avatars">
          {chosenPeople.map((person) => (
            <button
              key={person.userId}
              type="button"
              className="task-form-avatar"
              aria-label={`Remove ${person.name}`}
              title={`Remove ${person.name}`}
              onClick={() => setPicked(toggle(picked, person.userId, false))}
            >
              <ShareAvatar person={person} />
              <svg className="task-form-remove" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" />
              </svg>
            </button>
          ))}
          {addable.length > 0 && (
            <button
              type="button"
              className="task-form-add"
              aria-label={picking ? "Close the list" : "Add a person"}
              title={picking ? "Close the list" : "Add a person"}
              aria-expanded={picking}
              onClick={() => setPicking(!picking)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
        </div>
        {peopleError ? (
          <p className="form-error" role="alert">
            {peopleError}
          </p>
        ) : people === null ? (
          <p className="hint">Loading people…</p>
        ) : people.length === 0 ? (
          <p className="hint">
            {via === "local" ? "Nobody else is on the local network right now." : "Nobody else is registered yet."}
          </p>
        ) : (
          picking &&
          addable.length > 0 && (
            <>
              {addable.length > 6 && (
                <label className="vault-search vault-share-find">
                  <SearchIcon />
                  <input
                    type="search"
                    aria-label="Find a person"
                    placeholder="Find a person"
                    value={find}
                    onChange={(event) => setFind(event.target.value)}
                  />
                </label>
              )}
              {listed.length === 0 ? (
                <p className="hint">Nobody matches.</p>
              ) : (
                <ul className="task-form-picker">
                  {listed.map((person) => (
                    <li key={person.userId}>
                      <button
                        type="button"
                        onClick={() => {
                          setPicked(toggle(picked, person.userId, true))
                          if (addable.length === 1) setPicking(false)
                        }}
                      >
                        <ShareAvatar person={person} />
                        {person.name}
                        {person.detail && <span className="hint">{person.detail}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )
        )}
      </div>

      <div className="vault-share-section">
        <div className="vault-share-heading">
          <h3>Columns</h3>
          <span className="hint">
            {columnIds.size} of {copy.columns.length}
          </span>
        </div>
        <div className="vault-share-columns">
          {table.columns.map((column) => {
            const becomes = sharedAs(column)
            return (
              <label key={column.id} title={becomes ? `${column.name || "Untitled"}: ${becomes}` : undefined}>
                <input
                  type="checkbox"
                  checked={columnIds.has(column.id)}
                  onChange={(event) => setColumnIds(toggle(columnIds, column.id, event.target.checked))}
                />
                {column.name || "Untitled"}
                {becomes && <span className="hint"> *</span>}
              </label>
            )
          })}
        </div>
        {table.columns.some((column) => sharedAs(column)) && (
          <p className="hint">
            * Links are shared as the names they show, and attached files as their file names only. The files stay on
            this computer.
          </p>
        )}
        {sharesPassword && (
          <p className="form-error" role="alert">
            Passwords will be readable by the people you choose.
          </p>
        )}
      </div>

      <div className="vault-share-section">
        <div className="vault-share-heading">
          <h3>Rows</h3>
          <span className="hint">
            {rowIds.size} of {copy.rows.length}
            {rows.length < table.rows.length ? ` shown (the table has ${table.rows.length})` : ""}
          </span>
        </div>
        {chosen.columns.length === 0 ? (
          <p className="hint">Choose at least one column.</p>
        ) : (
          <SharedPreview
            table={chosen}
            picked={rowIds}
            onPick={(rowId, on) => setRowIds(toggle(rowIds, rowId, on))}
            onPickAll={(on) => setRowIds(on ? new Set(copy.rows.map((row) => row.id)) : new Set())}
          />
        )}
      </div>

      <label className="vault-merge-pick">
        <span>Note (optional)</span>
        <input
          type="text"
          maxLength={SHARE_NOTE_LIMIT}
          placeholder="What this is, for the people you share it with"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <p className="hint">
        {via === "local"
          ? "Your Vault stays on this computer. Only the rows and columns ticked here are sent, straight to the computers of the people you choose over the local network, as a Local chat message. Nothing is kept on the server. It stays until that chat's auto-delete time (24 hours unless changed)."
          : "Your Vault stays on this computer. Only the rows and columns ticked here are sent, through Novaroom, to the people you choose."}{" "}
        They get a copy: later changes are not shared. You can cancel the share until they add it to their Vault.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button secondary vault-small" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="button vault-small" disabled={!ready} onClick={() => void send()}>
          <ShareIcon />{" "}
          {sending
            ? "Sharing…"
            : picked.size > 0
              ? `Share ${counted(rowIds.size, "row")} with ${counted(picked.size, "person", "people")}`
              : "Share"}
        </button>
      </div>
    </VaultModal>
  )
}

/** What other people have shared with this person, each to look at, add to the Vault, or remove. */
function SharedWithYouDialog({ vault, onClose }: { vault: VaultState; onClose: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState("")
  const [tab, setTab] = useState<"in" | "out">("in")
  const { refreshShares } = vault

  useEffect(() => {
    refreshShares().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load what was shared."))
  }, [refreshShares])

  return (
    <VaultModal title="Sharing" wide onClose={onClose}>
      <div className="desk-segmented vault-share-via" role="group" aria-label="Which shares to list">
        <button type="button" aria-pressed={tab === "in"} onClick={() => setTab("in")}>
          Shared with you
          {vault.shares.length > 0 && <span className="vault-filter-count">{vault.shares.length}</span>}
        </button>
        <button type="button" aria-pressed={tab === "out"} onClick={() => setTab("out")}>
          Shared by you
          {vault.sent.length > 0 && <span className="vault-filter-count">{vault.sent.length}</span>}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {tab === "out" && vault.sent.length === 0 && <p className="hint">Nothing you shared is waiting.</p>}
      {tab === "out" &&
        vault.sent.map((share) => (
          <div key={share.id} className="vault-shared-item">
            <div className="vault-shared-head">
              <div>
                <strong>{share.tableName}</strong>
                <p className="hint">
                  To {share.recipientName} · {new Date(share.createdAt).toLocaleString()} ·{" "}
                  {share.via === "local" ? "Local network" : "Through Novaroom"}
                </p>
              </div>
              <div className="vault-shared-actions">
                <button
                  type="button"
                  className="button danger vault-small"
                  title={
                    share.via === "local"
                      ? "Delete it from their computer too. If they are away, it goes when they are back on the network."
                      : "Take it off their list."
                  }
                  onClick={() => {
                    setError("")
                    vault
                      .cancelShare(share)
                      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not cancel that."))
                  }}
                >
                  Cancel sharing
                </button>
              </div>
            </div>
          </div>
        ))}
      {tab === "out" && vault.sent.length > 0 && (
        <p className="hint">
          Cancelling takes the share away from the other person. A table they already added to their Vault stays there.
        </p>
      )}
      {tab === "in" && vault.shares.length === 0 && !error && <p className="hint">Nothing has been shared with you.</p>}
      {(tab === "in" ? vault.shares : []).map((share) => (
        <div key={share.id} className="vault-shared-item">
          <div className="vault-shared-head">
            <div>
              <strong>{share.table.name}</strong>
              <p className="hint">
                From {share.senderName} · {new Date(share.createdAt).toLocaleString()} ·{" "}
                {share.via === "local" ? "Local network · " : ""}
                {counted(share.table.rows.length, "row")}, {counted(share.table.columns.length, "column")}
              </p>
            </div>
            <div className="vault-shared-actions">
              <button
                type="button"
                className="button secondary vault-small"
                aria-expanded={openId === share.id}
                onClick={() => setOpenId(openId === share.id ? null : share.id)}
              >
                {openId === share.id ? "Hide" : "Look"}
              </button>
              <button
                type="button"
                className="button vault-small"
                disabled={added.has(share.id)}
                title="Add this as a new table in your Vault"
                onClick={() => {
                  vault.addShared(share)
                  setAdded(new Set(added).add(share.id))
                }}
              >
                {added.has(share.id) ? "Added" : "Add to my Vault"}
              </button>
              <button
                type="button"
                className="button danger vault-small vault-icon-button"
                aria-label={`Remove ${share.table.name} from this list`}
                title="Remove from this list. A table you already added stays in your Vault."
                onClick={() => {
                  setError("")
                  vault.dropShare(share).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not remove that."))
                }}
              >
                <TrashIcon />
              </button>
            </div>
          </div>
          {share.note && <p className="vault-shared-note">{share.note}</p>}
          {openId === share.id && <SharedPreview table={share.table} limit={50} />}
        </div>
      ))}
      {tab === "in" && added.size > 0 && (
        <p className="hint">Added tables are under “Shared with me” in the sidebar. Save your Vault to keep them.</p>
      )}
    </VaultModal>
  )
}

function TableEditor({ vault, table }: { vault: VaultState; table: VaultTable }) {
  const change = (next: (current: VaultTable) => VaultTable) => vault.updateTable(table.id, next)
  const { editing } = vault
  const [merging, setMerging] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [query, setQuery] = useState("")
  const [fit, setFit] = useState(readFit)
  const [markRepeated, setMarkRepeated] = useState(() => readMarkRepeated(table.id))
  const [cards, setCards] = useState(() => readCards(table.id))
  const [subInline, setSubInline] = useState(() => readSubInline(table.id))
  const hasSubTables = table.columns.some((column) => column.kind === "subtable")

  function toggleSubInline() {
    const next = !subInline
    setSubInline(next)
    try {
      if (next) localStorage.setItem(subInlineKey(table.id), "true")
      else localStorage.removeItem(subInlineKey(table.id))
    } catch {
      // Not remembered; the choice still applies until the page is closed.
    }
  }

  // Widths of the columns resized by hand; the others size themselves.
  const [widths, setWidths] = useState(() => readWidths(table.id))
  // The column whose edge is being dragged, and where the drag started.
  const resizing = useRef<{ id: string; startX: number; startWidth: number } | null>(null)
  const hasWidths = table.columns.some((column) => widths[column.id])

  /** Sets a column's width, or clears it with null. `remember` once the change is finished. */
  function setWidth(columnId: string, width: number | null, remember: boolean) {
    const next = { ...widths }
    if (width === null) delete next[columnId]
    else next[columnId] = Math.max(MIN_COLUMN_WIDTH, Math.round(width))
    setWidths(next)
    if (!remember) return
    try {
      if (Object.keys(next).length > 0) localStorage.setItem(widthsKey(table.id), JSON.stringify(next))
      else localStorage.removeItem(widthsKey(table.id))
    } catch {
      // Not remembered; the widths still apply until the page is closed.
    }
  }

  const widthStyle = (columnId: string) => {
    const width = widths[columnId]
    return width ? { width, minWidth: width, maxWidth: width } : undefined
  }
  // In Cards, the row open in the side panel.
  const [selected, setSelected] = useState<string | null>(null)
  const closePanel = useCallback(() => setSelected(null), [])
  const [cardFields, setCardFieldsState] = useState(() => readCardFields(table.id))
  const [showCardFields, setShowCardFields] = useState(false)
  // Columns deleted since the choice was made are left out.
  const cardFieldIds = cardFields && cardFields.filter((id) => table.columns.some((column) => column.id === id))

  function setCardFields(next: string[] | null) {
    setCardFieldsState(next)
    try {
      if (next) localStorage.setItem(cardFieldsKey(table.id), JSON.stringify(next))
      else localStorage.removeItem(cardFieldsKey(table.id))
    } catch {
      // Not remembered; the choice still applies until the page is closed.
    }
  }

  function toggleCards() {
    const next = !cards
    setCards(next)
    setSelected(null)
    try {
      if (next) localStorage.setItem(cardsKey(table.id), "true")
      else localStorage.removeItem(cardsKey(table.id))
    } catch {
      // Not remembered; the choice still applies until the page is closed.
    }
  }

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
  const cardsRef = useRef<HTMLDivElement>(null)

  // Columns fixed in place while the table scrolls sideways; ones deleted since are left out.
  const [fixed, setFixed] = useState(() => readFixed(table.id))
  const fixedIds = fixed.filter((id) => table.columns.some((column) => column.id === id))
  // With a fixed column, the row numbers (and row handles) stay in place too.
  const hasFixed = fixedIds.length > 0 && !cards
  const lastFixed = hasFixed ? [...table.columns].reverse().find((column) => fixedIds.includes(column.id))?.id : undefined
  // How far from the left edge each fixed cell stays: the widths of the fixed cells before it.
  const [lefts, setLefts] = useState<Record<string, number>>({})

  function toggleFixed(columnId: string) {
    const next = fixedIds.includes(columnId) ? fixedIds.filter((id) => id !== columnId) : [...fixedIds, columnId]
    setFixed(next)
    try {
      if (next.length > 0) localStorage.setItem(fixedKey(table.id), JSON.stringify(next))
      else localStorage.removeItem(fixedKey(table.id))
    } catch {
      // Not remembered; the columns still stay fixed until the page is closed.
    }
  }

  // Which cells are fixed and in what order, so they are measured again when that changes.
  const fixedLayout = `${editing}|${table.columns.map((column) => (fixedIds.includes(column.id) ? `${column.id}*` : column.id)).join(",")}`
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || !hasFixed) return
    const cells = [...wrap.querySelectorAll<HTMLElement>("thead th[data-fixed]")]
    const measure = () => {
      const next: Record<string, number> = {}
      let left = 0
      for (const cell of cells) {
        next[cell.dataset.fixed ?? ""] = left
        left += cell.getBoundingClientRect().width
      }
      setLefts((current) =>
        Object.keys(next).length === Object.keys(current).length &&
        Object.entries(next).every(([key, value]) => Math.abs((current[key] ?? -1) - value) < 0.5)
          ? current
          : next,
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    cells.forEach((cell) => observer.observe(cell))
    return () => observer.disconnect()
  }, [hasFixed, fixedLayout])

  const isFixed = (key: string) => hasFixed && (key === "grip" || key === "no" || fixedIds.includes(key))
  const fixedStyle = (key: string) => (isFixed(key) && key in lefts ? { left: lefts[key] } : undefined)

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
  const emptyMessage =
    table.rows.length === 0
      ? "No rows yet."
      : duplicateColumnIds && !search && !filters.length
        ? "No duplicate rows."
        : search && filters.length
          ? "No rows match your search and filters."
          : search
            ? "No rows match your search."
            : "No rows match your filters."
  // The row open in the Cards panel; it stays open while a search or filter hides its card.
  const selectedRow = cards && selected ? (table.rows.find((row) => row.id === selected) ?? null) : null
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
      widths[column.id] && "vault-col-sized",
      isFixed(column.id) && "vault-fixed",
      lastFixed === column.id && "vault-fixed-last",
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
    if (cards) setSelected(highlight)
    ;(bodyRef.current ?? cardsRef.current)?.querySelector(`[data-row-id="${highlight}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" })
    const timer = window.setTimeout(() => setHighlight(null), 2000)
    return () => window.clearTimeout(timer)
  }, [highlight, cards])

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
      if (before.kind === "links" || before.kind === "files") {
        const names = listItems(value)
          .map(before.kind === "links" ? label : attachmentName)
          .filter(Boolean)
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

  /** Adds a column after the last one, or before the first one with `atStart`. */
  function addColumn(atStart = false) {
    change((current) => {
      const column = newColumn(`Column ${current.columns.length + 1}`)
      return { ...current, columns: atStart ? [column, ...current.columns] : [...current.columns, column] }
    })
    // Show the new column, at the far left or the far right.
    window.requestAnimationFrame(() =>
      wrapRef.current?.scrollTo({ left: atStart ? 0 : wrapRef.current.scrollWidth, behavior: "smooth" }),
    )
  }

  /** Adds a row under the last one, or above the first one with `atStart`. */
  function addRow(atStart = false) {
    // A new, empty row would not match the search, filters or duplicates, so show every row again.
    setQuery("")
    setFilters([])
    setDuplicateColumnIds(null)
    // The rows are no longer in the order they were sorted into.
    setSorted(null)
    const row = newRow()
    change((current) => ({ ...current, rows: atStart ? [row, ...current.rows] : [...current.rows, row] }))
    // In Cards, open the new row to fill in.
    if (cards) setSelected(row.id)
    // Show the new row, at the top or the bottom.
    const scroller = cards ? cardsRef : wrapRef
    window.requestAnimationFrame(() =>
      scroller.current?.scrollTo({ top: atStart ? 0 : scroller.current.scrollHeight, behavior: "smooth" }),
    )
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
    <SubTablesInlineContext.Provider value={subInline}>
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
              list={`vault-categories-${table.id}`}
              value={table.category ?? ""}
              onChange={(event) => change((current) => ({ ...current, category: event.target.value }))}
            />
            <datalist id={`vault-categories-${table.id}`}>
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
          className="button secondary vault-small vault-icon-button vault-filter-toggle"
          aria-pressed={showFilters}
          aria-expanded={showFilters}
          aria-label="Filter rows"
          title={filters.length > 0 ? `${filters.length} filter${filters.length === 1 ? "" : "s"} on` : "Filter rows"}
          onClick={() => {
            // Opening an empty filter bar starts a first rule right away.
            if (!showFilters && filters.length === 0 && table.columns.length > 0) setFilters([newFilter(table.columns[0])])
            // Closing it drops rules still waiting for a value, so the count only shows filters in use.
            if (showFilters) setFilters(filters.filter((filter) => !filterNeedsValue(filter.op) || filter.value.trim()))
            setShowFilters(!showFilters)
          }}
        >
          <FilterIcon />
          {filters.length > 0 && <span className="vault-filter-count">{filters.length}</span>}
        </button>
        <button
          type="button"
          className="button secondary vault-small vault-icon-button vault-filter-toggle"
          aria-pressed={duplicateColumnIds !== null}
          aria-label="Find duplicate rows"
          title="Find rows with the same values"
          disabled={table.rows.length < 2 && duplicateColumnIds === null}
          onClick={() => setDuplicateColumnIds(duplicateColumnIds ? null : table.columns.map((column) => column.id))}
        >
          <DuplicatesIcon />
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
        {hasSubTables && (
          <button
            type="button"
            className="button secondary vault-small vault-icon-button vault-fit-toggle"
            aria-pressed={subInline}
            aria-label="Show sub-table items in the table"
            title={
              subInline
                ? "Sub-table items show in their cells. Click to show only how many there are."
                : "Sub-table cells show how many items they hold. Click to show the items themselves in the cells. This is remembered for this table."
            }
            onClick={toggleSubInline}
          >
            <SubRowsIcon />
          </button>
        )}
        <button
          type="button"
          className="button secondary vault-small vault-icon-button vault-fit-toggle"
          aria-pressed={cards}
          aria-label="Show as cards"
          title={
            cards
              ? "Rows show as cards; click one to see all its values. Click to show the table instead."
              : "Click to show rows as cards. This is remembered for this table."
          }
          onClick={toggleCards}
        >
          <CardsIcon />
        </button>
        {cards && (
          <button
            type="button"
            className="button secondary vault-small vault-filter-toggle"
            aria-pressed={showCardFields}
            aria-expanded={showCardFields}
            title="Choose which fields cards show"
            disabled={table.columns.length === 0}
            onClick={() => setShowCardFields(!showCardFields)}
          >
            <EyeIcon open /> Card fields
            {cardFieldIds && <span className="vault-filter-count">{cardFieldIds.length}</span>}
          </button>
        )}
        {/* Cards always wrap their values, so fitting only applies to the table. */}
        {!cards && (
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
        )}
        <button
          type="button"
          className="button secondary vault-small vault-icon-button"
          aria-label="Share rows and columns with other people"
          title={
            shown.length === 0 || table.columns.length === 0
              ? "There are no rows to share"
              : "Share rows and columns with other people"
          }
          disabled={!vault.userId || shown.length === 0 || table.columns.length === 0}
          onClick={() => setSharing(true)}
        >
          <ShareIcon />
        </button>
        {editing && (
          <>
            <button
              type="button"
              className="button secondary vault-small vault-icon-button"
              aria-label="Merge another table into this one"
              title="Merge another table into this one"
              disabled={tables.length < 2}
              onClick={() => setMerging(true)}
            >
              <MergeIcon />
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
      {merging && <MergeDialog vault={vault} table={table} onClose={() => setMerging(false)} />}
      {sharing && (
        <ShareDialog vault={vault} table={table} rows={shown} labelIn={labelIn} onClose={() => setSharing(false)} />
      )}
      {cards && showCardFields && table.columns.length > 0 && (
        <CardFieldsBar
          table={table}
          fieldIds={cardFieldIds}
          onChange={setCardFields}
          onClose={() => setShowCardFields(false)}
        />
      )}
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
            <button type="button" className="button secondary vault-small" onClick={() => addColumn()}>
              <PlusIcon /> Add a column
            </button>
          ) : (
            "This table has no columns yet. Click Edit to add some."
          )}
        </p>
      ) : cards ? (
        <div className="vault-cards-area">
          <div className="vault-cards" ref={cardsRef}>
            {shown.length === 0 && !editing ? (
              <p className="hint vault-cards-empty">{emptyMessage}</p>
            ) : (
              shown.map((row, index) => (
                <RowCard
                  key={row.id}
                  table={table}
                  row={row}
                  index={index}
                  selected={selected === row.id}
                  fieldIds={cardFieldIds}
                  className={
                    [
                      highlight === row.id && "vault-highlight",
                      duplicates?.has(row.id) && (duplicates.get(row.id)! % 2 === 0 ? "vault-dup-even" : "vault-dup-odd"),
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  labelIn={labelIn}
                  onOpen={() => setSelected(selected === row.id ? null : row.id)}
                />
              ))
            )}
            {editing && (
              <button type="button" className="vault-card vault-card-add" onClick={() => addRow()}>
                <PlusIcon /> Add row
              </button>
            )}
          </div>
          {selectedRow && (
            <RowPanel
              key={selectedRow.id}
              table={table}
              row={selectedRow}
              index={
                shown.includes(selectedRow) ? shown.indexOf(selectedRow) : table.rows.indexOf(selectedRow)
              }
              editing={editing}
              links={links}
              onChange={(columnId, value) => setCell(selectedRow.id, columnId, value)}
              onRemove={() => {
                setSelected(null)
                change((current) => ({ ...current, rows: current.rows.filter((item) => item.id !== selectedRow.id) }))
              }}
              onClose={closePanel}
            />
          )}
        </div>
      ) : (
        <div className="vault-grid-wrap" ref={wrapRef}>
          <table
            className={[
              "vault-grid",
              !editing && "vault-viewing",
              fit && "vault-fit",
              hasWidths && "vault-has-widths",
              hasFixed && "vault-has-fixed",
              columnDrag && "vault-col-dragging",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <thead>
              <tr>
                {/* The corner: a new row above the first one, and a new column before the first one. */}
                {editing && (
                  <th
                    className={isFixed("grip") ? "vault-grip-cell vault-fixed" : "vault-grip-cell"}
                    data-fixed={hasFixed ? "grip" : undefined}
                    style={fixedStyle("grip")}
                  >
                    <button
                      type="button"
                      className="vault-add"
                      aria-label="Add row at the top"
                      title="Add a row at the top"
                      onClick={() => addRow(true)}
                    >
                      <AddRowIcon />
                    </button>
                  </th>
                )}
                <th
                  scope="col"
                  className={isFixed("no") ? "vault-no vault-fixed" : "vault-no"}
                  data-fixed={hasFixed ? "no" : undefined}
                  style={fixedStyle("no")}
                >
                  {editing ? (
                    <button
                      type="button"
                      className="vault-add"
                      aria-label="Add column at the start"
                      title="Add a column at the start"
                      onClick={() => addColumn(true)}
                    >
                      <AddColumnIcon />
                    </button>
                  ) : (
                    "No"
                  )}
                </th>
                {table.columns.map((column, columnIndex) => (
                  <th
                    key={column.id}
                    scope="col"
                    data-column
                    data-fixed={isFixed(column.id) ? column.id : undefined}
                    className={columnClass(column, columnIndex)}
                    style={{ ...widthStyle(column.id), ...fixedStyle(column.id) }}
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
                      <button
                        type="button"
                        className="vault-sort vault-fix"
                        aria-label={`Keep ${column.name || "this column"} in place when scrolling sideways`}
                        aria-pressed={fixedIds.includes(column.id)}
                        title={
                          fixedIds.includes(column.id)
                            ? "This column stays in place when the table scrolls sideways. Click to let it scroll."
                            : "Keep this column in place when the table scrolls sideways"
                        }
                        onClick={() => toggleFixed(column.id)}
                      >
                        <FixIcon />
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
                    {editing && column.kind === "files" && (
                      <PreviewToggle
                        column={column}
                        onChange={(preview) => setColumn(column.id, { preview: preview ? undefined : false })}
                      />
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
                    <span
                      className="vault-col-resize"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize column ${column.name}. Use the left and right arrow keys.`}
                      title="Drag to resize. Double-click to size it automatically again."
                      tabIndex={0}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return
                        event.preventDefault()
                        event.currentTarget.setPointerCapture(event.pointerId)
                        resizing.current = {
                          id: column.id,
                          startX: event.clientX,
                          startWidth: event.currentTarget.closest("th")?.getBoundingClientRect().width ?? 160,
                        }
                      }}
                      onPointerMove={(event) => {
                        const active = resizing.current
                        if (active) setWidth(active.id, active.startWidth + event.clientX - active.startX, false)
                      }}
                      onPointerUp={(event) => {
                        const active = resizing.current
                        resizing.current = null
                        // A click without a drag leaves the column sizing itself.
                        if (active && event.clientX !== active.startX) {
                          setWidth(active.id, active.startWidth + event.clientX - active.startX, true)
                        }
                      }}
                      onPointerCancel={() => {
                        resizing.current = null
                      }}
                      onDoubleClick={() => setWidth(column.id, null, true)}
                      onKeyDown={(event) => {
                        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
                        event.preventDefault()
                        const width = event.currentTarget.closest("th")?.getBoundingClientRect().width ?? 160
                        setWidth(column.id, width + (event.key === "ArrowLeft" ? -16 : 16), true)
                      }}
                    />
                  </th>
                ))}
                {editing && (
                  <th className="vault-row-actions">
                    <button
                      type="button"
                      className="vault-add"
                      aria-label="Add column at the end"
                      title="Add a column at the end"
                      onClick={() => addColumn()}
                    >
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
                    {emptyMessage}
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
                      <td className={isFixed("grip") ? "vault-grip-cell vault-fixed" : "vault-grip-cell"} style={fixedStyle("grip")}>
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
                    <td className={isFixed("no") ? "vault-no vault-fixed" : "vault-no"} style={fixedStyle("no")}>
                      {index + 1}
                    </td>
                    {table.columns.map((column, columnIndex) => (
                      <td
                        key={column.id}
                        className={
                          [columnClass(column, columnIndex), repeated.get(column.id)?.has(row.id) && "vault-cell-repeated"]
                            .filter(Boolean)
                            .join(" ") || undefined
                        }
                        style={{ ...widthStyle(column.id), ...fixedStyle(column.id) }}
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
                    <button
                      type="button"
                      className="vault-add"
                      aria-label="Add row at the bottom"
                      title="Add a row at the bottom"
                      onClick={() => addRow()}
                    >
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
    </SubTablesInlineContext.Provider>
  )
}

/** A match's text around the first place it matches, with that place marked. */
function HitText({ text, search }: { text: string; search: string }) {
  const at = text.toLowerCase().indexOf(search.toLowerCase())
  if (at === -1) return <>{text.slice(0, 120)}</>
  const start = Math.max(0, at - 40)
  const end = Math.min(text.length, at + search.length + 80)
  return (
    <>
      {start > 0 && "…"}
      {text.slice(start, at)}
      <mark>{text.slice(at, at + search.length)}</mark>
      {text.slice(at + search.length, end)}
      {end < text.length && "…"}
    </>
  )
}

/** Searches every table of the open Vault. Choosing a match opens its table and shows its row. */
function VaultSearchDialog({ vault, onClose }: { vault: VaultState; onClose: () => void }) {
  const [query, setQuery] = useState("")
  const search = query.trim()
  const data = vault.data
  const { hits, more } = useMemo(() => searchVault(data?.tables ?? [], search), [data, search])
  // Matches come table by table, so each table's are already together.
  const groups: Array<{ tableId: string; tableName: string; hits: VaultHit[] }> = []
  for (const hit of hits) {
    const last = groups[groups.length - 1]
    if (last?.tableId === hit.tableId) last.hits.push(hit)
    else groups.push({ tableId: hit.tableId, tableName: hit.tableName, hits: [hit] })
  }

  function open(hit: VaultHit) {
    if (hit.rowId) vault.openRow(hit.tableId, hit.rowId)
    else vault.selectTable(hit.tableId)
    onClose()
  }

  return (
    <VaultModal title="Search Vault" wide onClose={onClose}>
      <label className="vault-search vault-search-all">
        <SearchIcon />
        <input
          type="search"
          aria-label="Search every table"
          placeholder="Search every table"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {!search ? (
        <p className="hint">
          Searches every table in this Vault, including the items inside sub-tables. Passwords are never searched.
        </p>
      ) : hits.length === 0 ? (
        <p className="hint">Nothing in this Vault matches.</p>
      ) : (
        <div className="vault-hits" role="status">
          {groups.map((group) => (
            <section key={group.tableId}>
              <h3>
                {group.tableName} <span className="vault-filter-count">{group.hits.length}</span>
              </h3>
              {group.hits.map((hit, index) => (
                <button type="button" className="vault-hit" key={index} onClick={() => open(hit)}>
                  <span className="vault-hit-where">
                    {hit.rowId ? (
                      <>
                        <strong>{hit.row}</strong> {hit.where}
                      </>
                    ) : (
                      hit.where
                    )}
                  </span>
                  <span className="vault-hit-text">
                    <HitText text={hit.text} search={search} />
                  </span>
                </button>
              ))}
            </section>
          ))}
          {more && <p className="hint">Showing the first {hits.length} matches. Type more to narrow them down.</p>}
        </div>
      )}
    </VaultModal>
  )
}

export function Vault({ vault }: { vault: VaultState }) {
  const { save, dirty } = vault
  const [searching, setSearching] = useState(false)
  const [showShared, setShowShared] = useState(false)
  const hasFile = Boolean(vault.file && vault.data)

  // Shift + mouse wheel scrolls a table sideways: the one under the pointer (a Sub-table's own
  // table first), or the one around it when that one has no more to show that way.
  useEffect(() => {
    function onWheel(event: WheelEvent) {
      if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
      // Some mice and systems already turn Shift + wheel into a sideways delta.
      const raw = event.deltaX || event.deltaY
      if (!raw) return
      // Lines or pages rather than pixels, from some mice.
      const delta = event.deltaMode === 1 ? raw * 40 : event.deltaMode === 2 ? raw * window.innerWidth : raw
      let wrap = event.target instanceof Element ? event.target.closest<HTMLElement>(".vault-grid-wrap") : null
      while (wrap) {
        const most = wrap.scrollWidth - wrap.clientWidth
        const room = delta < 0 ? wrap.scrollLeft > 0 : wrap.scrollLeft < most - 1
        if (most > 0 && room && getComputedStyle(wrap).overflowX !== "hidden") {
          event.preventDefault()
          wrap.scrollLeft += delta
          return
        }
        wrap = wrap.parentElement?.closest<HTMLElement>(".vault-grid-wrap") ?? null
      }
    }
    document.addEventListener("wheel", onWheel, { passive: false })
    return () => document.removeEventListener("wheel", onWheel)
  }, [])

  // Ctrl+S saves, as in most desktop apps.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        if (dirty) void save()
      }
      // Ctrl+Shift+F searches the whole Vault.
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f" && hasFile) {
        event.preventDefault()
        setSearching(true)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [dirty, save, hasFile])

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
    <AttachmentsContext.Provider value={{ file: vault.file, table: vault.table?.name ?? "", report: vault.reportError }}>
      <section className="settings vault">
        <header className="thread-bar profile-bar">
          <div className="vault-title">
            <h1>{opened && vault.panes.length < 2 ? vault.table?.name || "Vault" : "Vault"}</h1>
            {/* The file itself, with Open and New, is at the top of the sidebar. */}
            {opened && vault.dirty && <p className="thread-email vault-unsaved">Unsaved changes</p>}
          </div>
          {opened && (
            <div className="profile-bar-actions">
              {vault.panes.length > 1 && (
                <button
                  type="button"
                  className="bar-icon"
                  aria-label="Stack the tables"
                  aria-pressed={vault.stacked}
                  title={
                    vault.stacked
                      ? "Tables are one above the other. Click to show them side by side."
                      : "Tables are side by side. Click to show them one above the other."
                  }
                  onClick={() => vault.setStacked(!vault.stacked)}
                >
                  <PanesIcon stacked={vault.stacked} />
                </button>
              )}
              {vault.table && (
                <button
                  type="button"
                  className="bar-icon"
                  aria-label="Show another table on this page"
                  title={
                    vault.canSplit
                      ? "Show another table on this page"
                      : vault.panes.length >= MAX_PANES
                        ? `Up to ${MAX_PANES} tables fit on the page`
                        : "Every table is already on the page"
                  }
                  disabled={!vault.canSplit}
                  onClick={vault.addPane}
                >
                  <AddPaneIcon />
                </button>
              )}
              <button
                type="button"
                className="bar-icon vault-save"
                aria-label="Sharing: shared with you and shared by you"
                title={
                  vault.shares.length > 0
                    ? `Shared with you: ${vault.shares.length === 1 ? "1 table" : `${vault.shares.length} tables`}`
                    : "Shared with you, and what you shared"
                }
                onClick={() => setShowShared(true)}
              >
                <InboxIcon />
                {vault.shares.length > 0 && <span className="vault-dot" aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="bar-icon"
                aria-label="Search the whole Vault (Ctrl+Shift+F)"
                title="Search every table (Ctrl+Shift+F)"
                onClick={() => setSearching(true)}
              >
                <SearchIcon />
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
        ) : vault.table && vault.panes.length > 1 ? (
          <div className={vault.stacked ? "vault-panes stacked" : "vault-panes"}>
            {vault.panes.map((pane, index) => (
              <section key={pane.id} className="vault-pane" aria-label={pane.name || "Untitled"}>
                <div className="vault-pane-head">
                  <select
                    aria-label="Table shown here"
                    title="Table shown here"
                    value={pane.id}
                    onChange={(event) => vault.showInPane(index, event.target.value)}
                  >
                    {groupTables(vault.data?.tables ?? []).map(({ category, tables }) => {
                      const options = tables.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name || "Untitled"}
                        </option>
                      ))
                      return category ? (
                        <optgroup key={category} label={category}>
                          {options}
                        </optgroup>
                      ) : (
                        options
                      )
                    })}
                  </select>
                  <button
                    type="button"
                    className="vault-remove"
                    aria-label={`Close ${pane.name || "Untitled"}`}
                    title="Take this table off the page"
                    onClick={() => vault.closePane(index)}
                  >
                    <RemoveIcon />
                  </button>
                </div>
                {/* New attachments go in the folder of the pane's own table. */}
                <AttachmentsContext.Provider value={{ file: vault.file, table: pane.name, report: vault.reportError }}>
                  <TableEditor key={pane.id} vault={vault} table={pane} />
                </AttachmentsContext.Provider>
              </section>
            ))}
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
              <button type="button" className="button secondary" onClick={vault.importExcel}>
                Import from Excel
              </button>
              <button type="button" className="button secondary" onClick={vault.importJson}>
                Import from JSON
              </button>
            </div>
          </div>
        )}
        {searching && hasFile && <VaultSearchDialog vault={vault} onClose={() => setSearching(false)} />}
        {showShared && hasFile && <SharedWithYouDialog vault={vault} onClose={() => setShowShared(false)} />}
      </section>
    </AttachmentsContext.Provider>
  )
}

/**
 * The open Vault file at the top of the sidebar: its name, folder, size and save state, with buttons
 * to open another file or create a new one.
 */
export function VaultFileCard({ vault }: { vault: VaultState }) {
  const { file, data } = vault
  const name = file ? fileName(file) : null
  // The folder, without the file name and the slash before it.
  const folder = file && name ? file.slice(0, file.length - name.length).replace(/[\\/]$/, "") : ""
  const rows = data?.tables.reduce((total, table) => total + table.rows.length, 0) ?? 0
  return (
    <section className="vault-file" aria-label="Vault file">
      <div className="vault-file-info">
        <strong title={file ?? undefined}>{name ?? "No Vault file open"}</strong>
        {folder && (
          <span className="vault-file-folder" title={file ?? undefined}>
            {/* Marks keep the path in reading order while long ones are cut from the start. */}
            {`‎${folder}‎`}
          </span>
        )}
        {data && (
          <span className="vault-file-meta">
            {data.tables.length === 1 ? "1 table" : `${data.tables.length} tables`} ·{" "}
            {rows === 1 ? "1 row" : `${rows} rows`}
            {vault.dirty ? <b className="vault-unsaved"> · Unsaved changes</b> : " · Saved"}
          </span>
        )}
      </div>
      <div className="vault-file-actions">
        <button type="button" title="Open another Vault file" onClick={() => vault.chooseFile("open")}>
          <OpenFileIcon />
          Open
        </button>
        <button type="button" title="Create a new Vault file" onClick={() => vault.chooseFile("create")}>
          <NewFileIcon />
          New
        </button>
      </div>
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
