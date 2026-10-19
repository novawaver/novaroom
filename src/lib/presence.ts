import { useEffect, useState } from "react"
import { supabase } from "./supabase"
import { IDLE_AFTER_SECONDS, systemIdleSeconds } from "./timer"

export type PresenceStatus = "online" | "idle" | "offline"

export const PRESENCE_LABELS: Record<PresenceStatus, string> = { online: "Online", idle: "Idle", offline: "Offline" }

const CHECK_EVERY_MS = 15 * 1000

// Everyone with the app open joins one Realtime presence channel and shares whether they are
// online or idle. Anyone not in the channel is offline. Nothing is stored in the database.
export function usePresence(userId: string | null) {
  const [self, setSelf] = useState<Exclude<PresenceStatus, "offline">>("online")
  const [others, setOthers] = useState<Map<string, PresenceStatus>>(new Map())

  // Same idle rule as the Timer, but always on: no input for a minute counts as idle.
  useEffect(() => {
    if (!userId) return
    let lastInput = Date.now()
    let stopped = false
    // In a browser (no system idle time), count input inside the app window instead.
    const onInput = () => {
      lastInput = Date.now()
    }
    const inputEvents = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const
    for (const name of inputEvents) window.addEventListener(name, onInput, { passive: true })
    const check = async () => {
      const idle = (await systemIdleSeconds()) ?? Math.floor((Date.now() - lastInput) / 1000)
      if (!stopped) setSelf(idle >= IDLE_AFTER_SECONDS ? "idle" : "online")
    }
    void check()
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
      for (const name of inputEvents) window.removeEventListener(name, onInput)
    }
  }, [userId])

  const [channel, setChannel] = useState<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null)

  useEffect(() => {
    setOthers(new Map())
    if (!supabase || !userId) return
    const client = supabase
    const joined = client.channel("presence:people", { config: { presence: { key: userId } } })
    joined
      .on("presence", { event: "sync" }, () => {
        const next = new Map<string, PresenceStatus>()
        for (const [key, entries] of Object.entries(joined.presenceState<{ status: PresenceStatus }>())) {
          // Someone signed in on several computers counts as online if any of them is.
          next.set(key, entries.some((entry) => entry.status === "online") ? "online" : "idle")
        }
        setOthers(next)
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setChannel(joined)
      })
    return () => {
      setChannel(null)
      void client.removeChannel(joined)
    }
  }, [userId])

  useEffect(() => {
    if (channel) void channel.track({ status: self })
  }, [channel, self])

  // This person's own status comes straight from this computer, so it shows even before joining.
  return (id: string): PresenceStatus => (id === userId ? self : (others.get(id) ?? "offline"))
}
