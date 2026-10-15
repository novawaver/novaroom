import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { notifyIncoming } from "../lib/desktop"
import { markAlertsDelivered, subscribeToAlerts, undeliveredAlerts } from "../lib/eventAlerts"
import {
  listEvents,
  listReadEventIds,
  markEventsRead,
  occurrencesOf,
  subscribeToDeskChanges,
  unreadEvents,
  type DeskEvent,
} from "../lib/leaddesk"

export type Toast = { id: string; title: string; body: string }

const CHECK_EVERY_MS = 30 * 1000
const REFRESH_EVENTS_MS = 5 * 60 * 1000
// After sleep or a long pause, skip reminders for events that started longer ago than this.
const LATE_LIMIT_MS = 5 * 60 * 1000
const TOAST_MS = 10 * 1000

function timeOf(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value))
}

// Tells LeadDesk participants about events: when they are added to one (from the database inbox)
// and when one of their events starts (checked here while the app is open). Each alert shows as a
// desktop notification and an in-app toast. Also tracks which events are unread for the badges.
// onRemoteChange runs when someone else's change to an event arrives, so an open page can reload.
export function useEventAlerts(userId: string | null, isLeader: boolean, onRemoteChange?: () => void) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const shownRef = useRef(new Set<string>())
  const eventsRef = useRef<DeskEvent[]>([])
  const [events, setEvents] = useState<DeskEvent[]>([])
  const [readIds, setReadIds] = useState<Set<string> | null>(null)
  const remoteChangeRef = useRef(onRemoteChange)
  remoteChangeRef.current = onRemoteChange

  const show = useCallback((key: string, title: string, body: string) => {
    if (shownRef.current.has(key)) return
    shownRef.current.add(key)
    void notifyIncoming(title, body)
    setToasts((current) => [...current.slice(-3), { id: key, title, body }])
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== key)), TOAST_MS)
  }, [])

  const refreshEvents = useCallback(async () => {
    try {
      const next = await listEvents()
      eventsRef.current = next
      setEvents(next)
    } catch {
      // Keep the last list; the next refresh tries again.
    }
  }, [])

  // Added-to-event notifications: anything missed while offline, then live ones.
  useEffect(() => {
    if (!userId) return
    let active = true
    const deliver = (alerts: { id: string; title: string }[]) => {
      for (const alert of alerts) show(`added:${alert.id}`, "Added to an event", alert.title)
      void markAlertsDelivered(alerts.map((alert) => alert.id)).catch(() => {})
    }
    void undeliveredAlerts()
      .then((alerts) => {
        if (active) deliver(alerts)
      })
      .catch(() => {})
    const stop = subscribeToAlerts(userId, (alert) => {
      deliver([alert])
      // The new event should also get its start-time reminder.
      void refreshEvents()
    })
    return () => {
      active = false
      stop()
    }
  }, [userId, show, refreshEvents])

  // Start-time reminders for events this person takes part in.
  useEffect(() => {
    if (!userId || !isLeader) return
    let lastCheck = Date.now()
    void refreshEvents()
    const refresh = window.setInterval(() => void refreshEvents(), REFRESH_EVENTS_MS)
    const check = window.setInterval(() => {
      const now = Date.now()
      const from = Math.max(lastCheck, now - LATE_LIMIT_MS)
      lastCheck = now
      for (const event of eventsRef.current) {
        if (!event.participantIds.includes(userId)) continue
        for (const occurrence of occurrencesOf(event, new Date(from), new Date(now))) {
          const start = new Date(occurrence.startsAt).getTime()
          if (start <= from || start > now) continue
          show(
            `start:${event.id}:${occurrence.startsAt}`,
            `Starting now: ${event.title}`,
            `${timeOf(occurrence.startsAt)}–${timeOf(occurrence.endsAt)}${event.location ? ` · ${event.location}` : ""}`,
          )
        }
      }
    }, CHECK_EVERY_MS)
    return () => {
      window.clearInterval(refresh)
      window.clearInterval(check)
    }
  }, [userId, isLeader, show, refreshEvents])

  // Read state and live event changes, for leaders only.
  useEffect(() => {
    if (!userId || !isLeader) {
      setReadIds(null)
      return
    }
    let active = true
    void listReadEventIds(userId)
      .then((ids) => {
        if (active) setReadIds(ids)
      })
      .catch(() => {})
    const stop = subscribeToDeskChanges(() => {
      void refreshEvents()
      remoteChangeRef.current?.()
    })
    return () => {
      active = false
      stop()
    }
  }, [userId, isLeader, refreshEvents])

  const unread = useMemo(
    () => (userId && readIds ? unreadEvents(events, readIds, userId) : []),
    [events, readIds, userId],
  )

  const markRead = useCallback(
    (ids: string[]) => {
      if (!userId || ids.length === 0) return
      setReadIds((current) => new Set([...(current ?? []), ...ids]))
      void markEventsRead(userId, ids).catch(() => {})
    },
    [userId],
  )

  const dismiss = useCallback((id: string) => setToasts((current) => current.filter((toast) => toast.id !== id)), [])

  return { toasts, dismiss, refreshEvents, unread, markRead }
}

export function Toasts({
  toasts,
  onOpen,
  onDismiss,
}: {
  toasts: Toast[]
  onOpen: () => void
  onDismiss: (id: string) => void
}) {
  if (toasts.length === 0) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          <button
            type="button"
            className="toast-body"
            onClick={() => {
              onDismiss(toast.id)
              onOpen()
            }}
          >
            <strong>{toast.title}</strong>
            <span>{toast.body}</span>
          </button>
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
