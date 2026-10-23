import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { useAuth } from "../auth"
import {
  LEADERSHIP,
  deleteEvent,
  deleteNote,
  deleteTask,
  listEvents,
  listNotes,
  listTasks,
  readCanAddTasks,
  saveEvent,
  saveAssigneeNotes,
  saveNote,
  saveTask,
  signTask,
  taskDeadline,
  type DeskEvent,
  type DeskNote,
  type DeskTask,
  type EventVisibility,
  type Occurrence,
  type TaskPriority,
  type TaskResult,
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
  { id: "failed", label: "Failed" },
]

/** Done and failed tasks are finished; nothing more is expected of them. */
const finished = (status: TaskStatus) => status === "done" || status === "failed"

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
  // Whether an admin has let this person add new tasks.
  canAddTasks: boolean
}

// Loads everything on LeadDesk while it is open; the sidebar counts and the page share it.
export function useLeadDesk(open: boolean) {
  const { session } = useAuth()
  const userId = session?.userId ?? null
  const [data, setData] = useState<DeskData | null>(null)
  const [error, setError] = useState("")

  const reload = useCallback(async () => {
    try {
      const [tasks, events, notes, users, canAddTasks] = await Promise.all([
        listTasks(),
        listEvents(),
        listNotes(),
        listUsers(),
        userId ? readCanAddTasks(userId) : Promise.resolve(false),
      ])
      setData({ tasks, events, notes, users, leaders: users.filter((user) => user.role === LEADERSHIP), canAddTasks })
      setError("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load LeadDesk.")
    }
  }, [userId])

  useEffect(() => {
    if (open) void reload()
  }, [open, reload])

  return { data, error, reload }
}

export function leadDeskHints(data: DeskData | null, selfId: string, isAdmin: boolean): Record<LeadDeskTab, string> {
  if (!data) return { tasks: "Loading…", schedule: "Loading…", notes: "Loading…" }
  const open = visibleTasks(data.tasks, selfId, isAdmin).filter((task) => !finished(task.status)).length
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

// A moment as date and time on the viewer's clock, with the zone: "Oct 22, 10:35 AM GMT+9". Pass date
// fields (not dateStyle, which Intl won't mix with the time fields added here).
function formatMoment(value: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat(undefined, { ...options, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(
    new Date(value),
  )
}

// The zone a task's due date is counted in, as "GMT+9": its creator's, or the viewer's for older tasks.
function dueZone(task: DeskTask) {
  return zoneAbbreviation(task.timeZone ?? localTimeZone(), taskDeadline(task) ?? new Date())
}

export function LeadDesk({
  tab,
  data,
  error,
  reload,
  newEventIds,
  onEventOpened,
  newTaskIds,
  onTaskOpened,
  isAdmin,
}: {
  tab: LeadDeskTab
  data: DeskData | null
  error: string
  reload: () => Promise<void>
  // Unread events, shown as "New" on the Schedule tab until they are opened.
  newEventIds: Set<string>
  onEventOpened: (eventId: string) => void
  // Tasks assigned to this person that they have not opened yet, shown as "New".
  newTaskIds: Set<string>
  onTaskOpened: (taskId: string) => void
  // Admins skip the limits admins set for leaders: adding tasks, locked events, assignee notes.
  isAdmin: boolean
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
  // The admin-granted task permission covers adding, editing, moving and deleting tasks.
  const canEditTasks = isAdmin || Boolean(data?.canAddTasks)
  const newBlocked = tab === "tasks" && !canEditTasks

  return (
    <section className="settings">
      <header className="thread-bar profile-bar">
        <h1>{label}</h1>
        <button
          type="button"
          className="button desk-new"
          disabled={newBlocked}
          title={newBlocked && data ? "You need an admin's permission to add or edit tasks" : undefined}
          onClick={() => setEditing({ kind: tab, item: null })}
        >
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
        <TaskList
          tasks={data.tasks}
          users={data.users}
          selfId={session.userId}
          isAdmin={isAdmin}
          selectedId={selectedTask?.id ?? null}
          newTaskIds={newTaskIds}
          onSelect={(task) => {
            setSelectedTaskId(task.id)
            if (newTaskIds.has(task.id)) onTaskOpened(task.id)
          }}
        />
      ) : tab === "schedule" ? (
        <Schedule
          events={data.events}
          users={data.users}
          newEventIds={newEventIds}
          isAdmin={isAdmin}
          covered={editing !== null}
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
          selfId={session.userId}
          isAdmin={isAdmin}
          canEdit={canEditTasks}
          covered={editing !== null}
          onSaved={reload}
          onSign={(outcome) => act(() => signTask(selectedTask.id, session.userId, outcome))}
          onEdit={() => setEditing({ kind: "tasks", item: selectedTask })}
          onClose={closeTask}
        />
      )}
      {editing?.kind === "tasks" && (
        <TaskEditor
          task={editing.item as DeskTask | null}
          users={data?.users ?? []}
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

// Leaders see tasks assigned to them plus unassigned ones, not other people's. Admins see every task.
export function visibleTasks(tasks: DeskTask[], selfId: string, isAdmin: boolean) {
  if (isAdmin) return tasks
  return tasks.filter((task) => task.assigneeIds.length === 0 || task.assigneeIds.includes(selfId))
}

type TaskFilter = "all" | TaskStatus

const TASK_FILTERS: Array<{ id: TaskFilter; label: string }> = [{ id: "all", label: "All" }, ...STATUSES]

/** "Yesterday", "Today", "Tomorrow", else the weekday and date (with the year when it differs). */
function dueLabel(key: string) {
  const today = todayKey()
  if (key === today) return "Today"
  if (key === addDays(today, -1)) return "Yesterday"
  if (key === addDays(today, 1)) return "Tomorrow"
  const date = new Date(`${key}T00:00`)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  }).format(date)
}

type TaskSort = "newest" | "oldest" | "due"

const TASK_SORTS: Array<{ id: TaskSort; label: string }> = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "due", label: "Due date" },
]

// Tasks grouped by the day they were added, newest first unless another order is picked; sorted by
// due date they are grouped by due date, earliest first, then the ones with no due date. The filter
// row narrows them by status, and the calendar to the tasks due on one day.
function TaskList({
  tasks,
  users,
  selfId,
  isAdmin,
  selectedId,
  newTaskIds,
  onSelect,
}: {
  tasks: DeskTask[]
  users: RegisteredUser[]
  selfId: string
  isAdmin: boolean
  selectedId: string | null
  newTaskIds: Set<string>
  onSelect: (task: DeskTask) => void
}) {
  const [filter, setFilter] = useState<TaskFilter>("all")
  const [sort, setSort] = useState<TaskSort>("newest")
  // A due date to show only that day's tasks; empty shows every task.
  const [day, setDay] = useState("")
  const dayInput = useRef<HTMLInputElement>(null)
  // Ticks so the time left on each card counts down.
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30 * 1000)
    return () => window.clearInterval(timer)
  }, [])
  const shown = visibleTasks(tasks, selfId, isAdmin).filter((task) => !day || task.dueDate === day)
  const today = todayKey()
  const rank: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 }
  const byDue = sort === "due"
  const matching = shown
    .filter((task) => filter === "all" || task.status === filter)
    .sort((a, b) =>
      byDue
        ? (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
          rank[a.priority] - rank[b.priority] ||
          a.createdAt.localeCompare(b.createdAt)
        : sort === "newest"
          ? b.createdAt.localeCompare(a.createdAt)
          : a.createdAt.localeCompare(b.createdAt),
    )
  const groups: Array<{ key: string; label: string; tasks: DeskTask[] }> = []
  for (const task of matching) {
    const key = byDue ? (task.dueDate ?? "none") : localDate(new Date(task.createdAt))
    const label = byDue ? (task.dueDate ? dueLabel(task.dueDate) : "No due date") : dueLabel(key)
    const last = groups[groups.length - 1]
    if (last?.key === key) last.tasks.push(task)
    else groups.push({ key, label, tasks: [task] })
  }

  function pickDay() {
    const input = dayInput.current
    if (!input) return
    try {
      input.showPicker()
    } catch {
      input.focus()
    }
  }

  return (
    <div className="desk-body">
      <div className="task-toolbar">
        <label className="task-sort" title="Sort tasks">
          <svg className="fact-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 4.5v15M3.5 16l3.5 3.5 3.5-3.5M17 19.5v-15M13.5 8L17 4.5 20.5 8" />
          </svg>
          <select value={sort} aria-label="Sort tasks" onChange={(change) => setSort(change.target.value as TaskSort)}>
            {TASK_SORTS.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <span className={day ? "task-day picked" : "task-day"}>
          <button
            type="button"
            className="task-day-button"
            title="Show the tasks due on one day"
            aria-label={day ? `Due ${formatShortDate(day)}. Pick another day` : "Pick a day"}
            onClick={pickDay}
          >
            <FactIcon kind="due" />
            {day ? `Due ${dueLabel(day)}` : "All dates"}
          </button>
          <input
            ref={dayInput}
            type="date"
            value={day}
            tabIndex={-1}
            aria-hidden="true"
            onChange={(change) => setDay(change.target.value)}
          />
          {day && (
            <button type="button" className="task-day-clear" aria-label="Show all dates" title="Show all dates" onClick={() => setDay("")}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 7l10 10M17 7L7 17" />
              </svg>
            </button>
          )}
        </span>
      </div>
      <div className="task-filters" role="tablist" aria-label="Show tasks">
        {TASK_FILTERS.map(({ id, label }) => {
          const count = id === "all" ? shown.length : shown.filter((task) => task.status === id).length
          return (
            <button
              key={id}
              type="button"
              role="tab"
              className="task-filter"
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
            >
              {id === "all" ? <BoardIcon /> : <StatusIcon status={id} />}
              {label}
              <span>{count}</span>
            </button>
          )
        })}
      </div>
      {groups.length === 0 ? (
        <p className="task-empty">
          {day ? `No tasks due ${dueLabel(day)}.` : filter === "all" ? "No tasks yet." : "No tasks here."}
        </p>
      ) : (
        groups.map((group) => {
          // Only due dates go past; the day a task was added always has.
          const past = byDue && group.key !== "none" && group.key < today
          return (
            <section key={group.key} className="task-group">
              <h2 className={past && group.key !== addDays(today, -1) ? "task-group-head past" : "task-group-head"}>
                {group.label}
                <span>{group.tasks.length}</span>
              </h2>
              <div className="task-cards">
                {group.tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    users={users}
                    now={now}
                    selected={task.id === selectedId}
                    isNew={newTaskIds.has(task.id)}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}

// One task on the list: priority, title and description, how many assignees have signed it done,
// the due date, then the people and the status.
function TaskCard({
  task,
  users,
  now,
  selected,
  isNew,
  onSelect,
}: {
  task: DeskTask
  users: RegisteredUser[]
  now: number
  selected: boolean
  isNew: boolean
  onSelect: (task: DeskTask) => void
}) {
  const status = STATUSES.find((item) => item.id === task.status)?.label ?? task.status
  const priority = PRIORITIES.find((item) => item.id === task.priority)?.label ?? task.priority
  const total = task.assigneeIds.length
  const done = task.assigneeIds.filter((id) => task.signoffs[id]?.result === "done").length
  const due = task.dueDate ? `${formatShortDate(task.dueDate)} ${dueZone(task)}` : null
  // Due by the end of the due date on the creator's clock.
  const deadline = taskDeadline(task)
  const overdue = !finished(task.status) && deadline !== null && deadline.getTime() <= now
  let left: string | null = null
  if (deadline && !finished(task.status)) {
    const minutes = Math.floor((deadline.getTime() - now) / 60000)
    if (minutes >= 0) left = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`
  }

  return (
    <button
      type="button"
      className={`task-card${selected ? " selected" : ""}${isNew ? " new" : ""}`}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(task)}
    >
      <span className="task-card-text">
        <span className="task-card-title">
          <strong>{task.title}</strong>
          {isNew && <span className="new-tag">New</span>}
        </span>
        {task.notes && <span className="task-notes">{task.notes}</span>}
      </span>
      {total > 0 && (
        <span className={`task-progress ${task.status}`}>
          <span className="task-progress-head">
            <StatusIcon status={task.status} solid />
            Progress
            <span>
              <b>{done}</b>/{total}
            </span>
          </span>
          <span className={done === 0 ? "task-progress-bar empty" : "task-progress-bar"}>
            <span style={{ width: `${(done / total) * 100}%` }} />
          </span>
        </span>
      )}
      <span className="task-due-row">
        <span className={overdue ? "task-due-chip overdue" : "task-due-chip"}>
          <FactIcon kind="due" />
          {due ? (
            <>
              {overdue ? "Overdue:" : "Due to:"} <b>{due}</b>
            </>
          ) : (
            "No due date"
          )}
        </span>
        {left && (
          <span className="task-left" title="Hours and minutes left until the end of the due date">
            <ClockIcon />
            {left}
          </span>
        )}
      </span>
      <span className="task-card-foot">
        <span className="task-assignee">
          {task.assigneeIds.map((id) => (
            <PersonAvatar key={id} users={users} id={id} />
          ))}
        </span>
        <span className="task-card-badges">
          <span className={`task-flag ${task.priority}`}>
            <FactIcon kind="priority" />
            {priority}
          </span>
          <span className={`task-badge ${task.status}`}>
            <StatusIcon status={task.status} />
            {status}
          </span>
        </span>
      </span>
    </button>
  )
}

// One icon per status: an hourglass while it's still to do, a checklist while it's in progress, and a
// tick or cross once it's finished. Solid fills the finished ones' circle, as beside a card's progress.
function StatusIcon({ status, solid = false }: { status: TaskStatus; solid?: boolean }) {
  if (status === "done" || status === "failed") {
    return (
      <svg className={solid ? "status-icon solid" : "status-icon"} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r={solid ? 10 : 9} />
        <path d={status === "done" ? "M7.5 12.3l3 3 6-6.3" : "M8.5 8.5l7 7M15.5 8.5l-7 7"} />
      </svg>
    )
  }
  if (status === "todo") {
    return (
      <svg className="status-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.5 3.5h11M6.5 20.5h11" />
        <path d="M8 3.5v2.5a4 4 0 0 0 2 3.5l2 1.5 2-1.5a4 4 0 0 0 2-3.5V3.5M8 20.5V18a4 4 0 0 1 2-3.5l2-1.5 2 1.5a4 4 0 0 1 2 3.5v2.5" />
        <path d="M9.5 19.5h5l-2.5-2z" className="fill" />
      </svg>
    )
  }
  return (
    <svg className="status-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6.5l1.5 1.5L8.5 5M4 12.5l1.5 1.5 3-3M4 18.5l1.5 1.5 3-3" />
      <path d="M11.5 6.5H20M11.5 12.5H20M11.5 18.5H20" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg className="fact-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  )
}

// Two tall and two short panels, for the "All" filter.
function BoardIcon() {
  return (
    <svg className="status-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="6.5" height="16" rx="2" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2" />
    </svg>
  )
}

// Small line icons for the labels in the task panel.
function FactIcon({
  kind,
}: {
  kind: "status" | "priority" | "due" | "assignees" | "creator" | "description" | "location" | "visibility" | "zone"
}) {
  return (
    <svg className="fact-icon" viewBox="0 0 24 24" aria-hidden="true">
      {kind === "location" && (
        <>
          <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
          <circle cx="12" cy="10" r="2.4" />
        </>
      )}
      {kind === "visibility" && (
        <>
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
          <circle cx="12" cy="12" r="2.8" />
        </>
      )}
      {kind === "zone" && (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5z" />
        </>
      )}
      {kind === "description" && (
        <>
          <rect x="5" y="3.5" width="14" height="17" rx="2" />
          <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
        </>
      )}
      {kind === "status" && (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M8.5 12.2l2.4 2.4 4.6-4.8" />
        </>
      )}
      {kind === "priority" && (
        <>
          <path d="M6 20.5v-16" />
          <path d="M6 4.5h11l-2.5 4 2.5 4H6" />
        </>
      )}
      {kind === "due" && (
        <>
          <rect x="4" y="5.5" width="16" height="15" rx="2" />
          <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
        </>
      )}
      {kind === "assignees" && (
        <>
          <circle cx="9" cy="8.5" r="3.2" />
          <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
          <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.5a5.5 5.5 0 0 1 3 5" />
        </>
      )}
      {kind === "creator" && (
        <>
          <path d="M4 20h4.5L19 9.5a2.1 2.1 0 0 0-3-3L5.5 17 4 20z" />
          <path d="M14.5 8l3 3" />
        </>
      )}
    </svg>
  )
}

// Task details in a panel that slides in from the right over the board.
function TaskDrawer({
  task,
  users,
  selfId,
  isAdmin,
  canEdit,
  covered,
  onEdit,
  onSign,
  onClose,
  onSaved,
}: {
  task: DeskTask
  users: RegisteredUser[]
  selfId: string
  isAdmin: boolean
  // Changing the task needs an admin's permission; assignees can still sign and write notes.
  canEdit: boolean
  // True while the editor is open on top, so Esc closes only the editor.
  covered: boolean
  onEdit: () => void
  onSign: (outcome: TaskResult | null) => Promise<void>
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  useEffect(() => {
    if (covered) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [covered, onClose])

  const [tab, setTab] = useState<"results" | "notes">("results")
  const deadline = taskDeadline(task)
  const overdue = !finished(task.status) && deadline !== null && deadline.getTime() <= Date.now()
  const status = STATUSES.find((item) => item.id === task.status)?.label ?? task.status
  const priority = PRIORITIES.find((item) => item.id === task.priority)?.label ?? task.priority
  const created = new Date(task.createdAt)
  // Results only exist once someone is assigned.
  const shownTab = task.assigneeIds.length > 0 ? tab : "notes"

  return (
    <div className="drawer-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="event-detail drawer task-drawer" role="dialog" aria-label="Task details">
        <div className="task-drawer-bar">
          <button type="button" className="event-detail-icon" aria-label="Close" title="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <h2>{task.title}</h2>
          {canEdit && (
            <button type="button" className="event-detail-icon" aria-label="Edit task" title="Edit" onClick={onEdit}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M11 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13" />
                <path d="M17.6 3.9a2 2 0 0 1 2.8 2.8L12.5 14.6 9 15.5l.9-3.5 7.7-8.1z" />
              </svg>
            </button>
          )}
        </div>
        <div className="task-drawer-main">
          <dl className="task-facts">
            <dt>
              <ClockIcon />
              Created time
            </dt>
            <dd>
              {new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(created)}
              <span className="task-fact-muted">
                {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(
                  created,
                )}
              </span>
            </dd>
            <dt>
              <FactIcon kind="creator" />
              Created by
            </dt>
            <dd className="task-fact-person">
              <PersonAvatar users={users} id={task.createdBy} />
              {nameOf(users, task.createdBy)}
            </dd>
            <dt>
              <FactIcon kind="status" />
              Status
            </dt>
            <dd>
              <span className={`task-badge ${task.status}`}>
                <StatusIcon status={task.status} />
                {status}
              </span>
            </dd>
            <dt>
              <FactIcon kind="priority" />
              Priority
            </dt>
            <dd>
              <span className={`task-flag ${task.priority}`}>
                <FactIcon kind="priority" />
                {priority}
              </span>
            </dd>
            <dt>
              <FactIcon kind="due" />
              Due date
            </dt>
            <dd className={overdue ? "task-due overdue" : undefined}>
              {task.dueDate ? (
                <>
                  {new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(
                    new Date(`${task.dueDate}T00:00`),
                  )}
                  <span className="task-fact-muted">{dueZone(task)}</span>
                  {overdue && " · Overdue"}
                </>
              ) : (
                "No due date"
              )}
            </dd>
            <dt>
              <FactIcon kind="assignees" />
              {task.assigneeIds.length > 1 ? "Assignees" : "Assignee"}
            </dt>
            <dd>
              {task.assigneeIds.length > 0 ? (
                <span className="task-assignee">
                  {task.assigneeIds.map((id) => (
                    <PersonAvatar key={id} users={users} id={id} />
                  ))}
                </span>
              ) : (
                "No one yet"
              )}
            </dd>
          </dl>
          <div className="task-drawer-description">
            <h3>
              <FactIcon kind="description" />
              Description
            </h3>
            {task.notes ? <p>{task.notes}</p> : <p className="empty">No description.</p>}
          </div>
        </div>
        <div className="task-drawer-tabs" role="tablist" aria-label="Task activity">
          {task.assigneeIds.length > 0 && (
            <button type="button" role="tab" aria-selected={shownTab === "results"} onClick={() => setTab("results")}>
              Results
            </button>
          )}
          <button type="button" role="tab" aria-selected={shownTab === "notes"} onClick={() => setTab("notes")}>
            Notes from assignee
          </button>
        </div>
        <div className="task-drawer-panel" role="tabpanel">
          {shownTab === "results" ? (
            <TaskResults task={task} users={users} selfId={selfId} onSign={onSign} />
          ) : (
            <AssigneeNotes key={task.id} task={task} canWrite={task.assigneeIds.includes(selfId) || isAdmin} onSaved={onSaved} />
          )}
        </div>
      </aside>
    </div>
  )
}

// Each assignee's result. An assignee signs their own as done or failed, and can take it back.
function TaskResults({
  task,
  users,
  selfId,
  onSign,
}: {
  task: DeskTask
  users: RegisteredUser[]
  selfId: string
  onSign: (outcome: TaskResult | null) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const mine = task.signoffs[selfId]?.result ?? null
  const assigned = task.assigneeIds.includes(selfId)

  async function sign(outcome: TaskResult | null) {
    setBusy(true)
    try {
      await onSign(outcome)
    } finally {
      setBusy(false)
    }
  }

  // Newest results first, then the people who haven't signed yet.
  const people = [...task.assigneeIds].sort((a, b) =>
    (task.signoffs[b]?.signedAt ?? "").localeCompare(task.signoffs[a]?.signedAt ?? ""),
  )

  return (
    <div className="task-section">
      <ul className="task-activity">
        {people.map((id) => {
          const signoff = task.signoffs[id]
          const name = id === selfId ? "You" : nameOf(users, id)
          return (
            <li key={id} className={signoff ? undefined : "pending"}>
              <PersonAvatar users={users} id={id} />
              <span className="task-activity-text">
                {signoff ? (
                  <span>
                    <b>{name}</b> marked it{" "}
                    <span className={`task-badge ${signoff.result}`}>
                      <StatusIcon status={signoff.result} />
                      {signoff.result === "done" ? "Done" : "Failed"}
                    </span>
                  </span>
                ) : (
                  <span>
                    <b>{name}</b> {id === selfId ? "haven't" : "hasn't"} signed yet
                  </span>
                )}
                {signoff && (
                  <time dateTime={signoff.signedAt}>{formatMoment(signoff.signedAt)}</time>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      {assigned && (
        <div className="task-section-actions">
          {mine ? (
            <button type="button" className="button secondary" disabled={busy} onClick={() => void sign(null)}>
              Take back my result
            </button>
          ) : (
            <>
              <button type="button" className="button secondary task-fail" disabled={busy} onClick={() => void sign("failed")}>
                Mark failed
              </button>
              <button type="button" className="button" disabled={busy} onClick={() => void sign("done")}>
                Mark done
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Assignees (or an admin) write about the result here; everyone else only reads it.
function AssigneeNotes({
  task,
  canWrite,
  onSaved,
}: {
  task: DeskTask
  canWrite: boolean
  onSaved: () => Promise<void>
}) {
  // null until an assignee starts typing, so saved changes from elsewhere still show.
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const value = draft ?? task.assigneeNotes

  async function save() {
    if (draft === null) return
    setSaving(true)
    setError("")
    try {
      await saveAssigneeNotes(task.id, draft)
      await onSaved()
      setDraft(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your notes.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="task-section">
      {canWrite ? (
        <>
          <textarea
            value={value}
            rows={5}
            maxLength={2000}
            placeholder="How did it go? Add results, links or anything the team should know."
            aria-label="Notes from assignee"
            onChange={(event) => setDraft(event.target.value)}
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="task-section-actions">
            {draft !== null && (
              <button type="button" className="button secondary" disabled={saving} onClick={() => setDraft(null)}>
                Cancel
              </button>
            )}
            <button
              type="button"
              className="button"
              disabled={saving || draft === null || draft.trim() === task.assigneeNotes}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save notes"}
            </button>
          </div>
        </>
      ) : task.assigneeNotes ? (
        <p className="event-notes">{task.assigneeNotes}</p>
      ) : (
        <p className="hint">
          {task.assigneeIds.length > 0 ? "No notes from the assignees yet." : "Assign someone to get their notes."}
        </p>
      )}
    </div>
  )
}

function TaskEditor({
  task,
  users,
  leaders,
  selfId,
  onClose,
  onSaved,
}: {
  task: DeskTask | null
  users: RegisteredUser[]
  leaders: RegisteredUser[]
  selfId: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [title, setTitle] = useState(task?.title ?? "")
  const [notes, setNotes] = useState(task?.notes ?? "")
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "normal")
  const [assigneeIds, setAssigneeIds] = useState<string[]>(task?.assigneeIds ?? [])
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
          // Status is set from the admin website (or by assignees signing), not here.
          status: task?.status ?? "todo",
          priority,
          assigneeIds,
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
      className="task-form"
    >
      <div className="task-form-card">
        <label>
          Task name
          <input value={title} maxLength={120} required autoFocus onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          Description
          <textarea value={notes} rows={3} maxLength={2000} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <label>
          {/* Counted in the creator's zone: this person's for a new task, the original creator's when editing. */}
          Due date ({zoneAbbreviation(task?.timeZone ?? localTimeZone())})
          <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </label>
        <fieldset className="task-form-priority">
          <legend>Priority</legend>
          {PRIORITIES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id}
              aria-pressed={priority === item.id}
              onClick={() => setPriority(item.id)}
            >
              {item.label}
            </button>
          ))}
        </fieldset>
      </div>
      <PeoplePicker
        legend="Assign to"
        addLabel="Add assignee"
        ids={assigneeIds}
        onChange={setAssigneeIds}
        users={users}
        leaders={leaders}
        selfId={selfId}
      />
    </DeskModal>
  )
}

// The people on a task or event as a row of avatars (click one to remove it), then a "+" that opens
// a list of the leaders not on it yet. People who later lost the role stay until removed.
function PeoplePicker({
  legend,
  addLabel,
  ids,
  onChange,
  users,
  leaders,
  selfId,
}: {
  legend: string
  addLabel: string
  ids: string[]
  onChange: (update: (current: string[]) => string[]) => void
  users: RegisteredUser[]
  leaders: RegisteredUser[]
  selfId: string
}) {
  // True while the list of people to add is open under the avatars.
  const [picking, setPicking] = useState(false)
  const addable = leaders.filter((user) => !ids.includes(user.userId))

  return (
    <fieldset className="task-form-card task-form-people">
      <legend>{legend}</legend>
      <div className="task-form-avatars">
        {ids.map((id) => {
          const name = id === selfId ? "you" : nameOf(users, id)
          return (
            <button
              key={id}
              type="button"
              className="task-form-avatar"
              aria-label={`Remove ${name}`}
              title={`Remove ${name}`}
              onClick={() => onChange((current) => current.filter((item) => item !== id))}
            >
              <PersonAvatar users={users} id={id} />
              <svg className="task-form-remove" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" />
              </svg>
            </button>
          )
        })}
        {addable.length > 0 && (
          <button
            type="button"
            className="task-form-add"
            aria-label={picking ? "Close the list" : addLabel}
            title={picking ? "Close the list" : addLabel}
            aria-expanded={picking}
            onClick={() => setPicking((open) => !open)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>
      {ids.length === 0 && addable.length === 0 && <p className="hint">No Leadership members yet.</p>}
      {picking && addable.length > 0 && (
        <ul className="task-form-picker">
          {addable.map((user) => (
            <li key={user.userId}>
              <button
                type="button"
                onClick={() => {
                  onChange((current) => [...current, user.userId])
                  if (addable.length === 1) setPicking(false)
                }}
              >
                <PersonAvatar users={users} id={user.userId} />
                {user.displayName || "Unnamed"}
                {user.userId === selfId && <span className="hint">(you)</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
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
  isAdmin,
  covered,
  onSelect,
  onEdit,
}: {
  events: DeskEvent[]
  users: RegisteredUser[]
  newEventIds: Set<string>
  isAdmin: boolean
  // True while the editor is open over the event panel.
  covered: boolean
  onSelect: (event: DeskEvent) => void
  onEdit: (event: DeskEvent) => void
}) {
  const [view, setView] = useState<ScheduleView>("daily")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const closeEvent = useCallback(() => setSelectedId(null), [])
  // Ticks so an event that ends while the page is open shows as past without a reload.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30 * 1000)
    return () => window.clearInterval(timer)
  }, [])

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

  // A card per event: a status ring, the title and description, a date tile on the right, then the
  // time, status and people along the bottom.
  const item = ({ event, startsAt, endsAt }: Occurrence, past: boolean) => {
    const original = originalTime(event, startsAt)
    const isNew = newEventIds.has(event.id)
    const state = past ? "ended" : new Date(startsAt).getTime() <= now ? "ongoing" : "upcoming"
    const stateLabel = state === "ended" ? "Ended" : state === "ongoing" ? "Ongoing" : "Not started"
    const start = new Date(startsAt)
    const description = [event.notes, event.location].filter(Boolean).join(" · ")
    const classes = [
      "schedule-item",
      "event-card",
      past ? "past" : "",
      isNew ? "new" : "",
      event.id === selectedId ? "selected" : "",
    ]
    return (
      <div key={`${event.id}:${startsAt}`} className={classes.filter(Boolean).join(" ")}>
        <button
          type="button"
          className="event-card-main"
          aria-current={event.id === selectedId ? "true" : undefined}
          onClick={() => {
            setSelectedId(event.id)
            onSelect(event)
          }}
        >
          <span className={`event-card-ring ${state}`} aria-hidden="true" />
          <span className="event-card-text">
            <strong>
              {event.title}
              {isNew && <span className="new-tag">New</span>}
              {event.locked && (
                <span className="schedule-lock" title="Locked by an admin" aria-label="Locked">
                  <LockIcon />
                </span>
              )}
            </strong>
            {description && <span className="event-card-description">{description}</span>}
          </span>
          <span className="event-card-tile" aria-hidden="true">
            {event.repeat === "daily" ? (
              <>
                <small>Every</small>
                <b>Day</b>
              </>
            ) : (
              <>
                <small>{new Intl.DateTimeFormat(undefined, { month: "short" }).format(start)}</small>
                <b>{start.getDate()}</b>
                <small>{new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(start)}</small>
              </>
            )}
          </span>
          <span className="event-card-foot">
            <span title={original ? `Set for ${original}` : undefined}>
              Time:{" "}
              <b>
                {formatTime(startsAt)} – {formatTime(endsAt)} {zoneAbbreviation(localTimeZone(), start)}
              </b>
            </span>
            <span>
              Status: <b className={`event-card-state ${state}`}>{stateLabel}</b>
            </span>
            <span className="schedule-participants event-card-people">
              <PersonAvatar users={users} id={event.createdBy} prefix="Created by " />
              {event.participantIds
                .filter((id) => id !== event.createdBy)
                .map((id) => (
                  <PersonAvatar key={id} users={users} id={id} />
                ))}
            </span>
          </span>
        </button>
      </div>
    )
  }

  return (
    <div className="desk-body">
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
      {view === "daily" ? (
        daily.length === 0 ? (
          <p className="hint">No daily events yet. Admins can set an event to repeat every day.</p>
        ) : (
          <section className="schedule-day">
            <h2>Every day</h2>
            {/* Today's run of a daily event is past once it has ended. */}
            {daily.map((occurrence) => item(occurrence, new Date(occurrence.endsAt).getTime() < now))}
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
      {selected && (
        <EventDetail
          event={selected}
          users={users}
          canEdit={!selected.locked || isAdmin}
          isAdmin={isAdmin}
          covered={covered}
          onEdit={() => onEdit(selected)}
          onClose={closeEvent}
        />
      )}
    </div>
  )
}

// A round avatar whose name shows on hover, after `prefix` if given (e.g. "Created by ").
function PersonAvatar({ users, id, prefix = "" }: { users: RegisteredUser[]; id: string | null; prefix?: string }) {
  const user = id ? users.find((item) => item.userId === id) : undefined
  const name = nameOf(users, id)
  return (
    <span className="avatar event-avatar" title={prefix + name} aria-label={prefix + name} role="img">
      {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span>{initials(name)}</span>}
    </span>
  )
}

function EventDetail({
  event,
  users,
  canEdit,
  isAdmin,
  covered,
  onEdit,
  onClose,
}: {
  event: DeskEvent
  users: RegisteredUser[]
  // Locked events can only be changed by admins.
  canEdit: boolean
  // Only admins see who an event is visible to.
  isAdmin: boolean
  // True while the editor is open on top, so Esc closes only the editor.
  covered: boolean
  onEdit: () => void
  onClose: () => void
}) {
  useEffect(() => {
    if (covered) return
    function onKey(key: KeyboardEvent) {
      if (key.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [covered, onClose])

  const occurrence =
    event.repeat === "daily"
      ? todayOf(event)
      : event.startsAt && event.endsAt
        ? { event, startsAt: event.startsAt, endsAt: event.endsAt }
        : null
  const original = occurrence ? originalTime(event, occurrence.startsAt) : null

  // Slides in from the right like the task panel: a bar with close and edit, the facts in two columns,
  // then the notes in a box.
  return (
    <div className="drawer-backdrop" onPointerDown={(down) => down.target === down.currentTarget && onClose()}>
      <aside className="event-detail drawer task-drawer" role="dialog" aria-label="Event details">
        <div className="task-drawer-bar">
          <button type="button" className="event-detail-icon" aria-label="Close" title="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <h2>{event.title}</h2>
          {event.locked && (
            <span className="schedule-lock" title="Locked by an admin" aria-label="Locked">
              <LockIcon />
            </span>
          )}
          {canEdit && (
            <button type="button" className="event-detail-icon" aria-label="Edit event" title="Edit" onClick={onEdit}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M11 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13" />
                <path d="M17.6 3.9a2 2 0 0 1 2.8 2.8L12.5 14.6 9 15.5l.9-3.5 7.7-8.1z" />
              </svg>
            </button>
          )}
        </div>
        <div className="task-drawer-main">
          <dl className="task-facts">
            <dt>
              <FactIcon kind="due" />
              Date
            </dt>
            <dd>
              {event.repeat === "daily"
                ? "Every day"
                : occurrence
                  ? new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(
                      new Date(occurrence.startsAt),
                    )
                  : "—"}
            </dd>
            <dt>
              <ClockIcon />
              Time
            </dt>
            <dd>
              {occurrence ? (
                <>
                  {formatTime(occurrence.startsAt)} – {formatTime(occurrence.endsAt)}
                  <span className="task-fact-muted">{zoneAbbreviation(localTimeZone(), new Date(occurrence.startsAt))}</span>
                </>
              ) : (
                "—"
              )}
            </dd>
            <dt>
              <FactIcon kind="zone" />
              Time zone
            </dt>
            <dd>
              {event.timeZone}
              {original && <span className="task-fact-muted">Set for {original}</span>}
            </dd>
            <dt>
              <FactIcon kind="location" />
              Location
            </dt>
            <dd>{event.location || <span className="task-fact-muted">None</span>}</dd>
            <dt>
              <FactIcon kind="creator" />
              Created by
            </dt>
            <dd className="task-fact-person">
              <PersonAvatar users={users} id={event.createdBy} />
              {nameOf(users, event.createdBy)}
            </dd>
            <dt>
              <FactIcon kind="assignees" />
              Participants
            </dt>
            <dd>
              {event.participantIds.length > 0 ? (
                <span className="task-assignee">
                  {event.participantIds.map((id) => (
                    <PersonAvatar key={id} users={users} id={id} />
                  ))}
                </span>
              ) : (
                "No one yet"
              )}
            </dd>
            {isAdmin && (
              <>
                <dt>
                  <FactIcon kind="visibility" />
                  Who can see it
                </dt>
                <dd>{event.visibility === "participants" ? "Participants and the creator" : "All leaders"}</dd>
              </>
            )}
          </dl>
          <div className="task-drawer-description">
            <h3>
              <FactIcon kind="description" />
              Notes
            </h3>
            {event.notes ? <p>{event.notes}</p> : <p className="empty">No notes.</p>}
          </div>
        </div>
      </aside>
    </div>
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
      className="task-form"
    >
      <div className="task-form-card">
        <label>
          Event name
          <input value={title} maxLength={120} required autoFocus onChange={(change) => setTitle(change.target.value)} />
        </label>
        <p className="hint task-form-hint">
          Created by {event ? nameOf(users, event.createdBy) : "you"}
          {daily && " · Repeats every day. Admins can change the repeat."}
        </p>
        <label>
          Notes
          <textarea value={notes} rows={3} maxLength={2000} onChange={(change) => setNotes(change.target.value)} />
        </label>
        <label>
          Location or link
          <input value={location} maxLength={120} onChange={(change) => setLocation(change.target.value)} />
        </label>
      </div>
      <div className="task-form-card">
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
        <fieldset className="task-form-priority task-form-visibility">
          <legend>Who can see it</legend>
          {(
            [
              { id: "leaders", label: "All leaders" },
              { id: "participants", label: "Participants only" },
            ] as Array<{ id: EventVisibility; label: string }>
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={visibility === item.id}
              title={item.id === "participants" ? "Only the participants and the creator" : undefined}
              onClick={() => setVisibility(item.id)}
            >
              {item.label}
            </button>
          ))}
        </fieldset>
      </div>
      <PeoplePicker
        legend="Participants"
        addLabel="Add participant"
        ids={participantIds}
        onChange={setParticipantIds}
        users={users}
        leaders={leaders}
        selfId={selfId}
      />
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
            Updated {formatMoment(note.updatedAt, { year: "numeric", month: "short", day: "numeric" })}
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
  className,
}: {
  title: string
  children: ReactNode
  // Extra class on the form, for an editor with its own layout.
  className?: string
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
      <form className={className ? `desk-modal ${className}` : "desk-modal"} role="dialog" aria-label={title} onSubmit={onSubmit}>
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
