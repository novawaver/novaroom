import { supabase } from "./supabase"

// "You were added to an event", "A task was assigned to you" and "An assignee signed your task done
// (or failed)" notifications, created by the database.
export type AlertKind = "event_added" | "task_assigned" | "task_done" | "task_failed"

// actorId: who caused it, for their picture on the notification.
export type EventAlert = {
  id: string
  kind: AlertKind
  eventId: string | null
  taskId: string | null
  title: string
  actorId: string | null
}

type AlertRow = {
  id: string
  kind: AlertKind
  event_id: string | null
  task_id: string | null
  title: string
  actor_id?: string | null
}

const toAlert = (row: AlertRow): EventAlert => ({
  id: row.id,
  kind: row.kind,
  eventId: row.event_id,
  taskId: row.task_id,
  title: row.title,
  actorId: row.actor_id ?? null,
})

// Notifications not shown yet, for example ones that arrived while the app was closed.
export async function undeliveredAlerts(): Promise<EventAlert[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from("leaddesk_notifications")
    .select("id, kind, event_id, task_id, title, actor_id")
    .is("delivered_at", null)
    .order("created_at")
    .limit(20)
  if (error) throw new Error(error.message)
  return (data as AlertRow[]).map(toAlert)
}

export async function markAlertsDelivered(ids: string[]) {
  if (!supabase || ids.length === 0) return
  const { error } = await supabase
    .from("leaddesk_notifications")
    .update({ delivered_at: new Date().toISOString() })
    .in("id", ids)
  if (error) throw new Error(error.message)
}

// Calls onAlert for each notification created for this person while the app is open.
export function subscribeToAlerts(userId: string, onAlert: (alert: EventAlert) => void) {
  if (!supabase) return () => {}
  const client = supabase
  const channel = client
    // A fresh topic each time: reusing one that is still closing would leave this subscription dead.
    .channel(`leaddesk-notifications-${userId}:${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "leaddesk_notifications", filter: `user_id=eq.${userId}` },
      (payload) => onAlert(toAlert(payload.new as AlertRow)),
    )
    .subscribe()
  return () => {
    void client.removeChannel(channel)
  }
}
