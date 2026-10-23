import { inTauri } from "./desktop"
import { supabase } from "./supabase"

// Local chat: messages between Novaroom apps on the same office network, which work without
// internet. The desktop app does the networking (see src-tauri/src/localchat.rs) and keeps the
// messages in a file on this computer; nothing here is stored on the server.

/** The chat everyone on the network shares. Direct chats use the other person's account id. */
export const LOCAL_ROOM = "room"

// "waiting": still coming from the sender's app. "missing": the sender no longer has it.
export type LocalFile = { name: string; mime: string; size: number; state: "ready" | "waiting" | "missing" }

export type LocalReply = { id: string; senderId: string; senderName: string; body: string; fileName: string | null }

export type LocalMessage = {
  id: string
  chat: string
  senderId: string
  senderName: string
  // Empty when the message is only a file.
  body: string
  // Milliseconds since 1970, by the sender's clock.
  sentAt: number
  // Own direct messages: whether the other person's app has it yet.
  delivered: boolean
  // Own direct messages: whether the other person has seen it.
  read: boolean
  // The message this one answers, when it is on this computer.
  replyTo: LocalReply | null
  file: LocalFile | null
}

/** Largest file Local chat sends, as in the other chats. */
export const LOCAL_FILE_LIMIT = 25 * 1024 * 1024

/** What to show for a message in one line: its text, or its file's name. */
export function localMessageLabel(message: Pick<LocalMessage, "body" | "file">) {
  return message.body || (message.file ? `File: ${message.file.name}` : "")
}

// idle: no keyboard or mouse input on their computer for a while. Apps from before this was shared
// never say, so they always show as active.
export type LocalPeer = { userId: string; name: string; idle: boolean }

export type LocalChatSummary = { chat: string; name: string; lastBody: string; lastAt: number }

export const localChatAvailable = inTauri

async function call<T>(command: string, args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core")
  try {
    return await invoke<T>(command, args)
  } catch (caught) {
    throw new Error(typeof caught === "string" ? caught : "Local chat ran into a problem.")
  }
}

/** Starts Local chat for this account and returns this computer's public key for it. */
export const startLocalChat = (userId: string, name: string) => call<string>("local_chat_start", { userId, name })

export const stopLocalChat = () => call<void>("local_chat_stop")

/** Tells everyone on the network whether this person is idle. */
export const setLocalIdle = (idle: boolean) => call<void>("local_chat_set_idle", { idle })

export const localPeers = () => call<LocalPeer[]>("local_chat_peers")

/** Profile picture addresses from the saved directory, by account id. They only load while online. */
export const localAvatars = () => call<Record<string, string>>("local_chat_avatars")

export const localChats = () => call<LocalChatSummary[]>("local_chat_chats")

export const localMessages = (chat: string) => call<LocalMessage[]>("local_chat_messages", { chat })

/** Sends a message, with the id of the message it answers and a file if there are any. */
export async function sendLocalMessage(chat: string, body: string, replyTo: string | null, file: File | null) {
  const id = crypto.randomUUID()
  if (file) {
    if (file.size > LOCAL_FILE_LIMIT) throw new Error("Files can be up to 25 MB.")
    const bytes = new Uint8Array(await file.arrayBuffer())
    const { invoke } = await import("@tauri-apps/api/core")
    try {
      await invoke("local_chat_stage_file", bytes, { headers: { "x-id": id } })
    } catch (caught) {
      throw new Error(typeof caught === "string" ? caught : "Could not add that file.")
    }
  }
  return call<LocalMessage>("local_chat_send", {
    chat,
    id,
    body,
    replyTo,
    file: file ? { name: file.name || "Pasted image", mime: file.type } : null,
  })
}

// Object URLs for files already read, so an image is only read from disk once.
const fileUrls = new Map<string, Promise<string>>()

/** A URL for showing a message's file (an image) in the window. */
export function localFileUrl(id: string, mime: string) {
  let url = fileUrls.get(id)
  if (!url) {
    url = call<ArrayBuffer>("local_chat_file", { id }).then((bytes) => URL.createObjectURL(new Blob([bytes], { type: mime })))
    // A failed read can be tried again later.
    url.catch(() => fileUrls.delete(id))
    fileUrls.set(id, url)
  }
  return url
}

/** Asks where to save a message's file and saves it. False if the person cancelled. */
export const saveLocalFile = (id: string) => call<boolean>("local_chat_save_file", { id })

export const sendLocalTyping = (chat: string, typing: boolean) => call<void>("local_chat_typing", { chat, typing })

/** Tells the other person in a direct chat that this person has seen it, for their double checks. */
export const markLocalRead = (chat: string) => call<void>("local_chat_mark_read", { chat })

type KeyRow = {
  user_id: string
  public_key: string
  profiles: { display_name: string | null; avatar_url: string | null } | null
}

/**
 * Registers this computer's key for the account, then saves every registered key on this computer,
 * so people on the network can be checked later even without internet. Needs a connection.
 */
export async function syncLocalDirectory(userId: string, publicKey: string) {
  if (!supabase) return
  const { error: addError } = await supabase
    .from("local_chat_keys")
    .upsert({ user_id: userId, public_key: publicKey }, { onConflict: "user_id,public_key", ignoreDuplicates: true })
  if (addError) throw new Error(addError.message)
  const { data, error } = await supabase.from("local_chat_keys").select("user_id, public_key, profiles(display_name, avatar_url)")
  if (error) throw new Error(error.message)
  const entries = (data as unknown as KeyRow[]).map((row) => ({
    userId: row.user_id,
    publicKey: row.public_key,
    name: row.profiles?.display_name ?? "",
    avatarUrl: row.profiles?.avatar_url ?? null,
  }))
  await call<void>("local_chat_set_directory", { entries })
}

type Unlisten = () => void

/** Listens for Local chat events from the desktop app. Returns a function that stops listening. */
export function onLocalChat(handlers: {
  message: (message: LocalMessage) => void
  delivered: (id: string) => void
  peers: (peers: LocalPeer[]) => void
  typing: (event: { chat: string; userId: string; typing: boolean }) => void
  read: (event: { chat: string; upTo: number }) => void
  file: (event: { id: string; state: LocalFile["state"] }) => void
}) {
  if (!inTauri()) return () => {}
  let stopped = false
  const unlisten: Unlisten[] = []
  void import("@tauri-apps/api/event").then(async ({ listen }) => {
    const stops = await Promise.all([
      listen<LocalMessage>("local-chat-message", (event) => handlers.message(event.payload)),
      listen<string>("local-chat-delivered", (event) => handlers.delivered(event.payload)),
      listen<LocalPeer[]>("local-chat-peers", (event) => handlers.peers(event.payload)),
      listen<{ chat: string; userId: string; typing: boolean }>("local-chat-typing", (event) => handlers.typing(event.payload)),
      listen<{ chat: string; upTo: number }>("local-chat-read", (event) => handlers.read(event.payload)),
      listen<{ id: string; state: LocalFile["state"] }>("local-chat-file", (event) => handlers.file(event.payload)),
    ])
    if (stopped) stops.forEach((stop) => stop())
    else unlisten.push(...stops)
  })
  return () => {
    stopped = true
    unlisten.forEach((stop) => stop())
  }
}
