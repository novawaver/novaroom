import type { Session } from "../types"
import { PREVIEW_CHATS_KEY, PREVIEW_PROFILES_KEY } from "./preview"
import { supabase } from "./supabase"

const BLOCKS_KEY = "novaroom.preview.blocks"
const REPORTS_KEY = "novaroom.preview.reports"

export type MessagingLock = "open" | "blocked-by-you" | "blocked" | "deleted"

export type BlockedPerson = {
  userId: string
  displayName: string
}

export type ReportReason = "harassment" | "spam" | "leak" | "other"

type BlockRow = {
  blockerId: string
  blockedId: string
}

type StoredMessage = {
  id: string
  conversationId: string
  senderId: string
  senderName: string
  body: string
  createdAt: string
  attachmentUrl: string | null
  attachmentName: string | null
  attachmentMime: string | null
  attachmentSize: number | null
  deleted?: boolean
}

type StoredConversation = {
  id: string
  memberIds: string[]
  createdAt: string
  kind?: "direct" | "group" | "room"
  title?: string | null
}

type StoredDb = {
  conversations: StoredConversation[]
  messages: StoredMessage[]
}

export function messagingLockMessage(lock: MessagingLock) {
  if (lock === "blocked-by-you") return "You blocked this person. Unblock them to send messages."
  if (lock === "blocked") return "You cannot message this person."
  if (lock === "deleted") return "This account was deleted."
  return ""
}

export function safetyError(error: { message: string }) {
  if (/does not exist|schema cache|Could not find the function|404/i.test(error.message)) {
    return new Error("Run the safety SQL script in the README, then try again.")
  }
  return new Error(error.message)
}

function readBlocks(): BlockRow[] {
  const raw = localStorage.getItem(BLOCKS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as BlockRow[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeBlocks(rows: BlockRow[]) {
  localStorage.setItem(BLOCKS_KEY, JSON.stringify(rows))
  window.dispatchEvent(new Event("novaroom-safety"))
}

function readDb(): StoredDb {
  const raw = localStorage.getItem(PREVIEW_CHATS_KEY)
  if (!raw) return { conversations: [], messages: [] }
  try {
    const parsed = JSON.parse(raw) as StoredDb
    return {
      conversations: parsed.conversations ?? [],
      messages: parsed.messages ?? [],
    }
  } catch {
    return { conversations: [], messages: [] }
  }
}

function writeDb(db: StoredDb) {
  localStorage.setItem(PREVIEW_CHATS_KEY, JSON.stringify(db))
}

function readProfiles(): Record<string, { displayName?: string }> {
  const raw = localStorage.getItem(PREVIEW_PROFILES_KEY)
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, { displayName?: string }>
  } catch {
    return {}
  }
}

export function publishChatEvent(packet: object) {
  const channel = new BroadcastChannel("novaroom-messages")
  channel.postMessage(packet)
  channel.close()
}

export function previewBlockedIds(userId: string) {
  return new Set(
    readBlocks()
      .filter((row) => row.blockerId === userId)
      .map((row) => row.blockedId),
  )
}

export function previewEitherBlocked(a: string, b: string) {
  return readBlocks().some(
    (row) =>
      (row.blockerId === a && row.blockedId === b) ||
      (row.blockerId === b && row.blockedId === a),
  )
}

function previewNames(userIds: string[]) {
  const profiles = readProfiles()
  return userIds.map((userId) => ({
    userId,
    displayName: profiles[userId]?.displayName || "Trainer",
  }))
}

export async function listBlocked(session: Session): Promise<BlockedPerson[]> {
  if (!supabase) {
    return previewNames([...previewBlockedIds(session.userId)])
  }
  const { data, error } = await supabase
    .from("blocks")
    .select("blocked_id")
    .eq("blocker_id", session.userId)
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return []
    throw safetyError(error)
  }
  const ids = (data ?? []).map((row) => row.blocked_id as string)
  if (ids.length === 0) return []
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", ids)
  if (profileError) throw profileError
  const names = new Map(
    (profiles ?? []).map((profile) => [profile.id as string, (profile.display_name as string) || "Trainer"]),
  )
  return ids.map((userId) => ({ userId, displayName: names.get(userId) || "Trainer" }))
}

export async function blockUser(session: Session, userId: string) {
  if (!userId || userId === session.userId) {
    throw new Error("You cannot block yourself.")
  }
  if (!supabase) {
    const rows = readBlocks().filter(
      (row) => !(row.blockerId === session.userId && row.blockedId === userId),
    )
    rows.push({ blockerId: session.userId, blockedId: userId })
    writeBlocks(rows)
    return
  }
  const { error } = await supabase.from("blocks").insert({
    blocker_id: session.userId,
    blocked_id: userId,
  })
  if (error && !/duplicate key/i.test(error.message)) throw safetyError(error)
  window.dispatchEvent(new Event("novaroom-safety"))
}

export async function unblockUser(session: Session, userId: string) {
  if (!supabase) {
    writeBlocks(
      readBlocks().filter((row) => !(row.blockerId === session.userId && row.blockedId === userId)),
    )
    return
  }
  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_id", session.userId)
    .eq("blocked_id", userId)
  if (error) throw safetyError(error)
  window.dispatchEvent(new Event("novaroom-safety"))
}

export async function messagingLock(session: Session, conversationId: string): Promise<MessagingLock> {
  if (!supabase) {
    const conversation = readDb().conversations.find((item) => item.id === conversationId)
    if (!conversation) return "open"
    const kind = conversation.kind ?? "direct"
    if (kind === "group" || kind === "room") return "open"
    const otherId = conversation.memberIds.find((id) => id !== session.userId) ?? ""
    if (!otherId) return "deleted"
    if (previewBlockedIds(session.userId).has(otherId)) return "blocked-by-you"
    if (previewEitherBlocked(session.userId, otherId)) return "blocked"
    return "open"
  }

  const { data: conversation, error } = await supabase
    .from("conversations")
    .select("id, kind")
    .eq("id", conversationId)
    .maybeSingle()
  if (error) throw safetyError(error)
  if (!conversation || conversation.kind === "group" || conversation.kind === "room") return "open"

  const { data: members, error: membersError } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
  if (membersError) throw safetyError(membersError)
  const otherId = (members ?? [])
    .map((member) => member.user_id as string)
    .find((userId) => userId !== session.userId)
  if (!otherId) return "deleted"

  const { data: mine, error: blockError } = await supabase
    .from("blocks")
    .select("blocked_id")
    .eq("blocker_id", session.userId)
    .eq("blocked_id", otherId)
    .maybeSingle()
  if (blockError) throw safetyError(blockError)
  if (mine) return "blocked-by-you"

  const { data: closed, error: closedError } = await supabase.rpc("direct_send_blocked", {
    cid: conversationId,
  })
  if (closedError) throw safetyError(closedError)
  return closed ? "blocked" : "open"
}

export async function reportMessage(
  session: Session,
  message: { id: string; senderId: string; body: string; attachmentName: string | null; conversationId: string },
  reason: ReportReason,
  note: string,
) {
  const cleanNote = note.trim()
  if (cleanNote.length > 1000) throw new Error("Keep the note under 1000 characters.")
  if (message.senderId === session.userId) throw new Error("You cannot report your own message.")

  if (!supabase) {
    const raw = localStorage.getItem(REPORTS_KEY)
    let reports: Array<{
      reporterId: string
      messageId: string
      conversationId?: string
      reportedUserId?: string
      reason?: ReportReason
      note?: string
      bodySnapshot?: string
      attachmentName?: string | null
      createdAt?: string
    }> = []
    if (raw) {
      try {
        reports = JSON.parse(raw) as { reporterId: string; messageId: string }[]
      } catch {
        reports = []
      }
    }
    if (reports.some((item) => item.reporterId === session.userId && item.messageId === message.id)) {
      throw new Error("You already reported that message.")
    }
    reports.push({
      reporterId: session.userId,
      messageId: message.id,
      conversationId: message.conversationId,
      reportedUserId: message.senderId,
      reason,
      note: cleanNote,
      bodySnapshot: message.body,
      attachmentName: message.attachmentName,
      createdAt: new Date().toISOString(),
    })
    localStorage.setItem(REPORTS_KEY, JSON.stringify(reports))
    return
  }

  const { error } = await supabase.rpc("report_message", {
    target: message.id,
    report_reason: reason,
    report_note: cleanNote,
  })
  if (error) throw safetyError(error)
}

export async function deleteOwnMessage(session: Session, messageId: string) {
  if (!supabase) {
    const db = readDb()
    const message = db.messages.find((item) => item.id === messageId)
    if (!message || message.senderId !== session.userId) {
      throw new Error("You can only delete your own messages.")
    }
    message.deleted = true
    message.body = ""
    message.attachmentUrl = null
    message.attachmentName = null
    message.attachmentMime = null
    message.attachmentSize = null
    writeDb(db)
    publishChatEvent({ type: "update", message })
    return
  }

  const { error } = await supabase.rpc("delete_own_message", { message_id: messageId })
  if (error) throw safetyError(error)
}

export function deletePreviewAccount(userId: string) {
  const profiles = readProfiles()
  delete profiles[userId]
  localStorage.setItem(PREVIEW_PROFILES_KEY, JSON.stringify(profiles))

  const db = readDb()
  for (const message of db.messages) {
    if (message.senderId !== userId) continue
    message.deleted = true
    message.body = ""
    message.senderName = "Deleted account"
    message.attachmentUrl = null
    message.attachmentName = null
    message.attachmentMime = null
    message.attachmentSize = null
  }
  for (const conversation of db.conversations) {
    if (!conversation.memberIds.includes(userId)) continue
    conversation.memberIds = conversation.memberIds.filter((id) => id !== userId)
    if ((conversation.kind ?? "direct") === "direct") {
      conversation.title = "Deleted account"
    }
  }
  writeDb(db)
  writeBlocks(readBlocks().filter((row) => row.blockerId !== userId && row.blockedId !== userId))
  publishChatEvent({ type: "refresh" })
}
