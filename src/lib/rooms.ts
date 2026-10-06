import type { Session } from "../types"
import { PREVIEW_CHATS_KEY } from "./preview"
import { supabase } from "./supabase"

export type RoomInfo = {
  id: string
  title: string
  description: string
  joined: boolean
}

export type RoomResource = {
  id: string
  title: string
  url: string
  mine: boolean
}

type StoredResource = {
  id: string
  title: string
  url: string
  createdBy: string | null
}

type StoredConversation = {
  id: string
  memberIds: string[]
  createdAt: string
  kind?: string
  title?: string | null
  description?: string | null
  resources?: StoredResource[]
}

type StoredDb = {
  conversations: StoredConversation[]
  messages: unknown[]
}

const SEED: Array<StoredConversation & { resources: StoredResource[] }> = [
  {
    id: "preview-room-coding",
    memberIds: [],
    createdAt: "2026-10-06T00:00:00.000Z",
    kind: "room",
    title: "Coding",
    description: "Coding tasks, tools, and prompts.",
    resources: [
      {
        id: "preview-pin-coding",
        title: "Python docs",
        url: "https://docs.python.org/3/",
        createdBy: null,
      },
    ],
  },
  {
    id: "preview-room-writing",
    memberIds: [],
    createdAt: "2026-10-06T00:00:00.000Z",
    kind: "room",
    title: "Writing",
    description: "Writing tasks, style, and prompts.",
    resources: [
      {
        id: "preview-pin-writing",
        title: "Purdue OWL",
        url: "https://owl.purdue.edu/owl/general_writing/index.html",
        createdBy: null,
      },
    ],
  },
  {
    id: "preview-room-math",
    memberIds: [],
    createdAt: "2026-10-06T00:00:00.000Z",
    kind: "room",
    title: "Math",
    description: "Math tasks, checks, and explanations.",
    resources: [
      {
        id: "preview-pin-math",
        title: "Khan Academy",
        url: "https://www.khanacademy.org/",
        createdBy: null,
      },
    ],
  },
  {
    id: "preview-room-rating",
    memberIds: [],
    createdAt: "2026-10-06T00:00:00.000Z",
    kind: "room",
    title: "Rating",
    description: "Rating, comparisons, and review habits.",
    resources: [
      {
        id: "preview-pin-rating",
        title: "What is RLHF",
        url: "https://en.wikipedia.org/wiki/Reinforcement_learning_from_human_feedback",
        createdBy: null,
      },
    ],
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
      resources: room.resources,
    })
    changed = true
  }
  if (changed) writeDb(db)
}

function assertHttps(url: string) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error("Links must start with https://")
  }
  if (parsed.protocol !== "https:" || /\s/.test(url)) {
    throw new Error("Links must start with https://")
  }
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

export async function listRoomResources(session: Session, roomId: string): Promise<RoomResource[]> {
  if (!supabase) {
    ensurePreviewRooms()
    const room = readDb().conversations.find((item) => item.id === roomId && item.kind === "room")
    return (room?.resources ?? []).map((resource) => ({
      id: resource.id,
      title: resource.title,
      url: resource.url,
      mine: resource.createdBy === session.userId,
    }))
  }

  const { data, error } = await supabase
    .from("room_resources")
    .select("id, title, url, created_by")
    .eq("conversation_id", roomId)
    .order("created_at")
  if (error) throw roomsError(error)
  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    url: row.url as string,
    mine: row.created_by === session.userId,
  }))
}

export async function addRoomResource(session: Session, roomId: string, title: string, url: string) {
  const cleanTitle = title.trim()
  const cleanUrl = url.trim()
  if (!cleanTitle || cleanTitle.length > 80) {
    throw new Error("Give the link a name up to 80 characters.")
  }
  assertHttps(cleanUrl)

  if (!supabase) {
    ensurePreviewRooms()
    const db = readDb()
    const room = db.conversations.find((item) => item.id === roomId && item.kind === "room")
    if (!room || !room.memberIds.includes(session.userId)) {
      throw new Error("Join the room before adding a link.")
    }
    const resources = room.resources ?? []
    if (resources.length >= 20) throw new Error("This room already has 20 links.")
    resources.push({
      id: crypto.randomUUID(),
      title: cleanTitle,
      url: cleanUrl,
      createdBy: session.userId,
    })
    room.resources = resources
    writeDb(db)
    return
  }

  const { error } = await supabase.rpc("add_room_resource", {
    room_id: roomId,
    resource_title: cleanTitle,
    resource_url: cleanUrl,
  })
  if (error) throw roomsError(error)
}

export async function deleteRoomResource(session: Session, resourceId: string) {
  if (!supabase) {
    const db = readDb()
    for (const room of db.conversations) {
      if (room.kind !== "room" || !room.resources) continue
      const resource = room.resources.find((item) => item.id === resourceId)
      if (!resource) continue
      if (resource.createdBy !== session.userId) {
        throw new Error("You can only remove links you added.")
      }
      room.resources = room.resources.filter((item) => item.id !== resourceId)
      writeDb(db)
      return
    }
    throw new Error("That link is not available.")
  }

  const { error } = await supabase.rpc("delete_room_resource", { resource_id: resourceId })
  if (error) throw roomsError(error)
}
