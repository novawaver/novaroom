import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { notifyIncoming } from "../lib/desktop"
import { markAlertsDelivered, subscribeToAlerts, undeliveredAlerts, type EventAlert } from "../lib/eventAlerts"
import {
  listEvents,
  listReadEventIds,
  listReadTaskIds,
  listTasks,
  markEventsRead,
  markTasksRead,
  occurrencesOf,
  subscribeToDeskChanges,
  unreadEvents,
  unreadTasks,
  type DeskEvent,
  type DeskTask,
} from "../lib/leaddesk"
import { useReconnectEpoch } from "../lib/network"

// tab: the LeadDesk tab that clicking the toast opens.
export type Toast = { id: string; title: string; body: string; tab: "schedule" | "tasks" }

const CHECK_EVERY_MS = 30 * 1000
const POLL_ALERTS_MS = 60 * 1000
const REFRESH_EVENTS_MS = 5 * 60 * 1000
// After sleep or a long pause, skip reminders for events that started longer ago than this.
const LATE_LIMIT_MS = 5 * 60 * 1000
const TOAST_MS = 10 * 1000

function timeOf(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value))
}

// Tells LeadDesk participants about events: when they are added to one (from the database inbox)
// and when one of their events starts (checked here while the app is open). Also tells assignees
// when a task is assigned to them. Each alert shows as a desktop notification and an in-app toast.
// Also tracks which events and tasks are unread for the badges.
// onRemoteChange runs when someone else's change to an event arrives, so an open page can reload.
export function useEventAlerts(userId: string | null, isLeader: boolean, onRemoteChange?: () => void) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const shownRef = useRef(new Set<string>())
  const eventsRef = useRef<DeskEvent[]>([])
  const [events, setEvents] = useState<DeskEvent[]>([])
  const [readIds, setReadIds] = useState<Set<string> | null>(null)
  const [tasks, setTasks] = useState<DeskTask[]>([])
  const [readTaskIds, setReadTaskIds] = useState<Set<string> | null>(null)
  // Tasks opened in this session, kept read even if a reload races ahead of saving the read.
  const localTaskReadsRef = useRef(new Set<string>())
  const remoteChangeRef = useRef(onRemoteChange)
  remoteChangeRef.current = onRemoteChange
  // Subscriptions are made again, and missed changes loaded, each time the connection comes back.
  const epoch = useReconnectEpoch()

  const show = useCallback((key: string, title: string, body: string, tab: Toast["tab"] = "schedule") => {
    if (shownRef.current.has(key)) return
    shownRef.current.add(key)
    void notifyIncoming(title, body, `desk:${tab}`)
    setToasts((current) => [...current.slice(-3), { id: key, title, body, tab }])
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

  // Reads are reloaded with tasks because the database clears one when a task is reassigned.
  const refreshTasks = useCallback(async () => {
    if (!userId) return
    try {
      const [next, reads] = await Promise.all([listTasks(), listReadTaskIds(userId)])
      setTasks(next)
      setReadTaskIds(new Set([...reads, ...localTaskReadsRef.current]))
    } catch {
      // Keep the last list; the next change tries again.
    }
  }, [userId])

  // Added-to-event and task-assigned notifications: anything missed while offline, then live ones.
  useEffect(() => {
    if (!userId) return
    let active = true
    const deliver = (alerts: EventAlert[]) => {
      for (const alert of alerts) {
        if (alert.kind === "task_assigned") show(`task:${alert.id}`, "Task assigned to you", alert.title, "tasks")
        else show(`added:${alert.id}`, "Added to an event", alert.title)
      }
      void markAlertsDelivered(alerts.map((alert) => alert.id)).catch(() => {})
    }
    const fetchMissed = () =>
      void undeliveredAlerts()
        .then((alerts) => {
          if (!active || alerts.length === 0) return
          deliver(alerts)
          if (alerts.some((alert) => alert.kind === "task_assigned")) void refreshTasks()
          if (alerts.some((alert) => alert.kind === "event_added")) void refreshEvents()
        })
        .catch(() => {})
    fetchMissed()
    // Live alerts need the realtime connection, which can drop without the app noticing. Asking the
    // database now and then makes sure an alert still arrives, a little later at worst.
    const poll = window.setInterval(fetchMissed, POLL_ALERTS_MS)
    const stop = subscribeToAlerts(userId, (alert) => {
      deliver([alert])
      // The new event should also get its start-time reminder, and a new task its badge.
      if (alert.kind === "task_assigned") {
        if (alert.taskId) localTaskReadsRef.current.delete(alert.taskId)
        void refreshTasks()
      } else void refreshEvents()
    })
    return () => {
      active = false
      window.clearInterval(poll)
      stop()
    }
  }, [userId, show, refreshEvents, refreshTasks, epoch])

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
      setReadTaskIds(null)
      setTasks([])
      return
    }
    let active = true
    void listReadEventIds(userId)
      .then((ids) => {
        if (active) setReadIds(ids)
      })
      .catch(() => {})
    void refreshTasks()
    const stop = subscribeToDeskChanges(() => {
      void refreshEvents()
      void refreshTasks()
      remoteChangeRef.current?.()
    })
    // After a reconnect, also reload an open LeadDesk page with whatever changed meanwhile.
    if (epoch > 0) {
      void refreshEvents()
      remoteChangeRef.current?.()
    }
    return () => {
      active = false
      stop()
    }
  }, [userId, isLeader, refreshEvents, refreshTasks, epoch])

  const unread = useMemo(
    () => (userId && readIds ? unreadEvents(events, readIds, userId) : []),
    [events, readIds, userId],
  )

  const unreadTaskList = useMemo(
    () => (userId && readTaskIds ? unreadTasks(tasks, readTaskIds, userId) : []),
    [tasks, readTaskIds, userId],
  )

  const markRead = useCallback(
    (ids: string[]) => {
      if (!userId || ids.length === 0) return
      setReadIds((current) => new Set([...(current ?? []), ...ids]))
      void markEventsRead(userId, ids).catch(() => {})
    },
    [userId],
  )

  const markTaskRead = useCallback(
    (id: string) => {
      if (!userId) return
      localTaskReadsRef.current.add(id)
      setReadTaskIds((current) => new Set([...(current ?? []), id]))
      void markTasksRead(userId, [id]).catch(() => {})
    },
    [userId],
  )

  const dismiss = useCallback((id: string) => setToasts((current) => current.filter((toast) => toast.id !== id)), [])

  return {
    toasts,
    dismiss,
    notify: show,
    refreshEvents,
    refreshTasks,
    unread,
    markRead,
    unreadTasks: unreadTaskList,
    markTaskRead,
  }
}

export function Toasts({
  toasts,
  onOpen,
  onDismiss,
}: {
  toasts: Toast[]
  onOpen: (toast: Toast) => void
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
              onOpen(toast)
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
