import type { RealtimeChannel } from "@supabase/supabase-js"
import type { Session } from "../types"
import { VAULT_SHARE_ADDRESS } from "./chatText"
import { listChats, sendMessage, startLeaderChat } from "./chats"
import { inTauri } from "./desktop"
import {
  deleteLocalMessages,
  deleteLocalMessagesForEveryone,
  localChats,
  localFileBytes,
  localMessages,
  sendLocalMessage,
} from "./localChat"
import { supabase } from "./supabase"
import { personById } from "./users"
import {
  attachmentName,
  linksRows,
  listItems,
  subRows,
  type VaultCell,
  type VaultColumn,
  type VaultRow,
  type VaultTable,
} from "./vault"

// Sharing sends a copy of part of a Vault table to other registered people. The Vault file itself
// never leaves the computer: only the rows and columns picked are sent, and only when asked.

/** The part of a table that travels: plain columns and rows that mean the same in anyone's Vault. */
export type SharedTable = { name: string; columns: VaultColumn[]; rows: VaultRow[] }

/**
 * How a share travels: "online" through Novaroom's server, or "local" straight between computers on
 * the same office network, as a Local chat message.
 */
export type ShareVia = "online" | "local"

export type VaultShare = {
  id: string
  via: ShareVia
  senderId: string
  senderName: string
  note: string
  table: SharedTable
  createdAt: string
}

/** Something this person shared and has not cancelled, for the list they can cancel from. */
export type SentShare = {
  id: string
  via: ShareVia
  recipientName: string
  tableName: string
  createdAt: string
}

/** The most that can be shared at once, as text. The database refuses more than about 2 MB. */
export const SHARE_LIMIT = 1_500_000
export const SHARE_NOTE_LIMIT = 500

const MISSING_TABLE = /does not exist|schema cache|Could not find the table|404/i

function shareError(error: { message: string }) {
  if (MISSING_TABLE.test(error.message)) {
    return new Error("Run the Vault sharing SQL script (20261119120000_vault_shares.sql), then try again.")
  }
  if (/row-level security/i.test(error.message)) return new Error("You cannot share with this person.")
  return new Error(error.message)
}

/** A column as it travels. Links and attachments only mean something in the Vault they came from. */
function sharedColumn(column: VaultColumn): VaultColumn {
  if (column.kind === "link") return { id: column.id, name: column.name, kind: "text" }
  if (column.kind === "links" || column.kind === "files") return { id: column.id, name: column.name, kind: "list" }
  if (column.kind === "subtable") {
    return { id: column.id, name: column.name, kind: "subtable", columns: (column.columns ?? []).map(sharedColumn) }
  }
  return { id: column.id, name: column.name, kind: column.kind }
}

function sharedCell(column: VaultColumn, value: VaultCell | undefined, label: (rowId: string) => string): VaultCell {
  if (value === null || value === undefined || value === "") return null
  if (column.kind === "link") return typeof value === "string" ? label(value) || null : null
  if (column.kind === "links") {
    const names = listItems(value).map(label).filter(Boolean)
    return names.length > 0 ? names : null
  }
  if (column.kind === "files") {
    const names = listItems(value).map(attachmentName)
    return names.length > 0 ? names : null
  }
  if (column.kind === "subtable") {
    const inner = column.columns ?? []
    const rows = subRows(value).map((row) => sharedRow(inner, row, () => () => ""))
    return rows.length > 0 ? rows : null
  }
  return value
}

function sharedRow(
  columns: VaultColumn[],
  row: VaultRow,
  labelIn: (column: VaultColumn) => (rowId: string) => string,
): VaultRow {
  const cells: Record<string, VaultCell> = {}
  for (const column of columns) {
    const value = sharedCell(column, row.cells[column.id], labelIn(column))
    if (value !== null) cells[column.id] = value
  }
  return { id: row.id, cells }
}

/**
 * The copy of a table that can be shared: links become the names they show, and attached files the
 * names of the files (the files themselves stay on this computer).
 */
export function sharedTable(
  table: VaultTable,
  rows: VaultRow[],
  labelIn: (column: VaultColumn) => (rowId: string) => string,
): SharedTable {
  return {
    name: table.name || "Untitled",
    columns: table.columns.map(sharedColumn),
    rows: rows.map((row) => sharedRow(table.columns, row, labelIn)),
  }
}

/** Only the chosen columns and rows of a shared copy. */
export function pickShared(table: SharedTable, columnIds: ReadonlySet<string>, rowIds: ReadonlySet<string>): SharedTable {
  const columns = table.columns.filter((column) => columnIds.has(column.id))
  return {
    name: table.name,
    columns,
    rows: table.rows
      .filter((row) => rowIds.has(row.id))
      .map((row) => {
        const cells: Record<string, VaultCell> = {}
        for (const column of columns) if (column.id in row.cells) cells[column.id] = row.cells[column.id]
        return { id: row.id, cells }
      }),
  }
}

/** Whether a column changes on the way: what it becomes, for telling the person. */
export function sharedAs(column: VaultColumn): string | null {
  if (linksRows(column.kind)) return "shared as the names the links show"
  if (column.kind === "files") return "shared as file names only; the files stay on this computer"
  return null
}

function isColumn(value: unknown): value is VaultColumn {
  if (typeof value !== "object" || value === null) return false
  const column = value as Record<string, unknown>
  return typeof column.id === "string" && typeof column.name === "string" && typeof column.kind === "string"
}

/** What arrived, checked: anything that is not a table is dropped rather than trusted. */
function readShared(value: unknown, fallbackName: string): SharedTable | null {
  if (typeof value !== "object" || value === null) return null
  const raw = value as { name?: unknown; columns?: unknown; rows?: unknown }
  if (!Array.isArray(raw.columns) || !Array.isArray(raw.rows)) return null
  // Only kinds that travel; anything else is read as text.
  const safe = (column: VaultColumn): VaultColumn => {
    if (column.kind === "subtable") {
      const inner = Array.isArray(column.columns) ? column.columns.filter(isColumn) : []
      return {
        id: column.id,
        name: column.name,
        kind: "subtable",
        columns: inner.filter((item) => item.kind !== "subtable").map(safe),
      }
    }
    const kind = linksRows(column.kind) || column.kind === "files" ? "text" : column.kind
    return { id: column.id, name: column.name, kind }
  }
  const columns = raw.columns.filter(isColumn).map(safe)
  const rows = raw.rows.filter(
    (row): row is VaultRow =>
      typeof row === "object" && row !== null && typeof (row as VaultRow).id === "string" && typeof (row as VaultRow).cells === "object" && (row as VaultRow).cells !== null,
  )
  return { name: typeof raw.name === "string" && raw.name ? raw.name : fallbackName, columns, rows }
}

// Without a project (the offline preview), shares are kept on this computer.
const PREVIEW_KEY = "novaroom.preview.vault-shares"
type PreviewShare = { id: string; senderId: string; recipientId: string; note: string; table: SharedTable; createdAt: string }

function readPreview(): PreviewShare[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREVIEW_KEY) ?? "[]") as PreviewShare[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writePreview(shares: PreviewShare[]) {
  try {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(shares))
  } catch {
    throw new Error("There is no room left on this computer to keep that.")
  }
}

// Opening the shared data page from anywhere in the app, such as from a link in a chat.
const OPEN_SHARE = "novaroom-open-vault-share"

/** Shows the shared data page for this share. The page that holds the Vault listens for it. */
export function openVaultShare(id: string) {
  window.dispatchEvent(new CustomEvent(OPEN_SHARE, { detail: id }))
}

/** Calls back when a link to shared data is opened. Returns how to stop. */
export function onOpenVaultShare(open: (id: string) => void): () => void {
  const listener = (event: Event) => {
    const id = (event as CustomEvent<unknown>).detail
    if (typeof id === "string" && id) open(id)
  }
  window.addEventListener(OPEN_SHARE, listener)
  return () => window.removeEventListener(OPEN_SHARE, listener)
}

/** A share that was just made: its id and who it is for. */
export type MadeShare = { id: string; recipientId: string }

/**
 * Tells each person about their share with a message in the direct chat with them, holding a link
 * that opens the shared data page. Only where such a chat exists or may be started; the others
 * still find the share in their Vault's sidebar. Gives the ids of the people who got the message.
 */
export async function sendShareLinks(session: Session, made: MadeShare[], tableName: string, note: string) {
  const told: string[] = []
  if (made.length === 0) return told
  const chats = await listChats(session).catch(() => [])
  for (const share of made) {
    try {
      const chatId =
        chats.find((chat) => chat.kind === "direct" && chat.otherUserId === share.recipientId)?.id ??
        (await startLeaderChat(session, share.recipientId))
      const text = note.trim()
      const body = `Shared from my Vault: “${tableName}”\n${VAULT_SHARE_ADDRESS}${share.id}${text ? `\n${text}` : ""}`
      await sendMessage(session, chatId, body.slice(0, 4000))
      told.push(share.recipientId)
    } catch {
      // No chat with them, or messages to them are not allowed: the share itself is still theirs.
    }
  }
  return told
}

/** Sends a copy of the table to each person. They each get their own copy to add to their Vault. */
export async function sendShares(
  senderId: string,
  recipientIds: string[],
  table: SharedTable,
  note: string,
): Promise<MadeShare[]> {
  const people = [...new Set(recipientIds)].filter((id) => id !== senderId)
  if (people.length === 0) throw new Error("Choose at least one person to share with.")
  if (table.columns.length === 0 || table.rows.length === 0) throw new Error("Choose at least one row and one column.")
  if (JSON.stringify(table).length > SHARE_LIMIT) {
    throw new Error("That is too much to share at once. Choose fewer rows or columns.")
  }
  const text = note.trim().slice(0, SHARE_NOTE_LIMIT)

  if (!supabase) {
    const createdAt = new Date().toISOString()
    const made = people.map((recipientId) => ({ id: crypto.randomUUID(), senderId, recipientId, note: text, table, createdAt }))
    writePreview([...readPreview(), ...made])
    return made.map(({ id, recipientId }) => ({ id, recipientId }))
  }
  const { data, error } = await supabase
    .from("vault_shares")
    .insert(
      people.map((recipientId) => ({
        sender_id: senderId,
        recipient_id: recipientId,
        table_name: table.name.slice(0, 200),
        note: text || null,
        data: table,
      })),
    )
    .select("id, recipient_id")
  if (error) throw shareError(error)
  return (data ?? []).map((row) => ({ id: row.id as string, recipientId: row.recipient_id as string }))
}

/** What other people have shared with this person, newest first. */
export async function listShares(userId: string): Promise<VaultShare[]> {
  if (!supabase) {
    const mine = readPreview().filter((share) => share.recipientId === userId)
    const shares = await Promise.all(
      mine.map(async (share) => ({
        id: share.id,
        via: "online" as const,
        senderId: share.senderId,
        senderName: (await personById(share.senderId))?.name || "Someone",
        note: share.note,
        table: share.table,
        createdAt: share.createdAt,
      })),
    )
    return shares.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  const { data, error } = await supabase
    .from("vault_shares")
    .select("id, sender_id, table_name, note, data, created_at")
    .eq("recipient_id", userId)
    .order("created_at", { ascending: false })
    .limit(100)
  if (error) throw shareError(error)
  const shares: VaultShare[] = []
  for (const row of data ?? []) {
    const table = readShared(row.data, (row.table_name as string) || "Untitled")
    if (!table) continue
    shares.push({
      id: row.id as string,
      via: "online",
      senderId: row.sender_id as string,
      senderName: (await personById(row.sender_id as string))?.name || "Someone",
      note: (row.note as string | null) ?? "",
      table,
      createdAt: row.created_at as string,
    })
  }
  return shares
}

/** What this person has shared through Novaroom and neither side has removed yet, newest first. */
export async function listSentShares(userId: string): Promise<SentShare[]> {
  if (!supabase) {
    const mine = readPreview().filter((share) => share.senderId === userId)
    const sent = await Promise.all(
      mine.map(async (share) => ({
        id: share.id,
        via: "online" as const,
        recipientName: (await personById(share.recipientId))?.name || "Someone",
        tableName: share.table.name,
        createdAt: share.createdAt,
      })),
    )
    return sent.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  const { data, error } = await supabase
    .from("vault_shares")
    .select("id, recipient_id, table_name, created_at")
    .eq("sender_id", userId)
    .order("created_at", { ascending: false })
    .limit(200)
  if (error) throw shareError(error)
  const sent: SentShare[] = []
  for (const row of data ?? []) {
    sent.push({
      id: row.id as string,
      via: "online",
      recipientName: (await personById(row.recipient_id as string))?.name || "Someone",
      tableName: (row.table_name as string) || "Untitled",
      createdAt: row.created_at as string,
    })
  }
  return sent
}

// Local shares travel inside a Local chat message, as there is no server to keep them: the data is
// attached to the message, which shows a link to the shared data page in place of a file.
const LOCAL_SHARE_SUFFIX = ".vaultshare.json"

/** Whether a Local chat message's attachment is shared Vault data, shown as a link, not a file. */
export const isLocalShareFile = (name: string) => name.endsWith(LOCAL_SHARE_SUFFIX)

function localShareFileName(tableName: string) {
  const base = tableName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 80) || "Untitled"
  return `${base}${LOCAL_SHARE_SUFFIX}`
}

/**
 * Sends a copy of the table to each person over the office network, as a Local chat message to
 * them. Nothing goes through the server. They need to be on the network.
 */
export async function sendLocalShares(recipientIds: string[], table: SharedTable, note: string) {
  const people = [...new Set(recipientIds)]
  if (people.length === 0) throw new Error("Choose at least one person to share with.")
  if (table.columns.length === 0 || table.rows.length === 0) throw new Error("Choose at least one row and one column.")
  const text = note.trim().slice(0, SHARE_NOTE_LIMIT)
  const content = JSON.stringify({ novaroomVaultShare: 1, note: text, table })
  if (content.length > SHARE_LIMIT) throw new Error("That is too much to share at once. Choose fewer rows or columns.")
  const body = `Shared from my Vault: “${table.name}”${text ? `\n${text}` : ""}`
  for (const id of people) {
    // A file of its own each time: the app takes the file in when the message is sent.
    const file = new File([content], localShareFileName(table.name), { type: "application/json" })
    await sendLocalMessage(id, body, null, file)
  }
}

// Local share files already read, by message id, so each is only read from disk once.
const localShareFiles = new Map<string, { note: string; table: SharedTable } | null>()

async function readLocalShare(id: string, fallbackName: string) {
  if (localShareFiles.has(id)) return localShareFiles.get(id) ?? null
  let read: { note: string; table: SharedTable } | null = null
  try {
    const parsed = JSON.parse(new TextDecoder().decode(await localFileBytes(id))) as { note?: unknown; table?: unknown }
    const table = readShared(parsed?.table, fallbackName)
    if (table) read = { note: typeof parsed.note === "string" ? parsed.note.slice(0, SHARE_NOTE_LIMIT) : "", table }
  } catch {
    // Not a share after all, or not readable: left out.
  }
  localShareFiles.set(id, read)
  return read
}

/**
 * Shares that came or went over the office network: they are the Local chat messages on this
 * computer that carry a share. Nothing if Local chat is not running.
 */
export async function listLocalShares(userId: string): Promise<{ received: VaultShare[]; sent: SentShare[] }> {
  const received: VaultShare[] = []
  const sent: SentShare[] = []
  if (!inTauri()) return { received, sent }
  try {
    for (const chat of await localChats()) {
      for (const message of await localMessages(chat.chat)) {
        const name = message.file?.name ?? ""
        if (!name.endsWith(LOCAL_SHARE_SUFFIX)) continue
        const tableName = name.slice(0, -LOCAL_SHARE_SUFFIX.length) || "Untitled"
        const createdAt = new Date(message.sentAt).toISOString()
        if (message.senderId === userId) {
          sent.push({ id: message.id, via: "local", recipientName: chat.name || "Someone", tableName, createdAt })
        } else if (message.file?.state === "ready") {
          const share = await readLocalShare(message.id, tableName)
          if (share) {
            received.push({
              id: message.id,
              via: "local",
              senderId: message.senderId,
              senderName: message.senderName || "Someone",
              note: share.note,
              table: share.table,
              createdAt,
            })
          }
        }
      }
    }
  } catch {
    // Local chat is not running; whatever was found so far still counts.
  }
  return { received, sent }
}

/** Takes a share that came over the office network off this computer. The sender keeps theirs. */
export const removeLocalShare = (id: string) => deleteLocalMessages([id])

/**
 * Takes back a share sent over the office network: its message is deleted from this computer and
 * from the other person's. If they are away, theirs goes when they are back on the network.
 */
export const cancelLocalShare = (id: string) => deleteLocalMessagesForEveryone([id])

/** Calls back when a Local chat message or file arrives or goes, as it may be a share. Returns how to stop. */
export function subscribeToLocalShares(onChange: () => void): () => void {
  if (!inTauri()) return () => {}
  let stopped = false
  const stops: Array<() => void> = []
  void import("@tauri-apps/api/event").then(async ({ listen }) => {
    const listening = await Promise.all(
      ["local-chat-message", "local-chat-file", "local-chat-expired"].map((event) => listen(event, () => onChange())),
    )
    if (stopped) listening.forEach((stop) => stop())
    else stops.push(...listening)
  })
  return () => {
    stopped = true
    stops.forEach((stop) => stop())
  }
}

/**
 * Removes a share kept by Novaroom. For the person it was shared with, it leaves their list; for
 * the sender, it cancels the share. Tables already added to a Vault stay there.
 */
export async function removeShare(id: string) {
  if (!supabase) {
    writePreview(readPreview().filter((share) => share.id !== id))
    return
  }
  const { error } = await supabase.from("vault_shares").delete().eq("id", id)
  if (error) throw shareError(error)
}

/** Calls back when something is shared with this person, or a share is removed. Returns how to stop. */
export function subscribeToShares(userId: string, onChange: () => void): () => void {
  if (!supabase) return () => {}
  const client = supabase
  const channel: RealtimeChannel = client
    .channel(`novaroom-vault-shares:${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "vault_shares", filter: `recipient_id=eq.${userId}` },
      onChange,
    )
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "vault_shares" }, onChange)
    .subscribe()
  return () => {
    void client.removeChannel(channel)
  }
}

/**
 * A shared copy as a new table for this Vault, with ids of its own so adding the same share twice
 * (or a share of a table already here) never clashes. Its name says who it came from if taken.
 */
export function tableFromShare(share: VaultShare, tables: VaultTable[], category: string): VaultTable {
  const taken = new Set(tables.map((table) => table.name.trim().toLowerCase()))
  let name = share.table.name
  if (taken.has(name.trim().toLowerCase())) name = `${share.table.name} (from ${share.senderName})`
  for (let count = 2; taken.has(name.trim().toLowerCase()); count += 1) {
    name = `${share.table.name} (from ${share.senderName}) ${count}`
  }

  const fresh = (columns: VaultColumn[]) =>
    columns.map((column) => ({ from: column.id, column: { ...column, id: crypto.randomUUID() } as VaultColumn }))
  const copyRows = (rows: VaultRow[], columns: ReturnType<typeof fresh>): VaultRow[] =>
    rows.map((row) => {
      const cells: Record<string, VaultCell> = {}
      for (const { from, column } of columns) {
        const value = row.cells[from]
        if (value === null || value === undefined) continue
        if (column.kind === "subtable") {
          // The inner columns were given their ids when the column was copied.
          const inner = (column.columns ?? []).map((item, index) => ({
            from: (share.table.columns.find((source) => source.id === from)?.columns ?? [])[index]?.id ?? "",
            column: item,
          }))
          const items = copyRows(subRows(value), inner)
          if (items.length > 0) cells[column.id] = items
        } else if (Array.isArray(value)) {
          const lines = listItems(value)
          if (lines.length > 0) cells[column.id] = column.kind === "list" ? lines : lines.join("\n")
        } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          cells[column.id] = value
        }
      }
      return { id: crypto.randomUUID(), cells }
    })

  const columns = fresh(share.table.columns).map(({ from, column }) => ({
    from,
    column:
      column.kind === "subtable"
        ? { ...column, columns: (column.columns ?? []).map((item) => ({ ...item, id: crypto.randomUUID() })) }
        : column,
  }))
  return {
    id: crypto.randomUUID(),
    name,
    category,
    columns: columns.map((item) => item.column),
    rows: copyRows(share.table.rows, columns),
  }
}
