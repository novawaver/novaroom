import type { CallTransport } from "./calls"

// The calls this person made and received, kept on this computer only.

export type CallOutcome = "answered" | "missed" | "declined" | "no-answer" | "busy" | "failed"

export type CallRecord = {
  id: string
  // When the call started ringing (milliseconds since 1970).
  at: number
  transport: CallTransport
  conversationId: string
  // The other person in a call between two people; null for a group or room call.
  otherId: string | null
  title: string
  avatarUrl: string | null
  group: boolean
  video: boolean
  direction: "in" | "out"
  outcome: CallOutcome
  // How long the people in it could hear each other.
  seconds: number
}

const KEPT = 200
const CHANGED = "novaroom-call-history"
const key = (userId: string) => `novaroom.calls.${userId}`

export function readCallHistory(userId: string): CallRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(userId)) ?? "[]") as CallRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(userId: string, records: CallRecord[]) {
  try {
    if (records.length > 0) localStorage.setItem(key(userId), JSON.stringify(records))
    else localStorage.removeItem(key(userId))
  } catch {
    // Not kept; the call itself is unaffected.
  }
  window.dispatchEvent(new Event(CHANGED))
}

/** Adds a call to the top of the history, dropping the oldest beyond what is kept. */
export function addCallRecord(userId: string, record: CallRecord) {
  write(userId, [record, ...readCallHistory(userId).filter((item) => item.id !== record.id)].slice(0, KEPT))
}

export function clearCallHistory(userId: string) {
  write(userId, [])
}

/** Calls back when the history changes. Returns how to stop. */
export function onCallHistoryChange(onChange: () => void) {
  window.addEventListener(CHANGED, onChange)
  return () => window.removeEventListener(CHANGED, onChange)
}
