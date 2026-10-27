import type { RealtimeChannel } from "@supabase/supabase-js"
import { emptyProfile, type Profile, type Session } from "../types"
import { supabase } from "./supabase"
import { PREVIEW_CHATS_KEY, PREVIEW_PROFILES_KEY, previewUserId, normalizeEmail } from "./preview"
import {
  messagingLock,
  messagingLockMessage,
  previewBlockedIds,
  previewEitherBlocked,
  publishChatEvent,
} from "./safety"
import { ensurePreviewRooms } from "./rooms"

const FILE_LIMIT = 25 * 1024 * 1024
const PREVIEW_FILE_LIMIT = 8 * 1024 * 1024

export type ChatSummary = {
  id: string
  kind: "direct" | "group" | "room"
  title: string
  detail: string
  avatarUrl: string | null
  otherUserId: string | null
  memberCount: number
  lastBody: string
  lastAt: string | null
}

export type ChatMessage = {
  id: string
  conversationId: string
  senderId: string
  senderName: string
  senderAvatarUrl?: string | null
  body: string
  createdAt: string
  deleted: boolean
  attachmentUrl: string | null
  attachmentName: string | null
  attachmentMime: string | null
  attachmentSize: number | null
}

type LocalConversation = {
  id: string
  memberIds: string[]
  createdAt: string
  kind?: "direct" | "group" | "room"
  title?: string | null
  description?: string | null
}

type LocalDb = {
  conversations: LocalConversation[]
  messages: ChatMessage[]
  // What each person cleared or deleted for themselves, by "userId:conversationId".
  hidden?: Record<string, { clearedAt: string | null; ids: string[] }>
}

type MessageRow = {
  id: string
  conversation_id: string
  sender_id: string | null
  body: string | null
  created_at: string
  deleted_at?: string | null
  attachment_path?: string | null
  attachment_name?: string | null
  attachment_mime?: string | null
  attachment_size?: number | null
}

const MESSAGE_COLUMNS =
  "id, conversation_id, sender_id, body, created_at, attachment_path, attachment_name, attachment_mime, attachment_size"

export function messageLabel(message: Pick<ChatMessage, "body" | "attachmentName" | "deleted">) {
  if (message.deleted) return "Message deleted"
  const text = message.body.trim()
  if (text) return text
  return message.attachmentName || "Attachment"
}

function readDb(): LocalDb {
  const raw = localStorage.getItem(PREVIEW_CHATS_KEY)
  if (!raw) return { conversations: [], messages: [] }
  try {
    const parsed = JSON.parse(raw) as LocalDb
    return {
      conversations: parsed.conversations ?? [],
      messages: parsed.messages ?? [],
      hidden: parsed.hidden ?? {},
    }
  } catch {
    return { conversations: [], messages: [] }
  }
}

function writeDb(db: LocalDb) {
  localStorage.setItem(PREVIEW_CHATS_KEY, JSON.stringify(db))
}

function readProfiles(): Record<string, Profile> {
  const raw = localStorage.getItem(PREVIEW_PROFILES_KEY)
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, Profile>
  } catch {
    return {}
  }
}

function byRecent(a: ChatSummary, b: ChatSummary) {
  return (b.lastAt ?? "").localeCompare(a.lastAt ?? "")
}

function emailFor(userId: string) {
  const raw = localStorage.getItem("novaroom.preview.emails")
  if (!raw) return ""
  try {
    const map = JSON.parse(raw) as Record<string, string>
    return map[userId] ?? ""
  } catch {
    return ""
  }
}

function rememberEmail(userId: string, email: string) {
  const raw = localStorage.getItem("novaroom.preview.emails")
  let map: Record<string, string> = {}
  if (raw) {
    try {
      map = JSON.parse(raw) as Record<string, string>
    } catch {
      map = {}
    }
  }
  map[userId] = email
  localStorage.setItem("novaroom.preview.emails", JSON.stringify(map))
}

function ensurePreviewPerson(email: string) {
  const userId = previewUserId(email)
  const profiles = readProfiles()
  if (!profiles[userId]) {
    profiles[userId] = emptyProfile(email)
    localStorage.setItem(PREVIEW_PROFILES_KEY, JSON.stringify(profiles))
  }
  rememberEmail(userId, email)
  return userId
}

function senderName(userId: string) {
  return readProfiles()[userId]?.displayName || "Trainer"
}

function senderAvatar(userId: string) {
  return readProfiles()[userId]?.avatarUrl ?? null
}

/** What one person no longer sees in a chat: everything up to clearedAt, and the messages in ids. */
type Hidden = { clearedAt: string | null; ids: ReadonlySet<string> }

const NOTHING_HIDDEN: Hidden = { clearedAt: null, ids: new Set() }

function isShown(message: Pick<ChatMessage, "id" | "createdAt">, hidden: Hidden) {
  return (!hidden.clearedAt || message.createdAt > hidden.clearedAt) && !hidden.ids.has(message.id)
}

function previewHidden(db: LocalDb, userId: string, conversationId: string): Hidden {
  const entry = db.hidden?.[`${userId}:${conversationId}`]
  return entry ? { clearedAt: entry.clearedAt, ids: new Set(entry.ids) } : NOTHING_HIDDEN
}

function summaryFor(conversation: LocalConversation, session: Session, db: LocalDb): ChatSummary {
  const kind = conversation.kind ?? "direct"
  const blocked = previewBlockedIds(session.userId)
  const hidden = previewHidden(db, session.userId, conversation.id)
  const thread = db.messages
    .filter(
      (message) =>
        message.conversationId === conversation.id &&
        (message.senderId === session.userId || !blocked.has(message.senderId)) &&
        isShown(message, hidden),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const latest = thread[thread.length - 1]
  const lastBody = latest ? messageLabel({ ...latest, deleted: Boolean(latest.deleted) }) : ""
  const lastAt = latest?.createdAt ?? conversation.createdAt

  if (kind === "group" || kind === "room") {
    return {
      id: conversation.id,
      kind,
      title: conversation.title?.trim() || (kind === "room" ? "Room" : "Group"),
      detail:
        kind === "room"
          ? conversation.description?.trim() || "Topic room"
          : `${conversation.memberIds.length} people`,
      avatarUrl: null,
      otherUserId: null,
      memberCount: conversation.memberIds.length,
      lastBody,
      lastAt,
    }
  }

  const otherId = conversation.memberIds.find((id) => id !== session.userId) ?? ""
  const other = otherId ? readProfiles()[otherId] : undefined
  return {
    id: conversation.id,
    kind: "direct",
    title: otherId ? other?.displayName || "Trainer" : conversation.title?.trim() || "Deleted account",
    detail: otherId ? emailFor(otherId) : "Account deleted",
    avatarUrl: other?.avatarUrl ?? null,
    otherUserId: otherId || null,
    memberCount: conversation.memberIds.length,
    lastBody,
    lastAt,
  }
}

function parseEmails(value: string) {
  const parts = value.split(/[\s,;]+/).map((part) => part.trim()).filter(Boolean)
  const unique: string[] = []
  for (const part of parts) {
    const email = normalizeEmail(part)
    if (!unique.includes(email)) unique.push(email)
  }
  return unique
}

export function safeFileName(name: string) {
  const base = name.split(/[/\\]/).pop() ?? "file"
  const cleaned = base.replace(/[^\w.\- ()]/g, "_").slice(0, 120)
  return cleaned || "file"
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("Could not read that file."))
    reader.readAsDataURL(file)
  })
}

async function previewFileUrl(file: File) {
  if (file.type.startsWith("image/") && file.type !== "image/svg+xml") {
    return readAsDataUrl(file)
  }
  if (file.size > PREVIEW_FILE_LIMIT) {
    throw new Error("This preview keeps files up to 8 MB. Connected projects allow 25 MB.")
  }
  return readAsDataUrl(file)
}

function assertFileSize(file: File) {
  if (file.size > FILE_LIMIT) {
    throw new Error("Files must be 25 MB or smaller.")
  }
}

type Sender = { name: string; avatarUrl: string | null }

async function sendersFor(userIds: Array<string | null | undefined>) {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))]
  const senders = new Map<string, Sender>()
  if (!supabase || ids.length === 0) {
    for (const id of ids) senders.set(id, { name: senderName(id), avatarUrl: senderAvatar(id) })
    return senders
  }
  const { data, error } = await supabase.from("profiles").select("id, display_name, avatar_url").in("id", ids)
  if (error) throw error
  for (const profile of data ?? []) {
    senders.set(profile.id as string, {
      name: (profile.display_name as string) || "Trainer",
      avatarUrl: (profile.avatar_url as string | null) ?? null,
    })
  }
  return senders
}

async function signedUrls(paths: string[]) {
  const urls = new Map<string, string>()
  if (!supabase || paths.length === 0) return urls
  const { data, error } = await supabase.storage.from("chat-files").createSignedUrls(paths, 60 * 60)
  if (error) throw error
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl)
  }
  return urls
}

function rowToMessage(
  row: MessageRow,
  senders: Map<string, Sender>,
  urls: Map<string, string>,
): ChatMessage {
  const deleted = Boolean(row.deleted_at)
  const path = deleted ? null : (row.attachment_path ?? null)
  const senderId = row.sender_id ?? ""
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId,
    senderName: senderId ? senders.get(senderId)?.name || "Trainer" : "Deleted account",
    senderAvatarUrl: senderId ? (senders.get(senderId)?.avatarUrl ?? null) : null,
    body: deleted ? "" : (row.body ?? ""),
    createdAt: row.created_at,
    deleted,
    attachmentUrl: path ? urls.get(path) ?? null : null,
    attachmentName: deleted ? null : (row.attachment_name ?? null),
    attachmentMime: deleted ? null : (row.attachment_mime ?? null),
    attachmentSize: deleted ? null : (row.attachment_size ?? null),
  }
}

function withDeleted(message: ChatMessage): ChatMessage {
  return {
    ...message,
    deleted: Boolean(message.deleted),
    attachmentUrl: message.attachmentUrl ?? null,
    attachmentName: message.attachmentName ?? null,
    attachmentMime: message.attachmentMime ?? null,
    attachmentSize: message.attachmentSize ?? null,
  }
}

/** A chat's messages that this person still sees, newest last unless `newestFirst`. */
function shownMessages(columns: string, conversationId: string, hidden: Hidden, newestFirst = false) {
  let query = supabase!.from("messages").select(columns).eq("conversation_id", conversationId)
  if (hidden.clearedAt) query = query.gt("created_at", hidden.clearedAt)
  if (hidden.ids.size > 0) query = query.not("id", "in", `(${[...hidden.ids].join(",")})`)
  return query.order("created_at", { ascending: !newestFirst })
}

/**
 * What this person cleared or deleted for themselves, in every chat. Nothing is hidden when the
 * hidden messages SQL script has not been run yet.
 */
async function loadHidden(userId: string): Promise<Map<string, Hidden>> {
  const hidden = new Map<string, { clearedAt: string | null; ids: Set<string> }>()
  if (!supabase) return hidden
  const [cleared, rows] = await Promise.all([
    supabase.from("conversation_members").select("conversation_id, cleared_at").eq("user_id", userId),
    supabase.from("hidden_messages").select("conversation_id, message_id").eq("user_id", userId),
  ])
  const entry = (conversationId: string) => {
    let found = hidden.get(conversationId)
    if (!found) {
      found = { clearedAt: null, ids: new Set() }
      hidden.set(conversationId, found)
    }
    return found
  }
  for (const row of (cleared.error ? [] : cleared.data) as Array<{ conversation_id: string; cleared_at: string | null }>) {
    if (row.cleared_at) entry(row.conversation_id).clearedAt = row.cleared_at
  }
  for (const row of (rows.error ? [] : rows.data) as Array<{ conversation_id: string; message_id: string }>) {
    entry(row.conversation_id).ids.add(row.message_id)
  }
  return hidden
}

async function latestMessage(conversationId: string, hidden: Hidden) {
  if (!supabase) return null
  const first = await shownMessages("body, created_at, attachment_name, deleted_at", conversationId, hidden, true)
    .limit(1)
    .maybeSingle()
  if (first.error && /deleted_at/.test(first.error.message)) {
    const second = await shownMessages("body, created_at, attachment_name", conversationId, hidden, true)
      .limit(1)
      .maybeSingle()
    if (second.error) throw second.error
    return second.data as { body: string | null; created_at: string; attachment_name: string | null } | null
  }
  if (first.error) throw first.error
  return first.data as { body: string | null; created_at: string; attachment_name: string | null; deleted_at: string | null } | null
}

async function loadConversationRows(ids: string[]) {
  if (!supabase) return { data: [], error: null }
  const first = await supabase.from("conversations").select("id, kind, title, description").in("id", ids)
  if (first.error && /description/.test(first.error.message)) {
    return supabase.from("conversations").select("id, kind, title").in("id", ids)
  }
  return first
}

export async function listChats(session: Session): Promise<ChatSummary[]> {
  if (!supabase) {
    ensurePreviewRooms()
    const db = readDb()
    return db.conversations
      .filter((conversation) => conversation.memberIds.includes(session.userId))
      .map((conversation) => summaryFor(conversation, session, db))
      .sort(byRecent)
  }

  const [{ data: mine, error }, hiddenByChat] = await Promise.all([
    supabase.from("conversation_members").select("conversation_id").eq("user_id", session.userId),
    loadHidden(session.userId),
  ])
  if (error) throw error
  const ids = (mine ?? []).map((row) => row.conversation_id as string)
  if (ids.length === 0) return []

  const { data: conversations, error: conversationError } = await loadConversationRows(ids)
  if (conversationError) throw conversationError

  const { data: members, error: membersError } = await supabase
    .from("conversation_members")
    .select("conversation_id, user_id")
    .in("conversation_id", ids)
  if (membersError) throw membersError

  const membersByChat = new Map<string, string[]>()
  for (const member of members ?? []) {
    const conversationId = member.conversation_id as string
    const userId = member.user_id as string
    const list = membersByChat.get(conversationId) ?? []
    list.push(userId)
    membersByChat.set(conversationId, list)
  }

  const otherIds = [
    ...new Set(
      [...membersByChat.values()].flat().filter((userId) => userId !== session.userId),
    ),
  ]
  const { data: profiles, error: profileError } = otherIds.length
    ? await supabase.from("profiles").select("id, display_name, avatar_url").in("id", otherIds)
    : { data: [], error: null }
  if (profileError) throw profileError
  const profileById = new Map(
    (profiles ?? []).map((profile) => [profile.id as string, profile]),
  )

  const summaries = await Promise.all(
    (conversations ?? []).map(async (conversation) => {
      const id = conversation.id as string
      const kind = (conversation.kind as "direct" | "group" | "room") || "direct"
      const memberIds = membersByChat.get(id) ?? []
      const latest = await latestMessage(id, hiddenByChat.get(id) ?? NOTHING_HIDDEN)
      const lastBody = latest
        ? messageLabel({
            body: (latest.body as string | null) ?? "",
            attachmentName: (latest.attachment_name as string | null) ?? null,
            deleted: Boolean("deleted_at" in latest && latest.deleted_at),
          })
        : ""
      if (kind === "group" || kind === "room") {
        return {
          id,
          kind,
          title: ((conversation.title as string | null) ?? "").trim() || (kind === "room" ? "Room" : "Group"),
          detail:
            kind === "room"
              ? ((conversation as { description?: string | null }).description ?? "").trim() || "Topic room"
              : `${memberIds.length} people`,
          avatarUrl: null,
          otherUserId: null,
          memberCount: memberIds.length,
          lastBody,
          lastAt: (latest?.created_at as string) ?? null,
        } satisfies ChatSummary
      }
      const otherId = memberIds.find((userId) => userId !== session.userId) ?? ""
      const profile = profileById.get(otherId)
      const title = !otherId
        ? ((conversation.title as string | null) ?? "").trim() || "Deleted account"
        : (profile?.display_name as string) || "Trainer"
      return {
        id,
        kind: "direct" as const,
        title,
        detail: otherId ? "" : "Account deleted",
        avatarUrl: (profile?.avatar_url as string | null) ?? null,
        otherUserId: otherId || null,
        memberCount: memberIds.length,
        lastBody,
        lastAt: (latest?.created_at as string) ?? null,
      } satisfies ChatSummary
    }),
  )
  return summaries.sort(byRecent)
}

// Finds or creates the preview direct chat between the signed-in person and otherId.
function previewDirectChat(session: Session, otherId: string): string {
  const db = readDb()
  const existing = db.conversations.find((conversation) => {
    const kind = conversation.kind ?? "direct"
    return (
      kind === "direct" &&
      conversation.memberIds.includes(session.userId) &&
      conversation.memberIds.includes(otherId)
    )
  })
  if (previewEitherBlocked(session.userId, otherId)) {
    if (existing) return existing.id
    throw new Error("You cannot message this person.")
  }
  if (existing) return existing.id
  const created: LocalConversation = {
    id: crypto.randomUUID(),
    memberIds: [session.userId, otherId],
    createdAt: new Date().toISOString(),
    kind: "direct",
    title: null,
  }
  db.conversations.push(created)
  writeDb(db)
  return created.id
}

export async function startDirectChat(session: Session, email: string): Promise<string> {
  const normalized = normalizeEmail(email)
  if (normalized === session.email) {
    throw new Error("You cannot start a chat with yourself.")
  }

  if (!supabase) {
    rememberEmail(session.userId, session.email)
    return previewDirectChat(session, ensurePreviewPerson(normalized))
  }

  const { data, error } = await supabase.rpc("start_direct_chat", {
    other_email: normalized,
  })
  if (error) throw new Error(error.message)
  if (!data) throw new Error("Could not start that chat.")
  return data as string
}

// Leadership members start a direct chat with another leader by user id (no email needed).
// The database refuses unless both people have the Leadership role.
export async function startLeaderChat(session: Session, otherId: string): Promise<string> {
  if (otherId === session.userId) throw new Error("You cannot start a chat with yourself.")
  if (!supabase) return previewDirectChat(session, otherId)
  const { data, error } = await supabase.rpc("start_leader_chat", { other: otherId })
  if (error) throw new Error(error.message)
  if (!data) throw new Error("Could not start that chat.")
  return data as string
}

export async function startGroupChat(session: Session, title: string, emails: string): Promise<string> {
  const cleanTitle = title.trim()
  if (!cleanTitle || cleanTitle.length > 80) {
    throw new Error("Give the group a name up to 80 characters.")
  }
  const people = parseEmails(emails).filter((email) => email !== session.email)
  if (people.length === 0) {
    throw new Error("Add at least one other person.")
  }
  if (people.length + 1 > 50) {
    throw new Error("Groups can include up to 50 people.")
  }

  if (!supabase) {
    rememberEmail(session.userId, session.email)
    const memberIds = [session.userId, ...people.map((email) => ensurePreviewPerson(email))]
    if (memberIds.some((id) => id !== session.userId && previewEitherBlocked(session.userId, id))) {
      throw new Error("You cannot add someone you cannot message.")
    }
    const created: LocalConversation = {
      id: crypto.randomUUID(),
      memberIds,
      createdAt: new Date().toISOString(),
      kind: "group",
      title: cleanTitle,
    }
    const db = readDb()
    db.conversations.push(created)
    writeDb(db)
    return created.id
  }

  const { data, error } = await supabase.rpc("start_group_chat", {
    group_title: cleanTitle,
    member_emails: people,
  })
  if (error) throw new Error(error.message)
  if (!data) throw new Error("Could not create that group.")
  return data as string
}

export async function loadMessages(session: Session, conversationId: string): Promise<ChatMessage[]> {
  if (!supabase) {
    const db = readDb()
    const hidden = previewHidden(db, session.userId, conversationId)
    return db.messages
      .filter((message) => message.conversationId === conversationId && isShown(message, hidden))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((message) =>
        withDeleted({
          ...message,
          deleted: Boolean(message.deleted),
          senderName: message.senderName || senderName(message.senderId),
          senderAvatarUrl: senderAvatar(message.senderId),
        }),
      )
  }

  const hidden = (await loadHidden(session.userId)).get(conversationId) ?? NOTHING_HIDDEN
  const first = await shownMessages(`${MESSAGE_COLUMNS}, deleted_at`, conversationId, hidden).limit(500)
  const result =
    first.error && /deleted_at/.test(first.error.message)
      ? await shownMessages(MESSAGE_COLUMNS, conversationId, hidden).limit(500)
      : first
  if (result.error) throw result.error
  const rows = (result.data ?? []) as unknown as MessageRow[]
  const senders = await sendersFor([...new Set(rows.map((row) => row.sender_id))])
  const urls = await signedUrls(
    rows.map((row) => row.attachment_path).filter((path): path is string => Boolean(path)),
  )
  return rows.map((row) => rowToMessage(row, senders, urls))
}

/** Removes messages from this person's view of a chat. Everyone else still sees them. */
export async function hideMessages(session: Session, conversationId: string, ids: string[]) {
  if (ids.length === 0) return
  if (!supabase) {
    const db = readDb()
    const key = `${session.userId}:${conversationId}`
    const entry = db.hidden?.[key] ?? { clearedAt: null, ids: [] }
    db.hidden = { ...db.hidden, [key]: { ...entry, ids: [...new Set([...entry.ids, ...ids])] } }
    writeDb(db)
    return
  }
  const { error } = await supabase.rpc("hide_messages", { cid: conversationId, message_ids: ids })
  if (error) throw hiddenMessagesError(error)
}

/** Removes every message so far from this person's view of a chat. Everyone else still sees them. */
export async function clearConversation(session: Session, conversationId: string) {
  if (!supabase) {
    const db = readDb()
    db.hidden = { ...db.hidden, [`${session.userId}:${conversationId}`]: { clearedAt: new Date().toISOString(), ids: [] } }
    writeDb(db)
    return
  }
  const { error } = await supabase.rpc("clear_conversation", { cid: conversationId })
  if (error) throw hiddenMessagesError(error)
}

function hiddenMessagesError(error: { message: string }) {
  if (/does not exist|schema cache|Could not find the function|404/i.test(error.message)) {
    return new Error("Run the hidden messages SQL script (20261026120000_hidden_messages.sql), then try again.")
  }
  return new Error(error.message)
}

export async function sendMessage(
  session: Session,
  conversationId: string,
  body: string,
  file?: File | null,
): Promise<ChatMessage> {
  const text = body.trim()
  if (!text && !file) throw new Error("Write a message or choose a file.")
  if (text.length > 4000) throw new Error("Messages are limited to 4000 characters.")
  if (file) assertFileSize(file)
  const lock = await messagingLock(session, conversationId)
  if (lock !== "open") throw new Error(messagingLockMessage(lock))

  if (!supabase) {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId,
      senderId: session.userId,
      senderName: senderName(session.userId),
      senderAvatarUrl: senderAvatar(session.userId),
      body: text,
      createdAt: new Date().toISOString(),
      deleted: false,
      attachmentUrl: file ? await previewFileUrl(file) : null,
      attachmentName: file?.name ?? null,
      attachmentMime: file?.type || null,
      attachmentSize: file?.size ?? null,
    }
    const db = readDb()
    db.messages.push(message)
    writeDb(db)
    publishChatEvent({ type: "insert", message })
    return message
  }

  let attachmentPath: string | null = null
  if (file) {
    attachmentPath = `${conversationId}/${crypto.randomUUID()}/${safeFileName(file.name)}`
    const { error: uploadError } = await supabase.storage.from("chat-files").upload(attachmentPath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    })
    if (uploadError) throw new Error(uploadError.message)
  }

  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: session.userId,
      body: text || null,
      attachment_path: attachmentPath,
      attachment_name: file?.name ?? null,
      attachment_mime: file?.type || null,
      attachment_size: file?.size ?? null,
    })
    .select(
      "id, conversation_id, sender_id, body, created_at, attachment_path, attachment_name, attachment_mime, attachment_size",
    )
    .single()
  if (error) {
    if (attachmentPath) {
      await supabase.storage.from("chat-files").remove([attachmentPath])
    }
    throw new Error(error.message)
  }

  const row = data as MessageRow
  const senders = await sendersFor([row.sender_id])
  const urls = await signedUrls(row.attachment_path ? [row.attachment_path] : [])
  return rowToMessage(row, senders, urls)
}

async function messageFromRow(row: MessageRow) {
  const senders = await sendersFor([row.sender_id])
  const urls = await signedUrls(row.attachment_path ? [row.attachment_path] : [])
  return rowToMessage(row, senders, urls)
}

export function subscribeToMessages(handlers: {
  onInsert: (message: ChatMessage) => void
  onUpdate: (message: ChatMessage) => void
  onRefresh: () => void
}) {
  if (!supabase) {
    const channel = new BroadcastChannel("novaroom-messages")
    channel.onmessage = (event) => {
      const data = event.data as { type?: string; message?: ChatMessage }
      if (data?.type === "refresh") {
        handlers.onRefresh()
        return
      }
      const message = data?.message ?? (event.data as ChatMessage)
      if (!message?.id) return
      const next = withDeleted({
        ...message,
        senderName: message.senderName || senderName(message.senderId),
        senderAvatarUrl: senderAvatar(message.senderId),
      })
      if (data?.type === "update") handlers.onUpdate(next)
      else handlers.onInsert(next)
    }
    return () => channel.close()
  }

  const client = supabase
  const channel: RealtimeChannel = client
    // A fresh topic each time: reusing one that is still closing would leave this subscription dead.
    .channel(`novaroom-messages:${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        void messageFromRow(payload.new as MessageRow).then(handlers.onInsert)
      },
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages" },
      (payload) => {
        void messageFromRow(payload.new as MessageRow).then(handlers.onUpdate)
      },
    )
    .subscribe()

  return () => {
    void client.removeChannel(channel)
  }
}

export type ChatPermissions = { direct: boolean; group: boolean }

// Whether an admin has let this person start new direct chats and groups. Leadership members are
// always allowed (the caller adds that). Offline preview has no admins, so everything is allowed.
// The database enforces this too; this only decides whether the buttons are enabled.
export async function readChatPermissions(session: Session): Promise<ChatPermissions> {
  if (!supabase) return { direct: true, group: true }
  const { data, error } = await supabase
    .from("chat_permissions")
    .select("can_start_direct, can_start_group")
    .eq("user_id", session.userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const row = data as { can_start_direct: boolean; can_start_group: boolean } | null
  return { direct: Boolean(row?.can_start_direct), group: Boolean(row?.can_start_group) }
}

// Read receipts -----------------------------------------------------------------

/** How far each member has read a chat: their id, then the created_at of the newest message seen. */
export type ReadStates = Record<string, string | null>

export async function loadReadStates(conversationId: string): Promise<ReadStates> {
  if (!supabase) return {}
  const { data, error } = await supabase
    .from("conversation_members")
    .select("user_id, last_read_at")
    .eq("conversation_id", conversationId)
  if (error) throw new Error(error.message)
  const rows = data as Array<{ user_id: string; last_read_at: string | null }>
  return Object.fromEntries(rows.map((row) => [row.user_id, row.last_read_at]))
}

// The newest message already reported as read in each chat, so the same one is not sent twice.
const reportedRead = new Map<string, number>()

/** Tells the others in a chat that this person has seen it up to the message sent at `upTo`. */
export async function markConversationRead(conversationId: string, upTo: string) {
  if (!supabase) return
  const at = Date.parse(upTo)
  if ((reportedRead.get(conversationId) ?? 0) >= at) return
  reportedRead.set(conversationId, at)
  const { error } = await supabase.rpc("mark_conversation_read", { cid: conversationId, read_up_to: upTo })
  if (error) {
    reportedRead.delete(conversationId)
    throw new Error(error.message)
  }
}

/** Calls onChange whenever someone in the chat reads further. Returns a function that stops it. */
export function subscribeToReadStates(conversationId: string, onChange: (userId: string, lastReadAt: string | null) => void) {
  if (!supabase) return () => {}
  const client = supabase
  const channel = client
    .channel(`chat-reads:${conversationId}:${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "conversation_members", filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        const row = payload.new as { user_id: string; last_read_at: string | null }
        onChange(row.user_id, row.last_read_at)
      },
    )
    .subscribe()
  return () => {
    void client.removeChannel(channel)
  }
}

/**
 * Whether one of this person's messages has been read: by the other person in a direct chat, by
 * everyone else in a group, and by anyone else in a room, where people come and go.
 */
export function isMessageRead(states: ReadStates, selfId: string, kind: ChatSummary["kind"], createdAt: string) {
  const sent = Date.parse(createdAt)
  const others = Object.entries(states).filter(([id]) => id !== selfId)
  if (others.length === 0) return false
  const seen = ([, at]: [string, string | null]) => at !== null && Date.parse(at) >= sent
  return kind === "room" ? others.some(seen) : others.every(seen)
}

// Profile changes ---------------------------------------------------------------

export type ProfileChange = { userId: string; displayName: string; avatarUrl: string | null }

/**
 * Calls onChange when anyone changes their name or profile picture, so messages already on screen
 * can show the new one. Returns a function that stops listening.
 */
export function subscribeToProfileChanges(onChange: (change: ProfileChange) => void) {
  if (!supabase) return () => {}
  const client = supabase
  const channel = client
    .channel(`profile-changes:${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, (payload) => {
      const row = payload.new as { id: string; display_name: string | null; avatar_url: string | null }
      onChange({ userId: row.id, displayName: row.display_name ?? "", avatarUrl: row.avatar_url })
    })
    .subscribe()
  return () => {
    void client.removeChannel(channel)
  }
}
