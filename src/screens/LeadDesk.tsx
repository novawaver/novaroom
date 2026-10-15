import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react"
import { useAuth } from "../auth"
import {
  LEADERSHIP,
  deleteEvent,
  deleteNote,
  deleteTask,
  listEvents,
  listNotes,
  listTasks,
  saveEvent,
  saveNote,
  saveTask,
  setTaskStatus,
  type DeskEvent,
  type DeskNote,
  type DeskTask,
  type EventVisibility,
  type Occurrence,
  type TaskPriority,
  type TaskStatus,
} from "../lib/leaddesk"
import { listUsers, type RegisteredUser } from "../lib/users"
import {
  addDays,
  instantToZoned,
  localTimeZone,
  timeZoneOptions,
  zoneAbbreviation,
  zonedToInstant,
} from "../lib/timezone"

export type LeadDeskTab = "tasks" | "schedule" | "notes"

export const LEADDESK_TABS: Array<{ id: LeadDeskTab; label: string }> = [
  { id: "tasks", label: "Tasks" },
  { id: "schedule", label: "Schedule" },
  { id: "notes", label: "Notes" },
]

const STATUSES: Array<{ id: TaskStatus; label: string }> = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "In progress" },
  { id: "done", label: "Done" },
]

const PRIORITIES: Array<{ id: TaskPriority; label: string }> = [
  { id: "high", label: "High" },
  { id: "normal", label: "Normal" },
  { id: "low", label: "Low" },
]

export type DeskData = {
  tasks: DeskTask[]
  events: DeskEvent[]
  notes: DeskNote[]
  leaders: RegisteredUser[]
  // Everyone, for showing who created an event or took part after leaving Leadership.
  users: RegisteredUser[]
}

// Loads everything on LeadDesk while it is open; the sidebar counts and the page share it.
export function useLeadDesk(open: boolean) {
  const [data, setData] = useState<DeskData | null>(null)
  const [error, setError] = useState("")

  const reload = useCallback(async () => {
    try {
      const [tasks, events, notes, users] = await Promise.all([listTasks(), listEvents(), listNotes(), listUsers()])
      setData({ tasks, events, notes, users, leaders: users.filter((user) => user.role === LEADERSHIP) })
      setError("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load LeadDesk.")
    }
  }, [])

  useEffect(() => {
    if (open) void reload()
  }, [open, reload])

  return { data, error, reload }
}

export function leadDeskHints(data: DeskData | null, selfId: string): Record<LeadDeskTab, string> {
  if (!data) return { tasks: "Loading…", schedule: "Loading…", notes: "Loading…" }
  const open = visibleTasks(data.tasks, selfId).filter((task) => task.status !== "done").length
  const daily = data.events.filter((event) => event.repeat === "daily").length
  const upcoming = data.events.filter(
    (event) => event.repeat !== "daily" && event.endsAt && new Date(event.endsAt).getTime() >= Date.now(),
  ).length
  return {
    tasks: `${open} open`,
    schedule: `${daily} daily · ${upcoming} upcoming`,
    notes: data.notes.length === 1 ? "1 note" : `${data.notes.length} notes`,
  }
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase() || "?"
}

function todayKey() {
  return localDate(new Date())
}

function localDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatDay(key: string) {
  const today = todayKey()
  const tomorrow = localDate(new Date(Date.now() + 24 * 60 * 60 * 1000))
  if (key === today) return "Today"
  if (key === tomorrow) return "Tomorrow"
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(
    new Date(`${key}T00:00`),
  )
}

function formatShortDate(key: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${key}T00:00`))
}

// "hh:mm" on the viewer's clock, for sorting by time of day.
function formatClock(value: string) {
  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value))
}

export function LeadDesk({
  tab,
  data,
  error,
  reload,
  newEventIds,
  onEventOpened,
}: {
  tab: LeadDeskTab
  data: DeskData | null
  error: string
  reload: () => Promise<void>
  // Unread events, shown as "New" on the Schedule tab until they are opened.
  newEventIds: Set<string>
  onEventOpened: (eventId: string) => void
}) {
  const { session } = useAuth()
  const [editing, setEditing] = useState<{ kind: LeadDeskTab; item: DeskTask | DeskEvent | DeskNote | null } | null>(
    null,
  )
  const [actionError, setActionError] = useState("")
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const closeTask = useCallback(() => setSelectedTaskId(null), [])

  if (!session) return null
  // Looked up by id so the drawer follows edits and closes if the task is deleted.
  const selectedTask = data?.tasks.find((task) => task.id === selectedTaskId) ?? null

  async function act(action: () => Promise<void>) {
    setActionError("")
    try {
      await action()
      await reload()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "That did not work.")
    }
  }

  const label = LEADDESK_TABS.find((item) => item.id === tab)?.label ?? "LeadDesk"
  const newLabel = tab === "tasks" ? "New task" : tab === "schedule" ? "New event" : "New note"

  return (
    <section className={tab === "schedule" ? "settings desk-fixed" : "settings"}>
      <header className="thread-bar profile-bar">
        <h1>{label}</h1>
        <button type="button" className="button desk-new" onClick={() => setEditing({ kind: tab, item: null })}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {newLabel}
        </button>
      </header>
      {(error || actionError) && (
        <p className="form-error desk-note" role="alert">
          {error || actionError}
        </p>
      )}
      {!data ? (
        !error && <p className="hint desk-note">Loading LeadDesk…</p>
      ) : tab === "tasks" ? (
        <TaskBoard
          tasks={data.tasks}
          users={data.users}
          selfId={session.userId}
          selectedId={selectedTask?.id ?? null}
          onSelect={(task) => setSelectedTaskId(task.id)}
          onMove={(task, status) => void act(() => setTaskStatus(task.id, status))}
        />
      ) : tab === "schedule" ? (
        <Schedule
          events={data.events}
          users={data.users}
          newEventIds={newEventIds}
          onSelect={(event) => onEventOpened(event.id)}
          onEdit={(event) => setEditing({ kind: "schedule", item: event })}
        />
      ) : (
        <Notes notes={data.notes} onOpen={(note) => setEditing({ kind: "notes", item: note })} />
      )}
      {tab === "tasks" && selectedTask && data && (
        <TaskDrawer
          task={selectedTask}
          users={data.users}
          covered={editing !== null}
          onEdit={() => setEditing({ kind: "tasks", item: selectedTask })}
          onClose={closeTask}
        />
      )}
      {editing?.kind === "tasks" && (
        <TaskEditor
          task={editing.item as DeskTask | null}
          leaders={data?.leaders ?? []}
          selfId={session.userId}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {editing?.kind === "schedule" && (
        <EventEditor
          event={editing.item as DeskEvent | null}
          users={data?.users ?? []}
          leaders={data?.leaders ?? []}
          selfId={session.userId}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {editing?.kind === "notes" && (
        <NoteEditor note={editing.item as DeskNote | null} onClose={() => setEditing(null)} onSaved={reload} />
      )}
    </section>
  )
}

// Tasks ----------------------------------------------------------------------

// The board shows tasks assigned to this person plus unassigned ones, not other people's.
export function visibleTasks(tasks: DeskTask[], selfId: string) {
  return tasks.filter((task) => task.assigneeId === null || task.assigneeId === selfId)
}

function TaskBoard({
  tasks,
  users,
  selfId,
  selectedId,
  onSelect,
  onMove,
}: {
  tasks: DeskTask[]
  users: RegisteredUser[]
  selfId: string
  selectedId: string | null
  onSelect: (task: DeskTask) => void
  onMove: (task: DeskTask, status: TaskStatus) => void
}) {
  const shown = visibleTasks(tasks, selfId)
  const today = todayKey()
  const rank: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 }

  return (
    <div className="desk-body">
      <div className="task-board">
        {STATUSES.map((column, index) => {
          const items = shown
            .filter((task) => task.status === column.id)
            .sort(
              (a, b) =>
                rank[a.priority] - rank[b.priority] ||
                (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
                a.createdAt.localeCompare(b.createdAt),
            )
          return (
            <section key={column.id} className="task-column">
              <h2>
                {column.label}
                <span>{items.length}</span>
              </h2>
              {items.length === 0 && <p className="task-empty">Nothing here.</p>}
              {items.map((task) => {
                const overdue = task.status !== "done" && task.dueDate !== null && task.dueDate < today
                return (
                  // The whole card opens the task; the title button keeps it reachable by keyboard.
                  <article
                    key={task.id}
                    className={`task-card priority-${task.priority}${task.id === selectedId ? " selected" : ""}`}
                    onClick={() => onSelect(task)}
                  >
                    <button
                      type="button"
                      className="task-open"
                      aria-current={task.id === selectedId ? "true" : undefined}
                    >
                      <strong>{task.title}</strong>
                      {task.notes && <span className="task-notes">{task.notes}</span>}
                    </button>
                    <div className="task-meta">
                      {task.priority !== "normal" && (
                        <span className={`task-tag ${task.priority}`}>
                          {task.priority === "high" ? "High" : "Low"}
                        </span>
                      )}
                      {task.dueDate && (
                        <span className={overdue ? "task-due overdue" : "task-due"}>
                          {overdue ? "Overdue · " : "Due "}
                          {formatShortDate(task.dueDate)}
                        </span>
                      )}
                      {task.assigneeId && (
                        <span className="task-assignee">
                          <PersonAvatar users={users} id={task.assigneeId} />
                        </span>
                      )}
                    </div>
                    <div className="task-move" onClick={(event) => event.stopPropagation()}>
                      {index > 0 && (
                        <button
                          type="button"
                          aria-label={`Move to ${STATUSES[index - 1].label}`}
                          title={`Move to ${STATUSES[index - 1].label}`}
                          onClick={() => onMove(task, STATUSES[index - 1].id)}
                        >
                          ←
                        </button>
                      )}
                      {index < STATUSES.length - 1 && (
                        <button
                          type="button"
                          aria-label={`Move to ${STATUSES[index + 1].label}`}
                          title={`Move to ${STATUSES[index + 1].label}`}
                          onClick={() => onMove(task, STATUSES[index + 1].id)}
                        >
                          →
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
            </section>
          )
        })}
      </div>
    </div>
  )
}

// Task details in a panel that slides in from the right over the board.
function TaskDrawer({
  task,
  users,
  covered,
  onEdit,
  onClose,
}: {
  task: DeskTask
  users: RegisteredUser[]
  // True while the editor is open on top, so Esc closes only the editor.
  covered: boolean
  onEdit: () => void
  onClose: () => void
}) {
  useEffect(() => {
    if (covered) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [covered, onClose])

  const overdue = task.status !== "done" && task.dueDate !== null && task.dueDate < todayKey()
  const status = STATUSES.find((item) => item.id === task.status)?.label ?? task.status
  const priority = PRIORITIES.find((item) => item.id === task.priority)?.label ?? task.priority

  return (
    <div className="drawer-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="event-detail drawer" role="dialog" aria-label="Task details">
        <div className="event-detail-head">
          <h2>{task.title}</h2>
          <button type="button" className="event-detail-icon" aria-label="Edit task" title="Edit" onClick={onEdit}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13" />
              <path d="M17.6 3.9a2 2 0 0 1 2.8 2.8L12.5 14.6 9 15.5l.9-3.5 7.7-8.1z" />
            </svg>
          </button>
          <button type="button" className="event-detail-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <dl className="event-facts">
          <dt>Status</dt>
          <dd>{status}</dd>
          <dt>Priority</dt>
          <dd>
            {task.priority === "normal" ? priority : <span className={`task-tag ${task.priority}`}>{priority}</span>}
          </dd>
          <dt>Due</dt>
          <dd className={overdue ? "task-due overdue" : undefined}>
            {task.dueDate ? `${formatShortDate(task.dueDate)}${overdue ? " · Overdue" : ""}` : "No due date"}
          </dd>
          <dt>Assignee</dt>
          <dd>{task.assigneeId ? <PersonAvatar users={users} id={task.assigneeId} /> : "No one yet"}</dd>
          <dt>Created by</dt>
          <dd>
            <PersonAvatar users={users} id={task.createdBy} />
          </dd>
        </dl>
        {task.notes && <p className="event-notes">{task.notes}</p>}
      </aside>
    </div>
  )
}

function TaskEditor({
  task,
  leaders,
  selfId,
  onClose,
  onSaved,
}: {
  task: DeskTask | null
  leaders: RegisteredUser[]
  selfId: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [title, setTitle] = useState(task?.title ?? "")
  const [notes, setNotes] = useState(task?.notes ?? "")
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "todo")
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "normal")
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId ?? "")
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "")

  return (
    <DeskModal
      title={task ? "Edit task" : "New task"}
      onClose={onClose}
      onSave={async () => {
        await saveTask({
          id: task?.id,
          title,
          notes,
          status,
          priority,
          assigneeId: assigneeId || null,
          dueDate: dueDate || null,
          createdBy: task?.createdBy ?? selfId,
        })
        await onSaved()
      }}
      onDelete={
        task
          ? async () => {
              await deleteTask(task.id)
              await onSaved()
            }
          : undefined
      }
      deleteText="Delete this task?"
    >
      <label>
        Title
        <input value={title} maxLength={120} required autoFocus onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Notes
        <textarea value={notes} rows={4} maxLength={2000} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <div className="desk-form-row">
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)}>
            {STATUSES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}>
            {PRIORITIES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="desk-form-row">
        <label>
          Assignee
          <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
            <option value="">No one</option>
            {leaders.map((leader) => (
              <option key={leader.userId} value={leader.userId}>
                {leader.displayName || "Unnamed"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Due date
          <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </label>
      </div>
    </DeskModal>
  )
}

// Schedule -------------------------------------------------------------------

// "09:00 GMT+9" when the event was set in a zone whose clock differs from the viewer's, else null.
function originalTime(event: DeskEvent, startsAt: string) {
  const at = new Date(startsAt)
  const theirs = zoneAbbreviation(event.timeZone, at)
  if (theirs === zoneAbbreviation(localTimeZone(), at)) return null
  return `${instantToZoned(at, event.timeZone).time} ${theirs}`
}

// Today's appearance of a daily event, as exact moments, for showing it in the viewer's zone.
function todayOf(event: DeskEvent): Occurrence | null {
  if (!event.startTime || !event.endTime) return null
  const day = instantToZoned(new Date(), event.timeZone).date
  const start = zonedToInstant(day, event.startTime, event.timeZone)
  const end = zonedToInstant(event.endTime <= event.startTime ? addDays(day, 1) : day, event.endTime, event.timeZone)
  return { event, startsAt: start.toISOString(), endsAt: end.toISOString() }
}

function nameOf(users: RegisteredUser[], id: string | null) {
  if (!id) return "Someone"
  return users.find((user) => user.userId === id)?.displayName || "Former member"
}

type ScheduleView = "daily" | "upcoming" | "all"

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

function Schedule({
  events,
  users,
  newEventIds,
  onSelect,
  onEdit,
}: {
  events: DeskEvent[]
  users: RegisteredUser[]
  newEventIds: Set<string>
  onSelect: (event: DeskEvent) => void
  onEdit: (event: DeskEvent) => void
}) {
  const [view, setView] = useState<ScheduleView>("daily")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const now = Date.now()

  function switchView(next: ScheduleView) {
    setView(next)
    setSelectedId(null)
  }
  // Looked up by id so the panel follows edits and disappears if the event is deleted.
  const selected = events.find((event) => event.id === selectedId) ?? null

  const daily = events
    .filter((event) => event.repeat === "daily")
    .map(todayOf)
    .filter((item): item is Occurrence => item !== null)
    // Order by time of day on the viewer's clock.
    .sort((a, b) => formatClock(a.startsAt).localeCompare(formatClock(b.startsAt)))

  const oneOff = events
    .filter((event) => event.repeat !== "daily" && event.startsAt && event.endsAt)
    .filter((event) => view === "all" || new Date(event.endsAt!).getTime() >= now)
    .map((event) => ({ event, startsAt: event.startsAt!, endsAt: event.endsAt! }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const days = new Map<string, Occurrence[]>()
  for (const item of oneOff) {
    const key = localDate(new Date(item.startsAt))
    days.set(key, [...(days.get(key) ?? []), item])
  }

  const item = ({ event, startsAt, endsAt }: Occurrence, past: boolean) => {
    const original = originalTime(event, startsAt)
    const participants = event.participantIds.map((id) => nameOf(users, id))
    const classes = [
      "schedule-item",
      past ? "past" : "",
      newEventIds.has(event.id) ? "new" : "",
      event.id === selectedId ? "selected" : "",
    ]
    return (
      <button
        key={`${event.id}:${startsAt}`}
        type="button"
        className={classes.filter(Boolean).join(" ")}
        aria-current={event.id === selectedId ? "true" : undefined}
        onClick={() => {
          setSelectedId(event.id)
          onSelect(event)
        }}
      >
        <span className="schedule-time">
          {formatTime(startsAt)}
          <span>{formatTime(endsAt)}</span>
        </span>
        <span className="schedule-text">
          <strong>
            {event.title}
            {newEventIds.has(event.id) && <span className="new-tag">New</span>}
            {event.visibility === "participants" && <span className="task-tag schedule-repeat">Participants only</span>}
          </strong>
          {event.location && <span>{event.location}</span>}
          {original && <span className="schedule-zone">Set for {original}</span>}
          <span className="schedule-people">
            By {nameOf(users, event.createdBy)}
            {participants.length > 0 && ` · With ${participants.join(", ")}`}
          </span>
          {event.notes && <span className="schedule-notes">{event.notes}</span>}
        </span>
        {event.locked && (
          <span className="schedule-lock" title="Locked by an admin" aria-label="Locked">
            <LockIcon />
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="desk-body schedule-body">
      <div className="desk-toolbar">
        <div className="desk-segmented" role="group" aria-label="Show events">
          <button type="button" aria-pressed={view === "daily"} onClick={() => switchView("daily")}>
            Daily
          </button>
          <button type="button" aria-pressed={view === "upcoming"} onClick={() => switchView("upcoming")}>
            Upcoming
          </button>
          <button type="button" aria-pressed={view === "all"} onClick={() => switchView("all")}>
            All
          </button>
        </div>
        <span className="desk-zone">
          Times in your time zone, {localTimeZone()} ({zoneAbbreviation(localTimeZone())})
        </span>
      </div>
      <div className="schedule-split">
        <div className="schedule-list">
          {view === "daily" ? (
            daily.length === 0 ? (
              <p className="hint">No daily events yet. Admins can set an event to repeat every day.</p>
            ) : (
              <section className="schedule-day">
                <h2>Every day</h2>
                {daily.map((occurrence) => item(occurrence, false))}
              </section>
            )
          ) : days.size === 0 ? (
            <p className="hint">{view === "all" ? "No one-off events yet." : "Nothing coming up."}</p>
          ) : (
            [...days.entries()].map(([day, items]) => (
              <section key={day} className="schedule-day">
                <h2 className={day < todayKey() ? "past" : undefined}>{formatDay(day)}</h2>
                {items.map((occurrence) => item(occurrence, new Date(occurrence.endsAt).getTime() < now))}
              </section>
            ))
          )}
        </div>
        {selected ? (
          <EventDetail event={selected} users={users} onEdit={() => onEdit(selected)} onClose={() => setSelectedId(null)} />
        ) : (
          <aside className="event-detail empty">
            <p className="hint">Select an event to see its details.</p>
          </aside>
        )}
      </div>
    </div>
  )
}

// A round avatar whose name shows on hover.
function PersonAvatar({ users, id }: { users: RegisteredUser[]; id: string | null }) {
  const user = id ? users.find((item) => item.userId === id) : undefined
  const name = nameOf(users, id)
  return (
    <span className="avatar event-avatar" title={name} aria-label={name} role="img">
      {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span>{initials(name)}</span>}
    </span>
  )
}

function EventDetail({
  event,
  users,
  onEdit,
  onClose,
}: {
  event: DeskEvent
  users: RegisteredUser[]
  onEdit: () => void
  onClose: () => void
}) {
  const occurrence =
    event.repeat === "daily"
      ? todayOf(event)
      : event.startsAt && event.endsAt
        ? { event, startsAt: event.startsAt, endsAt: event.endsAt }
        : null
  const original = occurrence ? originalTime(event, occurrence.startsAt) : null

  return (
    <aside className="event-detail" aria-label="Event details">
      <div className="event-detail-head">
        <h2>{event.title}</h2>
        {event.locked && (
          <span className="schedule-lock" title="Locked by an admin" aria-label="Locked">
            <LockIcon />
          </span>
        )}
        {!event.locked && (
          <button type="button" className="event-detail-icon" aria-label="Edit event" title="Edit" onClick={onEdit}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13" />
              <path d="M17.6 3.9a2 2 0 0 1 2.8 2.8L12.5 14.6 9 15.5l.9-3.5 7.7-8.1z" />
            </svg>
          </button>
        )}
        <button type="button" className="event-detail-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <dl className="event-facts">
        <dt>When</dt>
        <dd>
          {occurrence ? (
            <>
              {event.repeat !== "daily" && `${formatDay(localDate(new Date(occurrence.startsAt)))}, `}
              {formatTime(occurrence.startsAt)} – {formatTime(occurrence.endsAt)}
              <span className="event-fact-note">
                {original ? `Set for ${original} · ${event.timeZone}` : event.timeZone}
              </span>
            </>
          ) : (
            "—"
          )}
        </dd>
        {event.location && (
          <>
            <dt>Location</dt>
            <dd>{event.location}</dd>
          </>
        )}
        <dt>Participants</dt>
        <dd>
          {event.participantIds.length > 0 ? (
            <span className="event-avatars">
              {event.participantIds.map((id) => (
                <PersonAvatar key={id} users={users} id={id} />
              ))}
            </span>
          ) : (
            "No one yet"
          )}
        </dd>
        <dt>Created by</dt>
        <dd>
          <PersonAvatar users={users} id={event.createdBy} />
        </dd>
      </dl>
      {event.notes && <p className="event-notes">{event.notes}</p>}
    </aside>
  )
}

function EventEditor({
  event,
  users,
  leaders,
  selfId,
  onClose,
  onSaved,
}: {
  event: DeskEvent | null
  users: RegisteredUser[]
  leaders: RegisteredUser[]
  selfId: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const daily = event?.repeat === "daily"
  const [zone, setZone] = useState(event?.timeZone ?? localTimeZone())
  const start = event?.startsAt ? instantToZoned(event.startsAt, zone) : null
  const end = event?.endsAt ? instantToZoned(event.endsAt, zone) : null
  const [title, setTitle] = useState(event?.title ?? "")
  const [date, setDate] = useState(start?.date ?? todayKey())
  const [startTime, setStartTime] = useState(event?.startTime ?? start?.time ?? "09:00")
  const [endTime, setEndTime] = useState(event?.endTime ?? end?.time ?? "10:00")
  const [location, setLocation] = useState(event?.location ?? "")
  const [notes, setNotes] = useState(event?.notes ?? "")
  const [participantIds, setParticipantIds] = useState<string[]>(event?.participantIds ?? [])
  const [visibility, setVisibility] = useState<EventVisibility>(event?.visibility ?? "leaders")
  // Leaders who later lost the role stay listed so they are not silently removed.
  const choices = [
    ...leaders,
    ...users.filter((user) => participantIds.includes(user.userId) && !leaders.includes(user)),
  ]

  return (
    <DeskModal
      title={event ? "Edit event" : "New event"}
      onClose={onClose}
      onSave={async () => {
        // An end time earlier than the start means the event runs past midnight.
        const endDate = endTime <= startTime ? addDays(date, 1) : date
        await saveEvent({
          id: event?.id,
          title,
          location,
          notes,
          repeat: daily ? "daily" : "none",
          timeZone: zone,
          startsAt: daily ? null : zonedToInstant(date, startTime, zone).toISOString(),
          endsAt: daily ? null : zonedToInstant(endDate, endTime, zone).toISOString(),
          startTime: daily ? startTime : null,
          endTime: daily ? endTime : null,
          createdBy: event?.createdBy ?? selfId,
          participantIds,
          visibility,
          locked: event?.locked ?? false,
        })
        await onSaved()
      }}
      onDelete={
        event
          ? async () => {
              await deleteEvent(event.id)
              await onSaved()
            }
          : undefined
      }
      deleteText="Delete this event?"
    >
      <label>
        Title
        <input value={title} maxLength={120} required autoFocus onChange={(change) => setTitle(change.target.value)} />
      </label>
      <p className="hint">
        Created by {event ? nameOf(users, event.createdBy) : "you"}
        {daily && " · Repeats every day. Admins can change the repeat."}
      </p>
      <div className={daily ? "desk-form-row" : "desk-form-row three"}>
        {!daily && (
          <label>
            Date
            <input type="date" value={date} required onChange={(change) => setDate(change.target.value)} />
          </label>
        )}
        <label>
          Starts
          <input type="time" value={startTime} required onChange={(change) => setStartTime(change.target.value)} />
        </label>
        <label>
          Ends
          <input type="time" value={endTime} required onChange={(change) => setEndTime(change.target.value)} />
        </label>
      </div>
      <label>
        Time zone
        <select value={zone} onChange={(change) => setZone(change.target.value)}>
          {timeZoneOptions(zone).map((item) => (
            <option key={item} value={item}>
              {item} ({zoneAbbreviation(item)})
              {item === localTimeZone() ? " · yours" : ""}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="desk-people">
        <legend>Participants</legend>
        {choices.length === 0 ? (
          <p className="hint">No Leadership members yet.</p>
        ) : (
          choices.map((user) => (
            <label key={user.userId} className="desk-check">
              <input
                type="checkbox"
                checked={participantIds.includes(user.userId)}
                onChange={(change) =>
                  setParticipantIds((current) =>
                    change.target.checked ? [...current, user.userId] : current.filter((id) => id !== user.userId),
                  )
                }
              />
              {user.displayName || "Unnamed"}
              {user.userId === selfId && <span className="hint"> (you)</span>}
            </label>
          ))
        )}
      </fieldset>
      <label>
        Who can see it
        <select value={visibility} onChange={(change) => setVisibility(change.target.value as EventVisibility)}>
          <option value="leaders">All leaders</option>
          <option value="participants">Only participants and the creator</option>
        </select>
      </label>
      <label>
        Location or link
        <input value={location} maxLength={120} onChange={(change) => setLocation(change.target.value)} />
      </label>
      <label>
        Notes
        <textarea value={notes} rows={3} maxLength={2000} onChange={(change) => setNotes(change.target.value)} />
      </label>
    </DeskModal>
  )
}

// Notes ----------------------------------------------------------------------

function Notes({ notes, onOpen }: { notes: DeskNote[]; onOpen: (note: DeskNote) => void }) {
  if (notes.length === 0) {
    return (
      <div className="desk-body">
        <p className="hint">No notes yet. Use notes for decisions, plans and anything the leadership team should keep.</p>
      </div>
    )
  }
  return (
    <div className="desk-body note-grid">
      {notes.map((note) => (
        <button key={note.id} type="button" className="note-card" onClick={() => onOpen(note)}>
          <span className="note-head">
            <strong>{note.title}</strong>
            {note.pinned && <span className="task-tag high">Pinned</span>}
          </span>
          {note.body && <span className="note-body">{note.body}</span>}
          <span className="note-date">
            Updated {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(note.updatedAt))}
          </span>
        </button>
      ))}
    </div>
  )
}

function NoteEditor({
  note,
  onClose,
  onSaved,
}: {
  note: DeskNote | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [title, setTitle] = useState(note?.title ?? "")
  const [body, setBody] = useState(note?.body ?? "")
  const [pinned, setPinned] = useState(note?.pinned ?? false)

  return (
    <DeskModal
      title={note ? "Edit note" : "New note"}
      onClose={onClose}
      onSave={async () => {
        await saveNote({ id: note?.id, title, body, pinned })
        await onSaved()
      }}
      onDelete={
        note
          ? async () => {
              await deleteNote(note.id)
              await onSaved()
            }
          : undefined
      }
      deleteText="Delete this note?"
    >
      <label>
        Title
        <input value={title} maxLength={120} required autoFocus onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Note
        <textarea value={body} rows={10} maxLength={5000} onChange={(event) => setBody(event.target.value)} />
      </label>
      <label className="desk-check">
        <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
        Pin to the top
      </label>
    </DeskModal>
  )
}

// Shared pop-up editor ---------------------------------------------------------

function DeskModal({
  title,
  children,
  onClose,
  onSave,
  onDelete,
  deleteText,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  onSave: () => Promise<void>
  onDelete?: () => Promise<void>
  deleteText: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError("")
    try {
      await action()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work.")
      setBusy(false)
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void run(onSave)
  }

  return (
    <div className="desk-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="desk-modal" role="dialog" aria-label={title} onSubmit={onSubmit}>
        <h2>{title}</h2>
        {children}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          {onDelete && (
            <button
              type="button"
              className="button danger desk-delete"
              disabled={busy}
              onClick={() => {
                if (window.confirm(deleteText)) void run(onDelete)
              }}
            >
              Delete
            </button>
          )}
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  )
}
