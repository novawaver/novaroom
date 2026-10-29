import { safeFileName } from "./chats"
import { supabase } from "./supabase"
import { addDays, instantToZoned, isTimeZone, localTimeZone, zonedToInstant } from "./timezone"

export type TaskStatus = "todo" | "doing" | "done" | "failed"

/** An assignee's own verdict on a task. */
export type TaskResult = "done" | "failed"

export type TaskSignoff = { result: TaskResult; signedAt: string }
export type TaskPriority = "low" | "normal" | "high"

export type DeskTask = {
  id: string
  title: string
  // Shown as "Description". The column is still called notes in the database.
  notes: string
  // Written by the assignees about the result.
  assigneeNotes: string
  status: TaskStatus
  priority: TaskPriority
  // Everyone the task is assigned to; empty when no one is.
  assigneeIds: string[]
  // Results signed by assignees, by their id.
  signoffs: Record<string, TaskSignoff>
  dueDate: string | null
  // The creator's zone, which the due date is counted in. Null on older tasks: use the viewer's.
  timeZone: string | null
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
  // Tags from the list admins keep, in the order they were picked.
  tagIds: string[]
  // How many minutes before each start participants are alerted; null for no alarm.
  alarmMinutes: number | null
  // Attached files, oldest first. Changed with addEventFiles and removeEventFiles, not saveEvent.
  files: EventFile[]
}

// A file attached to an event. Its address comes from eventFileUrls when it is shown.
export type EventFile = {
  id: string
  path: string
  name: string
  mime: string
  size: number
}

// A label admins set up for events. color is one of the accent names (see lib/accent.ts).
export type EventTag = { id: string; name: string; color: string }

// At most this many tags on one event; the database holds to it too.
export const EVENT_TAGS_MAX = 10

// The alarm times offered in the event form, in minutes before the start. The database allows 1 to 1440.
export const ALARM_CHOICES = [5, 10, 15, 30, 60, 120, 1440]

// "15 minutes", "1 hour", "1 day".
export function alarmLabel(minutes: number) {
  if (minutes % 1440 === 0) return minutes === 1440 ? "1 day" : `${minutes / 1440} days`
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`
  return minutes === 1 ? "1 minute" : `${minutes} minutes`
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
  assignee_ids: string[] | null
  due_date: string | null
  time_zone: string | null
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
  assigneeIds: row.assignee_ids ?? [],
  signoffs: {},
  dueDate: row.due_date,
  timeZone: row.time_zone && isTimeZone(row.time_zone) ? row.time_zone : null,
  createdBy: row.created_by,
  createdAt: row.created_at,
})

export async function listTasks(): Promise<DeskTask[]> {
  if (!supabase) {
    // Tasks saved before several assignees were possible have a single assigneeId.
    return readPreview().tasks.map(({ assigneeId, ...task }: DeskTask & { assigneeId?: string | null }) => ({
      ...task,
      assigneeIds: task.assigneeIds ?? (assigneeId ? [assigneeId] : []),
      signoffs: task.signoffs ?? {},
      assigneeNotes: task.assigneeNotes ?? "",
      timeZone: task.timeZone ?? null,
      createdBy: task.createdBy ?? null,
    }))
  }
  const [tasks, signoffs] = await Promise.all([
    supabase
      .from("leaddesk_tasks")
      .select("id, title, notes, assignee_notes, status, priority, assignee_ids, due_date, time_zone, created_by, created_at")
      .order("created_at"),
    supabase.from("leaddesk_task_signoffs").select("task_id, user_id, result, signed_at"),
  ])
  fail(tasks.error)
  fail(signoffs.error)
  const byTask = new Map<string, Record<string, TaskSignoff>>()
  for (const row of signoffs.data as Array<{ task_id: string; user_id: string; result: TaskResult; signed_at: string }>) {
    const signed = byTask.get(row.task_id) ?? {}
    signed[row.user_id] = { result: row.result, signedAt: row.signed_at }
    byTask.set(row.task_id, signed)
  }
  return (tasks.data as TaskRow[]).map((row) => ({ ...toTask(row), signoffs: byTask.get(row.id) ?? {} }))
}

/**
 * The status a task gets from its assignees' results: failed when anyone failed it, done when all
 * of them signed done, and in progress while only some have. Taking back the result that finished
 * it puts it back in progress.
 */
export function settledStatus(task: Pick<DeskTask, "status" | "assigneeIds" | "signoffs">): TaskStatus {
  const results = task.assigneeIds.map((id) => task.signoffs[id]?.result)
  if (results.includes("failed")) return "failed"
  if (results.length > 0 && results.every((result) => result === "done")) return "done"
  if (results.includes("done")) return "doing"
  return task.status === "done" || task.status === "failed" ? "doing" : task.status
}

/** Signs this assignee's result on a task, or takes it back with null. */
export async function signTask(id: string, userId: string, outcome: TaskResult | null) {
  if (!supabase) {
    const desk = readPreview()
    desk.tasks = desk.tasks.map((item) => {
      if (item.id !== id) return item
      const signoffs = { ...(item.signoffs ?? {}) }
      if (outcome) signoffs[userId] = { result: outcome, signedAt: new Date().toISOString() }
      else delete signoffs[userId]
      const next = { ...item, signoffs }
      return { ...next, status: settledStatus(next) }
    })
    writePreview(desk)
    return
  }
  const { error } = await supabase.rpc("sign_task", { task: id, outcome })
  fail(error)
}

/**
 * When a task is due: the end of its due date on its creator's clock (the viewer's for older tasks
 * with no zone saved). Null when it has no due date.
 */
export function taskDeadline(task: Pick<DeskTask, "dueDate" | "timeZone">): Date | null {
  if (!task.dueDate) return null
  return zonedToInstant(addDays(task.dueDate, 1), "00:00", task.timeZone ?? localTimeZone())
}

// Leaves assigneeNotes and sign-offs alone; only assignees change those. A new task gets the
// creator's time zone; an edited one keeps the zone it was created in.
export async function saveTask(
  task: Omit<DeskTask, "id" | "createdAt" | "assigneeNotes" | "signoffs" | "timeZone"> & { id?: string },
) {
  // createdBy is only used by the preview store; the database sets created_by itself.
  const fields = {
    title: task.title.trim(),
    notes: task.notes.trim(),
    status: task.status,
    priority: task.priority,
    assignee_ids: [...new Set(task.assigneeIds)],
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
      assigneeIds: fields.assignee_ids,
      signoffs: Object.fromEntries(
        Object.entries(existing?.signoffs ?? {}).filter(([person]) => fields.assignee_ids.includes(person)),
      ),
      assigneeNotes: existing?.assigneeNotes ?? "",
      timeZone: existing ? (existing.timeZone ?? null) : localTimeZone(),
      id: task.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    }
    // Changing the assignees works the status out again from the results left, as the database does.
    const before = existing?.assigneeIds ?? []
    const reassigned =
      before.length !== saved.assigneeIds.length || before.some((id) => !saved.assigneeIds.includes(id))
    if (reassigned && saved.assigneeIds.length > 0) saved.status = settledStatus(saved)
    desk.tasks = task.id ? desk.tasks.map((item) => (item.id === task.id ? saved : item)) : [...desk.tasks, saved]
    writePreview(desk)
    return
  }
  const { error } = task.id
    ? await supabase
        .from("leaddesk_tasks")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", task.id)
    : await supabase.from("leaddesk_tasks").insert({ ...fields, time_zone: localTimeZone() })
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
  tag_ids: string[] | null
  alarm_minutes: number | null
}

type EventFileRow = { id: string; event_id: string; path: string; name: string; mime: string; size: number }

const toEvent = (row: EventRow): Omit<DeskEvent, "files"> => ({
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
  tagIds: row.tag_ids ?? [],
  alarmMinutes: row.alarm_minutes,
})

export async function listEvents(): Promise<DeskEvent[]> {
  if (!supabase) {
    return readPreview().events.map((event) => ({
      ...event,
      createdBy: event.createdBy ?? null,
      participantIds: event.participantIds ?? [],
      visibility: event.visibility ?? "leaders",
      locked: event.locked ?? false,
      tagIds: event.tagIds ?? [],
      alarmMinutes: event.alarmMinutes ?? null,
      files: event.files ?? [],
    }))
  }
  const [events, files] = await Promise.all([
    supabase
      .from("leaddesk_events")
      .select(
        "id, title, notes, location, repeat, time_zone, starts_at, ends_at, start_time, end_time, created_by, participant_ids, visibility, locked, tag_ids, alarm_minutes",
      ),
    supabase.from("leaddesk_event_files").select("id, event_id, path, name, mime, size").order("created_at"),
  ])
  fail(events.error)
  fail(files.error)
  const byEvent = new Map<string, EventFile[]>()
  for (const { event_id, ...file } of files.data as EventFileRow[]) {
    byEvent.set(event_id, [...(byEvent.get(event_id) ?? []), file])
  }
  return (events.data as EventRow[]).map((row) => ({ ...toEvent(row), files: byEvent.get(row.id) ?? [] }))
}

// Saves an event's details and returns its id. Its files are left as they are.
export async function saveEvent(event: Omit<DeskEvent, "id" | "files"> & { id?: string }): Promise<string> {
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
    tag_ids: [...new Set(event.tagIds)],
    alarm_minutes: event.alarmMinutes,
  }
  if (!fields.title) throw new Error("Give the event a title.")
  if (fields.tag_ids.length > EVENT_TAGS_MAX) throw new Error(`An event can have up to ${EVENT_TAGS_MAX} tags.`)
  if (fields.alarm_minutes !== null && !(fields.alarm_minutes >= 1 && fields.alarm_minutes <= 1440)) {
    throw new Error("Set the alarm between 1 minute and 1 day before the start.")
  }
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
    const id = event.id ?? crypto.randomUUID()
    const saved: DeskEvent = {
      id,
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
      tagIds: fields.tag_ids,
      alarmMinutes: fields.alarm_minutes,
      files: desk.events.find((item) => item.id === event.id)?.files ?? [],
    }
    desk.events = event.id ? desk.events.map((item) => (item.id === event.id ? saved : item)) : [...desk.events, saved]
    writePreview(desk)
    return id
  }
  if (event.id) {
    const { error } = await supabase.from("leaddesk_events").update(fields).eq("id", event.id)
    fail(error)
    return event.id
  }
  const { data, error } = await supabase.from("leaddesk_events").insert(fields).select("id").single()
  fail(error)
  return (data as { id: string }).id
}

// The tags admins have set up, in the order they set. Preview has none: tags are kept on the admin site.
export async function listEventTags(): Promise<EventTag[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from("leaddesk_event_tags")
    .select("id, name, color")
    .order("position")
    .order("name")
  fail(error)
  return data as EventTag[]
}

export async function deleteEvent(id: string) {
  if (!supabase) {
    const desk = readPreview()
    const gone = desk.events.find((item) => item.id === id)?.files ?? []
    desk.events = desk.events.filter((item) => item.id !== id)
    writePreview(desk)
    forgetPreviewFiles(gone)
    return
  }
  // The rows go with the event, so note the stored files first and remove them once it is gone.
  const { data: files, error: filesError } = await supabase
    .from("leaddesk_event_files")
    .select("path")
    .eq("event_id", id)
  fail(filesError)
  const { error } = await supabase.from("leaddesk_events").delete().eq("id", id)
  fail(error)
  await removeStoredFiles((files as Array<{ path: string }>).map((file) => file.path))
}

// Event files -------------------------------------------------------------------

const EVENT_FILES_BUCKET = "leaddesk-files"
export const EVENT_FILE_LIMIT = 25 * 1024 * 1024
export const EVENT_FILES_MAX = 10
// Offline preview keeps files in local storage, which only holds a few MB in all.
const PREVIEW_FILE_LIMIT = 2 * 1024 * 1024
// File contents in offline preview, by file id, kept apart so listing events stays small.
const PREVIEW_FILES_KEY = "novaroom.preview.leaddesk-files"

function readPreviewFiles(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PREVIEW_FILES_KEY) ?? "{}") as Record<string, string>
  } catch {
    return {}
  }
}

function forgetPreviewFiles(files: EventFile[]) {
  const stored = readPreviewFiles()
  for (const file of files) delete stored[file.id]
  localStorage.setItem(PREVIEW_FILES_KEY, JSON.stringify(stored))
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("Could not read that file."))
    reader.readAsDataURL(file)
  })
}

// A file that can't be removed is only logged: the event or row it belonged to is already gone.
async function removeStoredFiles(paths: string[]) {
  if (!supabase || paths.length === 0) return
  const { error } = await supabase.storage.from(EVENT_FILES_BUCKET).remove(paths)
  if (error) console.warn("Could not remove event files:", error.message)
}

/** Attaches files to a saved event, one at a time, stopping at the first that fails. */
export async function addEventFiles(eventId: string, files: File[]) {
  for (const file of files) {
    if (file.size > EVENT_FILE_LIMIT) throw new Error(`${file.name} is over 25 MB.`)
  }
  if (!supabase) {
    for (const file of files) {
      if (file.size > PREVIEW_FILE_LIMIT) {
        throw new Error("This preview keeps files up to 2 MB. Connected projects allow 25 MB.")
      }
      const id = crypto.randomUUID()
      const stored = readPreviewFiles()
      stored[id] = await readAsDataUrl(file)
      try {
        localStorage.setItem(PREVIEW_FILES_KEY, JSON.stringify(stored))
      } catch {
        throw new Error("This preview has no room for more files. Remove some first.")
      }
      const desk = readPreview()
      const added: EventFile = { id, path: id, name: file.name || "file", mime: file.type, size: file.size }
      desk.events = desk.events.map((item) =>
        item.id === eventId ? { ...item, files: [...(item.files ?? []), added] } : item,
      )
      writePreview(desk)
    }
    return
  }
  for (const file of files) {
    const path = `${eventId}/${crypto.randomUUID()}/${safeFileName(file.name)}`
    const { error: uploadError } = await supabase.storage.from(EVENT_FILES_BUCKET).upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    })
    fail(uploadError)
    const { error } = await supabase.from("leaddesk_event_files").insert({
      event_id: eventId,
      path,
      name: (file.name || "file").slice(0, 255),
      mime: file.type,
      size: file.size,
    })
    if (error) {
      await removeStoredFiles([path])
      fail(error)
    }
  }
}

export async function removeEventFiles(files: EventFile[]) {
  if (files.length === 0) return
  if (!supabase) {
    const ids = new Set(files.map((file) => file.id))
    const desk = readPreview()
    desk.events = desk.events.map((item) => ({ ...item, files: (item.files ?? []).filter((file) => !ids.has(file.id)) }))
    writePreview(desk)
    forgetPreviewFiles(files)
    return
  }
  const { error } = await supabase.from("leaddesk_event_files").delete().in("id", files.map((file) => file.id))
  fail(error)
  await removeStoredFiles(files.map((file) => file.path))
}

/** Addresses to show event files at, by file id, good for an hour. */
export async function eventFileUrls(files: EventFile[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  if (files.length === 0) return urls
  if (!supabase) {
    const stored = readPreviewFiles()
    for (const file of files) if (stored[file.id]) urls.set(file.id, stored[file.id])
    return urls
  }
  const { data, error } = await supabase.storage.from(EVENT_FILES_BUCKET).createSignedUrls(
    files.map((file) => file.path),
    60 * 60,
  )
  fail(error)
  const byPath = new Map(files.map((file) => [file.path, file.id]))
  for (const item of data ?? []) {
    const id = item.path ? byPath.get(item.path) : undefined
    if (id && item.signedUrl) urls.set(id, item.signedUrl)
  }
  return urls
}

/** An address that downloads the file under its own name, rather than showing it. */
export async function eventFileDownloadUrl(file: EventFile): Promise<string> {
  if (!supabase) {
    const url = readPreviewFiles()[file.id]
    if (!url) throw new Error("That file is no longer available.")
    return url
  }
  const { data, error } = await supabase.storage
    .from(EVENT_FILES_BUCKET)
    .createSignedUrl(file.path, 10 * 60, { download: file.name })
  fail(error)
  return data!.signedUrl
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
// else adds them to it, and marks it read when they add themselves.
export function unreadTasks(tasks: DeskTask[], readIds: Set<string>, userId: string) {
  return tasks.filter((task) => task.assigneeIds.includes(userId) && !readIds.has(task.id))
}

// Calls onChange whenever an event or task this person can see is added, changed or removed.
export function subscribeToDeskChanges(onChange: () => void) {
  if (!supabase) return () => {}
  const client = supabase
  const channel = client
    // A fresh topic each time: reusing one that is still closing would leave this subscription dead.
    .channel(`leaddesk-changes:${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "leaddesk_events" }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "leaddesk_event_files" }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "leaddesk_event_tags" }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "leaddesk_tasks" }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "leaddesk_task_signoffs" }, () => onChange())
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
