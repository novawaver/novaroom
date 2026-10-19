import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "./supabase"

// Typing status travels as Realtime broadcasts on a channel for the open chat only. Nothing is
// stored, and people who are not in the chat never learn its id, so they cannot listen in.

// How often "still typing" is sent while someone keeps typing, and how long it lasts without one.
const SEND_EVERY_MS = 2500
const LASTS_MS = 6000

export type Typist = { userId: string; name: string }

type Broadcast = { userId: string; name?: string }

/**
 * Who else is typing in a chat, and a function to call on each keystroke (with whether the
 * message box still has text in it). Typing stops showing after a few quiet seconds, when the
 * person sends or clears their message, or when they leave the chat.
 */
export function useTyping(conversationId: string | null, userId: string | null, name: string) {
  const [typists, setTypists] = useState<Typist[]>([])
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null)
  const lastSentRef = useRef(0)
  const nameRef = useRef(name)
  nameRef.current = name

  useEffect(() => {
    setTypists([])
    lastSentRef.current = 0
    if (!supabase || !conversationId || !userId) return
    const client = supabase
    // Each person typing, with when their status runs out.
    const seen = new Map<string, Typist & { until: number }>()
    const publish = () => {
      const now = Date.now()
      for (const [id, typist] of seen) if (typist.until <= now) seen.delete(id)
      setTypists([...seen.values()].map(({ userId: id, name: typistName }) => ({ userId: id, name: typistName })))
    }
    const channel = client
      .channel(`typing:${conversationId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const { userId: id, name: typistName } = payload as Broadcast
        if (!id || id === userId) return
        seen.set(id, { userId: id, name: typistName?.trim() || "Someone", until: Date.now() + LASTS_MS })
        publish()
      })
      .on("broadcast", { event: "stopped" }, ({ payload }) => {
        const { userId: id } = payload as Broadcast
        if (seen.delete(id)) publish()
      })
      .subscribe()
    channelRef.current = channel
    const timer = window.setInterval(publish, 1000)
    return () => {
      window.clearInterval(timer)
      if (lastSentRef.current) void channel.send({ type: "broadcast", event: "stopped", payload: { userId } })
      channelRef.current = null
      void client.removeChannel(channel)
    }
  }, [conversationId, userId])

  /** Call on every change to the message box; hasText is false once it is empty or sent. */
  const onType = useCallback(
    (hasText: boolean) => {
      const channel = channelRef.current
      if (!channel || !userId) return
      if (!hasText) {
        if (lastSentRef.current) void channel.send({ type: "broadcast", event: "stopped", payload: { userId } })
        lastSentRef.current = 0
        return
      }
      const now = Date.now()
      if (now - lastSentRef.current < SEND_EVERY_MS) return
      lastSentRef.current = now
      void channel.send({ type: "broadcast", event: "typing", payload: { userId, name: nameRef.current } })
    },
    [userId],
  )

  return { typists, onType }
}

/** "Alex is typing", "Alex and Sam are typing", or "Several people are typing". */
export function typingText(typists: Typist[]) {
  if (typists.length === 0) return ""
  if (typists.length === 1) return `${typists[0].name} is typing`
  if (typists.length === 2) return `${typists[0].name} and ${typists[1].name} are typing`
  return "Several people are typing"
}
