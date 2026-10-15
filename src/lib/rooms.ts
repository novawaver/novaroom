import type { Session } from "../types"
import { PREVIEW_CHATS_KEY } from "./preview"
import { supabase } from "./supabase"

export type RoomInfo = {
  id: string
  title: string
  description: string
  joined: boolean
}

type StoredConversation = {
  id: string
  memberIds: string[]
  createdAt: string
  kind?: string
  title?: string | null
  description?: string | null
}

type StoredDb = {
  conversations: StoredConversation[]
  messages: unknown[]
}

const SEED: StoredConversation[] = [
  {
    id: "preview-room-coding",
    memberIds: [],
    createdAt: "2026-10-06T00:00:00.000Z",
    kind: "room",
    title: "Coding",
    description: "Coding tasks, tools, and prompts.",
  },
  {
    id: "preview-room-writing",
    memberIds: [],
    createdAt: "2026-10-06T00:00:00.000Z",
    kind: "room",
    title: "Writing",
    description: "Writing tasks, style, and prompts.",
  },
  {
    id: "preview-room-math",
    memberIds: [],
    createdAt: "2026-10-06T00:00:00.000Z",
    kind: "room",
    title: "Math",
    description: "Math tasks, checks, and explanations.",
  },
  {
    id: "preview-room-rating",
    memberIds: [],
    createdAt: "2026-10-06T00:00:00.000Z",
    kind: "room",
    title: "Rating",
    description: "Rating, comparisons, and review habits.",
  },
]

function roomsError(error: { message: string }) {
  if (/does not exist|schema cache|Could not find the function|404/i.test(error.message)) {
    return new Error("Run the rooms SQL script in the README, then try again.")
  }
  return new Error(error.message)
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

export function ensurePreviewRooms() {
  if (supabase) return
  const db = readDb()
  let changed = false
  for (const room of SEED) {
    if (db.conversations.some((item) => item.id === room.id)) continue
    db.conversations.push({
      id: room.id,
      memberIds: [],
      createdAt: room.createdAt,
      kind: "room",
      title: room.title,
      description: room.description,
    })
    changed = true
  }
  if (changed) writeDb(db)
}

export async function listRooms(session: Session): Promise<RoomInfo[]> {
  if (!supabase) {
    ensurePreviewRooms()
    return readDb()
      .conversations.filter((conversation) => conversation.kind === "room")
      .map((conversation) => ({
        id: conversation.id,
        title: conversation.title?.trim() || "Room",
        description: conversation.description?.trim() || "Topic room",
        joined: conversation.memberIds.includes(session.userId),
      }))
  }

  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, description")
    .eq("kind", "room")
    .order("title")
  if (error) {
    if (/description|does not exist|schema cache/i.test(error.message)) return []
    throw roomsError(error)
  }

  const { data: memberships, error: memberError } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", session.userId)
  if (memberError) throw roomsError(memberError)
  const joined = new Set((memberships ?? []).map((row) => row.conversation_id as string))

  return (data ?? []).map((room) => ({
    id: room.id as string,
    title: ((room.title as string | null) ?? "").trim() || "Room",
    description: ((room.description as string | null) ?? "").trim() || "Topic room",
    joined: joined.has(room.id as string),
  }))
}

export async function joinRoom(session: Session, roomId: string) {
  if (!supabase) {
    ensurePreviewRooms()
    const db = readDb()
    const room = db.conversations.find((item) => item.id === roomId && item.kind === "room")
    if (!room) throw new Error("That room is not available.")
    if (!room.memberIds.includes(session.userId)) room.memberIds.push(session.userId)
    writeDb(db)
    return
  }
  const { error } = await supabase.rpc("join_room", { room_id: roomId })
  if (error) throw roomsError(error)
}

export async function leaveRoom(session: Session, roomId: string) {
  if (!supabase) {
    const db = readDb()
    const room = db.conversations.find((item) => item.id === roomId && item.kind === "room")
    if (!room) return
    room.memberIds = room.memberIds.filter((id) => id !== session.userId)
    writeDb(db)
    return
  }
  const { error } = await supabase.rpc("leave_room", { room_id: roomId })
  if (error) throw roomsError(error)
}
