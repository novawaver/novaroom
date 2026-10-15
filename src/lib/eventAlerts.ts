import { supabase } from "./supabase"

// "You were added to an event" notifications, created by the database for each new participant.
export type EventAlert = { id: string; eventId: string | null; title: string }

type AlertRow = { id: string; event_id: string | null; title: string }

const toAlert = (row: AlertRow): EventAlert => ({ id: row.id, eventId: row.event_id, title: row.title })

// Notifications not shown yet, for example ones that arrived while the app was closed.
export async function undeliveredAlerts(): Promise<EventAlert[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from("leaddesk_notifications")
    .select("id, event_id, title")
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
    .channel(`leaddesk-notifications-${userId}`)
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
