import type { RealtimeChannel } from "@supabase/supabase-js"
import { inTauri } from "./desktop"
import { supabase } from "./supabase"

// Voice and video calls. The sound and picture go straight between the apps in the call (WebRTC),
// each pair of apps with its own connection. Only the short notes that set a call up travel another
// way: through the server ("online"), or between the apps on the same office network as Local chat
// does ("local"). Those notes are never the call itself.

export type CallTransport = "online" | "local"

export type CallSignalKind = "ring" | "accept" | "decline" | "busy" | "offer" | "answer" | "ice" | "end"

export type CallSignal = {
  callId: string
  transport: CallTransport
  // Online: the chat's id. Local: the other person's account id, as Local chat names direct chats.
  conversationId: string
  senderId: string
  kind: CallSignalKind
  payload: unknown
  createdAt: string
}

/** The most people in one call. Every app connects to every other, which stops working well beyond this. */
export const MAX_CALL_PEOPLE = 8

function mediaAvailable() {
  return (
    typeof RTCPeerConnection !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  )
}

/** Whether calls through the server can be made here: a connected project, and a window that can use a microphone. */
export const onlineCallsAvailable = () => supabase !== null && mediaAvailable()

/** Whether calls over the office network can be made here: the desktop app, where Local chat runs. */
export const localCallsAvailable = () => inTauri() && mediaAvailable()

/**
 * Servers that help two apps find a way to each other. On the same network they need none. Online,
 * the public one only tells an app its own address, and a relay (TURN) server, set in the .env
 * file, carries the call when the two networks do not let the apps reach each other directly.
 */
export function iceServers(transport: CallTransport): RTCIceServer[] {
  if (transport === "local") return []
  const servers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }]
  const turn = import.meta.env.VITE_TURN_URL as string | undefined
  if (turn) {
    servers.push({
      urls: turn.split(",").map((url) => url.trim()).filter(Boolean),
      username: (import.meta.env.VITE_TURN_USERNAME as string | undefined) ?? "",
      credential: (import.meta.env.VITE_TURN_CREDENTIAL as string | undefined) ?? "",
    })
  }
  return servers
}

function callError(error: { message: string }) {
  if (/does not exist|schema cache|Could not find the table|404/i.test(error.message)) {
    return new Error("Run the voice calls SQL script (20261119130000_voice_calls.sql), then try again.")
  }
  if (/row-level security/i.test(error.message)) return new Error("You cannot call this person.")
  return new Error(error.message)
}

export async function sendCallSignal(
  userId: string,
  signal: { callId: string; conversationId: string; recipientId: string; kind: CallSignalKind; payload?: unknown },
) {
  if (!supabase) throw new Error("Calls need a connection.")
  const { error } = await supabase.from("call_signals").insert({
    call_id: signal.callId,
    conversation_id: signal.conversationId,
    sender_id: userId,
    recipient_id: signal.recipientId,
    kind: signal.kind,
    payload: signal.payload ?? null,
  })
  if (error) throw callError(error)
}

type SignalRow = {
  call_id: string
  conversation_id: string
  sender_id: string
  kind: CallSignalKind
  payload: unknown
  created_at: string
}

/** Calls back with each call signal sent to this person through the server. Returns how to stop. */
export function subscribeToCallSignals(userId: string, onSignal: (signal: CallSignal) => void): () => void {
  if (!supabase) return () => {}
  const client = supabase
  const channel: RealtimeChannel = client
    .channel(`novaroom-calls:${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "call_signals", filter: `recipient_id=eq.${userId}` },
      (change) => {
        const row = change.new as SignalRow
        onSignal({
          callId: row.call_id,
          transport: "online",
          conversationId: row.conversation_id,
          senderId: row.sender_id,
          kind: row.kind,
          payload: row.payload,
          createdAt: row.created_at,
        })
      },
    )
    .subscribe()
  return () => {
    void client.removeChannel(channel)
  }
}

/** Deletes the set-up notes of a finished call that this person sent or was sent. */
export async function clearCallSignals(callId: string) {
  if (!supabase) return
  await supabase.from("call_signals").delete().eq("call_id", callId)
}

/** Deletes this person's set-up notes left over from calls that ended without tidying up. */
export async function clearOldCallSignals() {
  if (!supabase) return
  const before = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  await supabase.from("call_signals").delete().lt("created_at", before)
}

/** The account ids of everyone in a chat, for ringing a group or a room. */
export async function listCallMemberIds(conversationId: string): Promise<string[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .limit(MAX_CALL_PEOPLE + 1)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => row.user_id as string)
}

const CALL_ID = /^[0-9a-f-]{36}$/i
const KINDS: CallSignalKind[] = ["ring", "accept", "decline", "busy", "offer", "answer", "ice", "end"]

/** Passes a set-up note to someone on the office network. Refuses if their app cannot be reached. */
export async function sendLocalCallSignal(
  recipientId: string,
  signal: { callId: string; kind: CallSignalKind; payload?: unknown },
) {
  const { invoke } = await import("@tauri-apps/api/core")
  let reached: boolean
  try {
    reached = await invoke<boolean>("local_chat_signal", {
      to: recipientId,
      data: JSON.stringify({ call: signal.callId, kind: signal.kind, payload: signal.payload ?? null }),
    })
  } catch (caught) {
    throw new Error(typeof caught === "string" ? caught : "Local chat is not running on this computer.")
  }
  if (!reached) throw new Error("They are not on the local network right now, or their app is too old for calls.")
}

/** Calls back with each call signal from someone on the office network. Returns how to stop. */
export function subscribeToLocalCallSignals(onSignal: (signal: CallSignal) => void): () => void {
  if (!inTauri()) return () => {}
  let stopped = false
  let stop: (() => void) | null = null
  void import("@tauri-apps/api/event").then(async ({ listen }) => {
    const unlisten = await listen<{ userId: string; data: string }>("local-chat-signal", (event) => {
      try {
        const note = JSON.parse(event.payload.data) as { call?: unknown; kind?: unknown; payload?: unknown }
        if (typeof note.call !== "string" || !CALL_ID.test(note.call)) return
        if (!KINDS.includes(note.kind as CallSignalKind)) return
        onSignal({
          callId: note.call,
          transport: "local",
          conversationId: event.payload.userId,
          senderId: event.payload.userId,
          kind: note.kind as CallSignalKind,
          payload: note.payload ?? null,
          createdAt: new Date().toISOString(),
        })
      } catch {
        // Not a call note this app understands.
      }
    })
    if (stopped) unlisten()
    else stop = unlisten
  })
  return () => {
    stopped = true
    stop?.()
  }
}
