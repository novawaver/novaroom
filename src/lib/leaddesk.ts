import { supabase } from "./supabase"
import { addDays, instantToZoned, isTimeZone, zonedToInstant } from "./timezone"

export type TaskStatus = "todo" | "doing" | "done"
export type TaskPriority = "low" | "normal" | "high"

export type DeskTask = {
  id: string
  title: string
  // Shown as "Description". The column is still called notes in the database.
  notes: string
  // Written by the assignee about the result.
  assigneeNotes: string
  status: TaskStatus
  priority: TaskPriority
  assigneeId: string | null
  dueDate: string | null
  createdBy: string | null
  createdAt: string
}

export type EventRepeat = "none" | "daily"

// "leaders": every leader can see the event. "participants": only its participants and creator.
export type EventVisibility = "leaders" | "participants"

// One-off events use startsAt/endsAt (exact moments). Daily events use startTime/endTime ("hh:mm")
// on the clock of timeZone, every day. timeZone is the zone the event was entered in.
export type DeskEvent = {
  id: string
  title: string
  notes: string
  location: string
  repeat: EventRepeat
  timeZone: string
  startsAt: string | null
  endsAt: string | null
  startTime: string | null
  endTime: string | null
  createdBy: string | null
  participantIds: string[]
  visibility: EventVisibility
  // Set by admins. Leaders can see a locked event but not change or delete it.
  locked: boolean
}

// One appearance of an event on the schedule. A daily event has one per day.
export type Occurrence = { event: DeskEvent; startsAt: string; endsAt: string }

// Appearances of an event that overlap [from, to], as exact moments; callers format them in the
// viewer's own zone. Daily events are walked day by day on the event's own calendar, so a 9:00 in
// Tokyo stays 9:00 in Tokyo whatever the viewer's zone or daylight-saving changes.
export function occurrencesOf(event: DeskEvent, from: Date, to: Date): Occurrence[] {
  if (event.repeat !== "daily") {
    if (!event.startsAt || !event.endsAt) return []
    const overlaps =
      new Date(event.startsAt).getTime() <= to.getTime() && new Date(event.endsAt).getTime() >= from.getTime()
    return overlaps ? [{ event, startsAt: event.startsAt, endsAt: event.endsAt }] : []
  }
  if (!event.startTime || !event.endTime) return []
  const zone = isTimeZone(event.timeZone) ? event.timeZone : "UTC"
  const overnight = event.endTime <= event.startTime
  const found: Occurrence[] = []
  // Start a day early so an overnight event that began yesterday is included.
  let day = addDays(instantToZoned(from, zone).date, -1)
  const lastDay = addDays(instantToZoned(to, zone).date, 1)
  while (day <= lastDay && found.length < 400) {
    const start = zonedToInstant(day, event.startTime, zone)
    const end = zonedToInstant(overnight ? addDays(day, 1) : day, event.endTime, zone)
    if (start.getTime() <= to.getTime() && end.getTime() >= from.getTime()) {
      found.push({ event, startsAt: start.toISOString(), endsAt: end.toISOString() })
    }
    day = addDays(day, 1)
  }
  return found
}

export type DeskNote = {
  id: string
  title: string
  body: string
  pinned: boolean
  updatedAt: string
}

export const LEADERSHIP = "Leadership"

// Offline preview keeps LeadDesk in local storage, shared by every preview account on this computer.
const PREVIEW_KEY = "novaroom.preview.leaddesk"

type PreviewDesk = { tasks: DeskTask[]; events: DeskEvent[]; notes: DeskNote[] }

function readPreview(): PreviewDesk {
  const empty: PreviewDesk = { tasks: [], events: [], notes: [] }
  const raw = localStorage.getItem(PREVIEW_KEY)
  if (!raw) return empty
  try {
    return { ...empty, ...(JSON.parse(raw) as Partial<PreviewDesk>) }
  } catch {
    return empty
  }
}

function writePreview(desk: PreviewDesk) {
  localStorage.setItem(PREVIEW_KEY, JSON.stringify(desk))
}

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

// Tasks ----------------------------------------------------------------------

type TaskRow = {
  id: string
  title: string
  notes: string
  assignee_notes: string
  status: TaskStatus
  priority: TaskPriority
  assignee_id: string | null
  due_date: string | null
  created_by: string | null
  created_at: string
}

const toTask = (row: TaskRow): DeskTask => ({
  id: row.id,
  title: row.title,
  notes: row.notes,
  assigneeNotes: row.assignee_notes,
  status: row.status,
  priority: row.priority,
  assigneeId: row.assignee_id,
  dueDate: row.due_date,
  createdBy: row.created_by,
  createdAt: row.created_at,
})

export async function listTasks(): Promise<DeskTask[]> {
  if (!supabase) {
    return readPreview().tasks.map((task) => ({
      ...task,
      assigneeNotes: task.assigneeNotes ?? "",
      createdBy: task.createdBy ?? null,
    }))
  }
  const { data, error } = await supabase
    .from("leaddesk_tasks")
    .select("id, title, notes, assignee_notes, status, priority, assignee_id, due_date, created_by, created_at")
    .order("created_at")
  fail(error)
  return (data as TaskRow[]).map(toTask)
}

// Leaves assigneeNotes alone; only the assignee changes those, through saveAssigneeNotes.
export async function saveTask(task: Omit<DeskTask, "id" | "createdAt" | "assigneeNotes"> & { id?: string }) {
  // createdBy is only used by the preview store; the database sets created_by itself.
  const fields = {
    title: task.title.trim(),
    notes: task.notes.trim(),
    status: task.status,
    priority: task.priority,
    assignee_id: task.assigneeId,
    due_date: task.dueDate,
  }
  if (!fields.title) throw new Error("Give the task a title.")
  if (!supabase) {
    const desk = readPreview()
    const existing = desk.tasks.find((item) => item.id === task.id)
    const saved: DeskTask = {
      ...task,
      title: fields.title,
      notes: fields.notes,
      assigneeNotes: existing?.assigneeNotes ?? "",
      id: task.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    }
    desk.tasks = task.id ? desk.tasks.map((item) => (item.id === task.id ? saved : item)) : [...desk.tasks, saved]
    writePreview(desk)
    return
  }
  const { error } = task.id
    ? await supabase
        .from("leaddesk_tasks")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", task.id)
    : await supabase.from("leaddesk_tasks").insert(fields)
  fail(error)
}

export async function saveAssigneeNotes(id: string, text: string) {
  const assigneeNotes = text.trim()
  if (!supabase) {
    const desk = readPreview()
    desk.tasks = desk.tasks.map((item) => (item.id === id ? { ...item, assigneeNotes } : item))
    writePreview(desk)
    return
  }
  const { error } = await supabase
    .from("leaddesk_tasks")
    .update({ assignee_notes: assigneeNotes, updated_at: new Date().toISOString() })
    .eq("id", id)
  fail(error)
}

// Whether an admin has let this person add new tasks. Offline preview has no admins, so it is allowed.
// The database enforces this too; this only decides whether the button is enabled.
export async function readCanAddTasks(userId: string): Promise<boolean> {
  if (!supabase) return true
  const { data, error } = await supabase
    .from("task_permissions")
    .select("can_add_tasks")
    .eq("user_id", userId)
    .maybeSingle()
  fail(error)
  return Boolean((data as { can_add_tasks: boolean } | null)?.can_add_tasks)
}

export async function setTaskStatus(id: string, status: TaskStatus) {
  if (!supabase) {
    const desk = readPreview()
    desk.tasks = desk.tasks.map((item) => (item.id === id ? { ...item, status } : item))
    writePreview(desk)
    return
  }
  const { error } = await supabase
    .from("leaddesk_tasks")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
  fail(error)
}

export async function deleteTask(id: string) {
  if (!supabase) {
    const desk = readPreview()
    desk.tasks = desk.tasks.filter((item) => item.id !== id)
    writePreview(desk)
    return
  }
  const { error } = await supabase.from("leaddesk_tasks").delete().eq("id", id)
  fail(error)
}

// Schedule -------------------------------------------------------------------

type EventRow = {
  id: string
  title: string
  notes: string
  location: string
  repeat: EventRepeat
  time_zone: string
  starts_at: string | null
  ends_at: string | null
  start_time: string | null
  end_time: string | null
  created_by: string | null
  participant_ids: string[] | null
  visibility: EventVisibility
  locked: boolean
}

const toEvent = (row: EventRow): DeskEvent => ({
  id: row.id,
  title: row.title,
  notes: row.notes,
  location: row.location,
  repeat: row.repeat,
  timeZone: row.time_zone,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  // The database returns "09:00:00".
  startTime: row.start_time?.slice(0, 5) ?? null,
  endTime: row.end_time?.slice(0, 5) ?? null,
  createdBy: row.created_by,
  participantIds: row.participant_ids ?? [],
  visibility: row.visibility,
  locked: row.locked,
})

export async function listEvents(): Promise<DeskEvent[]> {
  if (!supabase) {
    return readPreview().events.map((event) => ({
      ...event,
      createdBy: event.createdBy ?? null,
      participantIds: event.participantIds ?? [],
      visibility: event.visibility ?? "leaders",
      locked: event.locked ?? false,
    }))
  }
  const { data, error } = await supabase
    .from("leaddesk_events")
    .select(
      "id, title, notes, location, repeat, time_zone, starts_at, ends_at, start_time, end_time, created_by, participant_ids, visibility, locked",
    )
  fail(error)
  return (data as EventRow[]).map(toEvent)
}

export async function saveEvent(event: Omit<DeskEvent, "id"> & { id?: string }) {
  const daily = event.repeat === "daily"
  const fields = {
    title: event.title.trim(),
    notes: event.notes.trim(),
    location: event.location.trim(),
    repeat: event.repeat,
    time_zone: event.timeZone,
    starts_at: daily ? null : event.startsAt,
    ends_at: daily ? null : event.endsAt,
    start_time: daily ? event.startTime : null,
    end_time: daily ? event.endTime : null,
    participant_ids: [...new Set(event.participantIds)],
    visibility: event.visibility,
  }
  if (!fields.title) throw new Error("Give the event a title.")
  if (!isTimeZone(fields.time_zone)) throw new Error("Choose a valid time zone.")
  if (daily) {
    if (!fields.start_time || !fields.end_time) throw new Error("Set a start and end time.")
    if (fields.start_time === fields.end_time) throw new Error("The event has to end at a different time than it starts.")
  } else {
    if (!fields.starts_at || !fields.ends_at) throw new Error("Set when the event starts and ends.")
    if (new Date(fields.ends_at) <= new Date(fields.starts_at)) throw new Error("The event has to end after it starts.")
  }
  if (!supabase) {
    const desk = readPreview()
    const saved: DeskEvent = {
      id: event.id ?? crypto.randomUUID(),
      title: fields.title,
      notes: fields.notes,
      location: fields.location,
      repeat: fields.repeat,
      timeZone: fields.time_zone,
      startsAt: fields.starts_at,
      endsAt: fields.ends_at,
      startTime: fields.start_time,
      endTime: fields.end_time,
      // The database fills in created_by itself; preview has to keep it here.
      createdBy: event.createdBy,
      participantIds: fields.participant_ids,
      visibility: fields.visibility,
      locked: event.locked,
    }
    desk.events = event.id ? desk.events.map((item) => (item.id === event.id ? saved : item)) : [...desk.events, saved]
    writePreview(desk)
    return
  }
  const { error } = event.id
    ? await supabase.from("leaddesk_events").update(fields).eq("id", event.id)
    : await supabase.from("leaddesk_events").insert(fields)
  fail(error)
}

export async function deleteEvent(id: string) {
  if (!supabase) {
    const desk = readPreview()
    desk.events = desk.events.filter((item) => item.id !== id)
    writePreview(desk)
    return
  }
  const { error } = await supabase.from("leaddesk_events").delete().eq("id", id)
  fail(error)
}

// Read state, for unread badges ------------------------------------------------

const PREVIEW_READS_KEY = (userId: string) => `novaroom.preview.leaddesk-reads.${userId}`

// Events this person has already seen on the Schedule tab.
export async function listReadEventIds(userId: string): Promise<Set<string>> {
  if (!supabase) {
    try {
      return new Set(JSON.parse(localStorage.getItem(PREVIEW_READS_KEY(userId)) ?? "[]") as string[])
    } catch {
      return new Set()
    }
  }
  const { data, error } = await supabase.from("leaddesk_event_reads").select("event_id").eq("user_id", userId)
  fail(error)
  return new Set((data as Array<{ event_id: string }>).map((row) => row.event_id))
}

export async function markEventsRead(userId: string, eventIds: string[]) {
  if (eventIds.length === 0) return
  if (!supabase) {
    const seen = await listReadEventIds(userId)
    for (const id of eventIds) seen.add(id)
    localStorage.setItem(PREVIEW_READS_KEY(userId), JSON.stringify([...seen]))
    return
  }
  const { error } = await supabase
    .from("leaddesk_event_reads")
    .upsert(
      eventIds.map((eventId) => ({ user_id: userId, event_id: eventId })),
      { onConflict: "user_id,event_id", ignoreDuplicates: true },
    )
  fail(error)
}

// Unread: visible to this person, made by someone else, and not seen yet.
export function unreadEvents(events: DeskEvent[], readIds: Set<string>, userId: string) {
  return events.filter((event) => event.createdBy !== userId && !readIds.has(event.id))
}

const PREVIEW_TASK_READS_KEY = (userId: string) => `novaroom.preview.leaddesk-task-reads.${userId}`

// Tasks this person has already opened.
export async function listReadTaskIds(userId: string): Promise<Set<string>> {
  if (!supabase) {
    try {
      return new Set(JSON.parse(localStorage.getItem(PREVIEW_TASK_READS_KEY(userId)) ?? "[]") as string[])
    } catch {
      return new Set()
    }
  }
  const { data, error } = await supabase.from("leaddesk_task_reads").select("task_id").eq("user_id", userId)
  fail(error)
  return new Set((data as Array<{ task_id: string }>).map((row) => row.task_id))
}

export async function markTasksRead(userId: string, taskIds: string[]) {
  if (taskIds.length === 0) return
  if (!supabase) {
    const seen = await listReadTaskIds(userId)
    for (const id of taskIds) seen.add(id)
    localStorage.setItem(PREVIEW_TASK_READS_KEY(userId), JSON.stringify([...seen]))
    return
  }
  const { error } = await supabase
    .from("leaddesk_task_reads")
    .upsert(
      taskIds.map((taskId) => ({ user_id: userId, task_id: taskId })),
      { onConflict: "user_id,task_id", ignoreDuplicates: true },
    )
  fail(error)
}

// Unread: assigned to this person and not opened since. The database clears the read when someone
// else assigns it to them, and marks it read when they assign it to themselves.
export function unreadTasks(tasks: DeskTask[], readIds: Set<string>, userId: string) {
  return tasks.filter((task) => task.assigneeId === userId && !readIds.has(task.id))
}

// Calls onChange whenever an event or task this person can see is added, changed or removed.
export function subscribeToDeskChanges(onChange: () => void) {
  if (!supabase) return () => {}
  const client = supabase
  const channel = client
    .channel("leaddesk-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "leaddesk_events" }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "leaddesk_tasks" }, () => onChange())
    // Someone may have lost access to an event, which the events stream above cannot tell them.
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "leaddesk_signals" }, () => onChange())
    .subscribe()
  return () => {
    void client.removeChannel(channel)
  }
}

// Notes ----------------------------------------------------------------------

type NoteRow = { id: string; title: string; body: string; pinned: boolean; updated_at: string }

const toNote = (row: NoteRow): DeskNote => ({
  id: row.id,
  title: row.title,
  body: row.body,
  pinned: row.pinned,
  updatedAt: row.updated_at,
})

export async function listNotes(): Promise<DeskNote[]> {
  const sort = (notes: DeskNote[]) =>
    [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt))
  if (!supabase) return sort(readPreview().notes)
  const { data, error } = await supabase.from("leaddesk_notes").select("id, title, body, pinned, updated_at")
  fail(error)
  return sort((data as NoteRow[]).map(toNote))
}

export async function saveNote(note: Omit<DeskNote, "id" | "updatedAt"> & { id?: string }) {
  const fields = { title: note.title.trim(), body: note.body.trim(), pinned: note.pinned }
  if (!fields.title) throw new Error("Give the note a title.")
  const updatedAt = new Date().toISOString()
  if (!supabase) {
    const desk = readPreview()
    const saved: DeskNote = { ...fields, id: note.id ?? crypto.randomUUID(), updatedAt }
    desk.notes = note.id ? desk.notes.map((item) => (item.id === note.id ? saved : item)) : [...desk.notes, saved]
    writePreview(desk)
    return
  }
  const { error } = note.id
    ? await supabase.from("leaddesk_notes").update({ ...fields, updated_at: updatedAt }).eq("id", note.id)
    : await supabase.from("leaddesk_notes").insert(fields)
  fail(error)
}

export async function deleteNote(id: string) {
  if (!supabase) {
    const desk = readPreview()
    desk.notes = desk.notes.filter((item) => item.id !== id)
    writePreview(desk)
    return
  }
  const { error } = await supabase.from("leaddesk_notes").delete().eq("id", id)
  fail(error)
}
