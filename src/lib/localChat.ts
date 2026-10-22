import { inTauri } from "./desktop"
import { supabase } from "./supabase"

// Local chat: messages between Novaroom apps on the same office network, which work without
// internet. The desktop app does the networking (see src-tauri/src/localchat.rs) and keeps the
// messages in a file on this computer; nothing here is stored on the server.

/** The chat everyone on the network shares. Direct chats use the other person's account id. */
export const LOCAL_ROOM = "room"

export type LocalMessage = {
  id: string
  chat: string
  senderId: string
  senderName: string
  body: string
  // Milliseconds since 1970, by the sender's clock.
  sentAt: number
  // Own direct messages: whether the other person's app has it yet.
  delivered: boolean
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

export const localChats = () => call<LocalChatSummary[]>("local_chat_chats")

export const localMessages = (chat: string) => call<LocalMessage[]>("local_chat_messages", { chat })

export const sendLocalMessage = (chat: string, body: string) =>
  call<LocalMessage>("local_chat_send", { chat, id: crypto.randomUUID(), body })

type KeyRow = { user_id: string; public_key: string; profiles: { display_name: string | null } | null }

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
  const { data, error } = await supabase.from("local_chat_keys").select("user_id, public_key, profiles(display_name)")
  if (error) throw new Error(error.message)
  const entries = (data as unknown as KeyRow[]).map((row) => ({
    userId: row.user_id,
    publicKey: row.public_key,
    name: row.profiles?.display_name ?? "",
  }))
  await call<void>("local_chat_set_directory", { entries })
}

type Unlisten = () => void

/** Listens for Local chat events from the desktop app. Returns a function that stops listening. */
export function onLocalChat(handlers: {
  message: (message: LocalMessage) => void
  delivered: (id: string) => void
  peers: (peers: LocalPeer[]) => void
}) {
  if (!inTauri()) return () => {}
  let stopped = false
  const unlisten: Unlisten[] = []
  void import("@tauri-apps/api/event").then(async ({ listen }) => {
    const stops = await Promise.all([
      listen<LocalMessage>("local-chat-message", (event) => handlers.message(event.payload)),
      listen<string>("local-chat-delivered", (event) => handlers.delivered(event.payload)),
      listen<LocalPeer[]>("local-chat-peers", (event) => handlers.peers(event.payload)),
    ])
    if (stopped) stops.forEach((stop) => stop())
    else unlisten.push(...stops)
  })
  return () => {
    stopped = true
    unlisten.forEach((stop) => stop())
  }
}
