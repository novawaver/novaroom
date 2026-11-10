import { useEffect, useState } from "react"

// Chats whose notifications this person turned off, remembered on this computer. A message that
// mentions them still shows a notification. Online chats are listed by their id; Local chats by
// localAlertKey.

const keyFor = (userId: string) => `novaroom.quiet-chats.${userId}`
const CHANGED = "novaroom-quiet-chats"

/** The key for a Local chat (the room, or the other person's account id). */
export const localAlertKey = (chat: string) => `local:${chat}`

export function readQuietChats(userId: string): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(keyFor(userId)) ?? "[]")
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [])
  } catch {
    return new Set()
  }
}

/** Whether notifications are off for a chat. Read when a message arrives, so it is always current. */
export function chatIsQuiet(userId: string, key: string) {
  return readQuietChats(userId).has(key)
}

export function setChatQuiet(userId: string, key: string, quiet: boolean) {
  const next = new Set(readQuietChats(userId))
  if (quiet) next.add(key)
  else next.delete(key)
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify([...next]))
  } catch {
    // Storage is full or unavailable, so the choice could not be kept.
  }
  window.dispatchEvent(new Event(CHANGED))
}

/** The chats with notifications off, kept current wherever one is changed. */
export function useQuietChats(userId: string | null) {
  const [quiet, setQuiet] = useState<ReadonlySet<string>>(() => (userId ? readQuietChats(userId) : new Set()))

  useEffect(() => {
    const load = () => setQuiet(userId ? readQuietChats(userId) : new Set())
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [userId])

  return quiet
}
