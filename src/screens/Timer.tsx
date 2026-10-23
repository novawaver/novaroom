import { useCallback, useEffect, useRef, useState } from "react"
import {
  addDays,
  instantToZoned,
  timeZoneOptions,
  zoneAbbreviation,
  zonedToInstant,
} from "../lib/timezone"
import {
  IDLE_AFTER_SECONDS,
  extendSegment,
  formatDuration,
  listSegments,
  readTimerEnabled,
  startSegment,
  systemIdleSeconds,
  dailyTotals,
  totalsFor,
  writeTimerEnabled,
  type DayRow,
  type TimerSegment,
  type TimerStatus,
} from "../lib/timer"

const TICK_MS = 15 * 1000
const SAVE_EVERY_MS = 60 * 1000
// A longer pause between checks means the computer slept; that time counts as offline.
const SLEEP_GAP_MS = 2 * 60 * 1000

type Current = {
  id: string | null
  status: TimerStatus
  startedAt: number
  endedAt: number
  // The end time last written to the database; periods are never shortened below it.
  savedEnd: number
  savedAt: number
}

export type LiveTimer = { status: TimerStatus; since: string; segment: TimerSegment | null }

// Runs while the app is open and records awake and idle periods for the signed-in person.
// Always on for Leadership members; optional for everyone else.
export function useTimer(userId: string | null, isLeader: boolean) {
  const [optedIn, setOptedIn] = useState<boolean | null>(null)
  const [live, setLive] = useState<LiveTimer | null>(null)
  // Bumped whenever a period is saved, so the Time Tracker page reloads.
  const [version, setVersion] = useState(0)
  const enabled = Boolean(userId) && (isLeader || optedIn === true)

  useEffect(() => {
    setOptedIn(null)
    if (!userId) return
    let active = true
    void readTimerEnabled(userId)
      .then((value) => {
        if (active) setOptedIn(value)
      })
      .catch(() => {
        if (active) setOptedIn(false)
      })
    return () => {
      active = false
    }
  }, [userId])

  const setEnabled = useCallback(
    async (next: boolean) => {
      if (!userId || isLeader) return
      setOptedIn(next)
      await writeTimerEnabled(userId, next)
    },
    [userId, isLeader],
  )

  useEffect(() => {
    if (!enabled || !userId) {
      setLive(null)
      return
    }
    let current: Current | null = null
    let lastTick = 0
    let lastInput = Date.now()
    let stopped = false
    // Database writes run one after another so a period is created before it is extended.
    let queue: Promise<void> = Promise.resolve()
    const enqueue = (job: () => Promise<void>) => {
      queue = queue.then(job).catch(() => {})
    }

    // In a browser (no system idle time), count input inside the app window instead.
    const onInput = () => {
      lastInput = Date.now()
    }
    const inputEvents = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const
    for (const name of inputEvents) window.addEventListener(name, onInput, { passive: true })

    const save = (segment: Current) => {
      const end = segment.endedAt
      segment.savedEnd = end
      segment.savedAt = Date.now()
      enqueue(async () => {
        if (segment.id) {
          await extendSegment(userId, segment.id, new Date(end))
        } else {
          segment.id = await startSegment(userId, segment.status, new Date(segment.startedAt), new Date(end))
        }
        if (!stopped) setVersion((value) => value + 1)
      })
    }

    const close = (at: number) => {
      if (!current) return
      current.endedAt = Math.max(at, current.savedEnd, current.startedAt)
      save(current)
      current = null
    }

    const begin = (status: TimerStatus, at: number, now: number) => {
      current = { id: null, status, startedAt: at, endedAt: now, savedEnd: at, savedAt: 0 }
      save(current)
    }

    const publish = () => {
      if (stopped) return
      setLive(
        current
          ? {
              status: current.status,
              since: new Date(current.startedAt).toISOString(),
              segment: {
                id: current.id ?? "live",
                status: current.status,
                startedAt: new Date(current.startedAt).toISOString(),
                endedAt: new Date(current.endedAt).toISOString(),
              },
            }
          : null,
      )
    }

    const tick = async () => {
      const now = Date.now()
      if (lastTick && now - lastTick > SLEEP_GAP_MS) close(lastTick)
      lastTick = now
      const idle = (await systemIdleSeconds()) ?? Math.floor((now - lastInput) / 1000)
      if (stopped) return
      const status: TimerStatus = idle >= IDLE_AFTER_SECONDS ? "idle" : "awake"
      // Idle really began when input stopped, so the switch is backdated to then.
      const idleSince = now - idle * 1000
      if (!current) {
        begin(status, status === "idle" ? Math.max(idleSince, now - SLEEP_GAP_MS) : now, now)
      } else if (current.status !== status) {
        const boundary =
          status === "idle" ? Math.max(idleSince, current.startedAt, current.savedEnd) : Math.max(now, current.savedEnd)
        close(boundary)
        begin(status, boundary, now)
      } else {
        current.endedAt = now
        if (now - current.savedAt >= SAVE_EVERY_MS) save(current)
      }
      publish()
    }

    void tick()
    const timer = window.setInterval(() => void tick(), TICK_MS)
    const onLeave = () => close(Date.now())
    window.addEventListener("beforeunload", onLeave)

    return () => {
      stopped = true
      window.clearInterval(timer)
      window.removeEventListener("beforeunload", onLeave)
      for (const name of inputEvents) window.removeEventListener(name, onInput)
      close(Date.now())
    }
  }, [enabled, userId])

  return { enabled, optedIn, setEnabled, live, version }
}

export type TimerRange = "today" | "yesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "year" | "all"

export const TIMER_RANGES: Array<{ id: TimerRange; label: string }> = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "thisWeek", label: "This Week" },
  { id: "lastWeek", label: "Last Week" },
  { id: "thisMonth", label: "This Month" },
  { id: "lastMonth", label: "Last Month" },
  { id: "year", label: "This Year" },
  { id: "all", label: "All" },
]

// Days are handled as "yyyy-mm-dd" keys on the chosen zone's calendar, and turned into exact moments
// with that zone's midnights, so ranges, totals and the timeline all follow the selected time zone.

function todayIn(zone: string) {
  return instantToZoned(new Date(), zone).date
}

// The moment a day starts in the zone.
function midnight(key: string, zone: string) {
  return zonedToInstant(key, "00:00", zone).getTime()
}

// 0 = Sunday … 6 = Saturday. A calendar date's weekday is the same in every zone.
function weekdayOf(key: string) {
  return new Date(`${key}T00:00:00Z`).getUTCDay()
}

function mondayOf(key: string) {
  return addDays(key, -((weekdayOf(key) + 6) % 7))
}

function firstOfMonth(key: string, monthsFromNow = 0) {
  const [year, month] = key.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1 + monthsFromNow, 1)).toISOString().slice(0, 10)
}

// The first day of a range and the day after its last. Weeks run Monday to Sunday, months from the
// 1st to their last day. Current ranges end after today; only time up to now counts.
function rangeBounds(range: TimerRange, rows: DayRow[], zone: string) {
  const today = todayIn(zone)
  const tomorrow = addDays(today, 1)
  switch (range) {
    case "yesterday":
      return { startKey: addDays(today, -1), endKey: today }
    case "thisWeek":
      return { startKey: mondayOf(today), endKey: tomorrow }
    case "lastWeek":
      return { startKey: addDays(mondayOf(today), -7), endKey: mondayOf(today) }
    case "thisMonth":
      return { startKey: firstOfMonth(today), endKey: tomorrow }
    case "lastMonth":
      return { startKey: firstOfMonth(today, -1), endKey: firstOfMonth(today) }
    case "year":
      return { startKey: `${today.slice(0, 4)}-01-01`, endKey: tomorrow }
    case "all":
      return { startKey: rows[0]?.day ?? today, endKey: tomorrow }
    default:
      return { startKey: today, endKey: tomorrow }
  }
}

export type RangeTotals = {
  awake: number
  idle: number
  offline: number
  span: number
  startKey: string
  endKey: string
}

// Totals for a range, counting only time up to now. Offline is the rest: when nothing was recorded.
export function rangeTotals(range: TimerRange, rows: DayRow[], zone: string, now = Date.now()): RangeTotals {
  const { startKey, endKey } = rangeBounds(range, rows, zone)
  let awake = 0
  let idle = 0
  for (const row of rows) {
    if (row.day < startKey || row.day >= endKey) continue
    awake += row.awake
    idle += row.idle
  }
  const span = Math.max(0, Math.min(midnight(endKey, zone), now) - midnight(startKey, zone))
  return { awake, idle, offline: Math.max(0, span - awake - idle), span, startKey, endKey }
}

// Loads today's periods (for the timeline) and per-day totals for every range in the chosen zone,
// merging in the period being recorded right now so today's numbers are live.
export function useTimerHistory(
  userId: string | null,
  open: boolean,
  version: number,
  live: LiveTimer | null,
  zone: string,
) {
  const [todaySegments, setTodaySegments] = useState<TimerSegment[] | null>(null)
  const [rows, setRows] = useState<DayRow[] | null>(null)
  const [error, setError] = useState("")
  const loadRef = useRef(0)

  useEffect(() => {
    if (!open || !userId) return
    let active = true
    const load = ++loadRef.current
    const start = new Date(midnight(addDays(todayIn(zone), -1), zone))
    Promise.all([listSegments(userId, start, new Date()), dailyTotals(userId, null, zone)])
      .then(([segments, days]) => {
        if (!active || load !== loadRef.current) return
        setTodaySegments(segments)
        setRows(days)
        setError("")
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load your time.")
      })
    return () => {
      active = false
    }
  }, [open, userId, version, zone])

  if (!todaySegments || !rows) return { todaySegments: null, rows: null, error }
  const liveSegment = live?.segment
  const today = liveSegment
    ? todaySegments.some((item) => item.id === liveSegment.id)
      ? todaySegments.map((item) => (item.id === liveSegment.id ? liveSegment : item))
      : [...todaySegments, liveSegment]
    : todaySegments
  // Today's row comes from the live periods rather than the last saved totals.
  const todayKey = todayIn(zone)
  const todayTotals = totalsFor(
    today,
    new Date(midnight(todayKey, zone)),
    new Date(midnight(addDays(todayKey, 1), zone)),
  )
  const merged = [
    ...rows.filter((row) => row.day !== todayKey),
    { day: todayKey, awake: todayTotals.awake, idle: todayTotals.idle },
  ].sort((a, b) => a.day.localeCompare(b.day))
  return { todaySegments: today, rows: merged, error }
}

function clock(value: string | number, zone: string) {
  return new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  )
}

// A calendar date key as text, e.g. "Oct 15, 2026". Formatted in UTC so the key's own date shows.
function formatKey(key: string, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`))
}

const STATUS_LABELS: Record<TimerStatus | "offline", string> = { awake: "Online", idle: "Idle", offline: "Offline" }

type Bucket = { key: string; label: string; awake: number; idle: number; span: number }

// One row per day for the week and month views, one per month for the year and all-time views.
function buckets(
  range: TimerRange,
  rows: DayRow[],
  startKey: string,
  endKey: string,
  zone: string,
  now = Date.now(),
): Bucket[] {
  const byDay = new Map(rows.map((row) => [row.day, row]))
  const monthly = range === "year" || range === "all"
  const result = new Map<string, Bucket>()
  for (let key = startKey; key < endKey && midnight(key, zone) <= now; key = addDays(key, 1)) {
    const span = Math.min(midnight(addDays(key, 1), zone), now) - midnight(key, zone)
    const row = byDay.get(key)
    const bucketKey = monthly ? key.slice(0, 7) : key
    const bucket = result.get(bucketKey) ?? {
      key: bucketKey,
      label: monthly
        ? formatKey(key, { month: "long", year: "numeric" })
        : formatKey(key, { weekday: "short", month: "short", day: "numeric" }),
      awake: 0,
      idle: 0,
      span: 0,
    }
    bucket.awake += row?.awake ?? 0
    bucket.idle += row?.idle ?? 0
    bucket.span += span
    result.set(bucketKey, bucket)
  }
  return [...result.values()].reverse()
}

export function Timer({
  range,
  zone,
  onZoneChange,
  enabled,
  isLeader,
  optedIn,
  onToggle,
  todaySegments,
  rows,
  error,
}: {
  range: TimerRange
  zone: string
  onZoneChange: (zone: string) => void
  enabled: boolean
  isLeader: boolean
  optedIn: boolean | null
  onToggle: (next: boolean) => Promise<void>
  todaySegments: TimerSegment[] | null
  rows: DayRow[] | null
  error: string
}) {
  const [toggleError, setToggleError] = useState("")
  const label = TIMER_RANGES.find((item) => item.id === range)?.label ?? "Today"
  const totals = rows ? rangeTotals(range, rows, zone) : null
  // Today and Yesterday show a single day's timeline and periods.
  const singleDay = range === "today" || range === "yesterday"
  const dayKey = range === "yesterday" ? addDays(todayIn(zone), -1) : todayIn(zone)
  const dayStartMs = midnight(dayKey, zone)
  // Usually 24 hours, but 23 or 25 on a daylight-saving change.
  const daySpan = midnight(addDays(dayKey, 1), zone) - dayStartMs
  const daySegments = (todaySegments ?? []).filter(
    (item) =>
      new Date(item.endedAt).getTime() > dayStartMs && new Date(item.startedAt).getTime() < dayStartMs + daySpan,
  )
  const position = (value: string) =>
    Math.min(100, Math.max(0, ((new Date(value).getTime() - dayStartMs) / daySpan) * 100))
  const subtitle = totals
    ? singleDay
      ? formatKey(totals.startKey)
      : `${formatKey(totals.startKey)} – ${formatKey(addDays(totals.endKey, -1))}`
    : ""

  return (
    <section className="settings">
      <header className="thread-bar profile-bar">
        <h1>Time Tracker</h1>
        <label className={isLeader ? "timer-toggle locked" : "timer-toggle"}>
          <span>{enabled ? "On" : "Off"}</span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Time Tracker"
            className="switch"
            disabled={isLeader || optedIn === null}
            title={isLeader ? "Always on for Leadership members" : undefined}
            onClick={() => {
              setToggleError("")
              void onToggle(!enabled).catch((caught) =>
                setToggleError(caught instanceof Error ? caught.message : "Could not change the Time Tracker."),
              )
            }}
          >
            <span />
          </button>
        </label>
      </header>
      <div className="desk-body timer-body">
        {(error || toggleError) && (
          <p className="form-error" role="alert">
            {error || toggleError}
          </p>
        )}
        {!enabled && (
          <p className="timer-now">
            Time tracking is off. Turn it on to record your online and idle time while Novaroom is running.
          </p>
        )}
        <div className="timer-day-row">
          <h2 className="timer-day">
            {label}
            <span>{subtitle}</span>
          </h2>
          <label className="timer-zone">
            <span>Time zone</span>
            <select value={zone} onChange={(event) => onZoneChange(event.target.value)}>
              {timeZoneOptions(zone).map((item) => (
                <option key={item} value={item}>
                  {item} ({zoneAbbreviation(item)})
                </option>
              ))}
            </select>
          </label>
        </div>
        {!totals || !rows ? (
          !error && <p className="hint">Loading…</p>
        ) : (
          <>
            <div className="timer-tiles">
              {(["awake", "idle", "offline"] as const).map((status) => (
                <div key={status} className={`timer-tile ${status}`}>
                  <span className="timer-tile-label">
                    <span className={`timer-dot ${status}`} />
                    {STATUS_LABELS[status]}
                  </span>
                  <strong>{formatDuration(totals[status])}</strong>
                  <span className="timer-tile-share">
                    {totals.span > 0 ? Math.round((totals[status] / totals.span) * 100) : 0}%
                    {range === "today" ? " of the day so far" : range === "yesterday" ? " of the day" : " of this period"}
                  </span>
                </div>
              ))}
            </div>
            {singleDay ? (
              <TodayDetail
                segments={daySegments}
                position={position}
                dayStartMs={dayStartMs}
                zone={zone}
              />
            ) : (
              <>
                <h3 className="timer-list-title">{range === "year" || range === "all" ? "By month" : "By day"}</h3>
                <ol className="timer-list timer-breakdown">
                  {buckets(range, rows, totals.startKey, totals.endKey, zone).map((bucket) => (
                    <li key={bucket.key}>
                      <span className="timer-breakdown-label">{bucket.label}</span>
                      <span className="timer-bar small" aria-hidden="true">
                        <span
                          className="timer-span"
                          style={{ left: 0, width: `${bucket.span ? (bucket.awake / bucket.span) * 100 : 0}%` }}
                        />
                        <span
                          className="timer-span idle"
                          style={{
                            left: `${bucket.span ? (bucket.awake / bucket.span) * 100 : 0}%`,
                            width: `${bucket.span ? (bucket.idle / bucket.span) * 100 : 0}%`,
                          }}
                        />
                      </span>
                      <span className="timer-list-length">
                        {formatDuration(bucket.awake)} online
                        <span className="timer-breakdown-idle"> · {formatDuration(bucket.idle)} idle</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function TodayDetail({
  segments,
  position,
  dayStartMs,
  zone,
}: {
  segments: TimerSegment[]
  position: (value: string) => number
  dayStartMs: number
  zone: string
}) {
  return (
    <>
      <div className="timer-timeline" aria-label="Timeline of the day">
        <div className="timer-bar">
          {segments.map((item) => (
            <span
              key={`${item.id}:${item.startedAt}`}
              className={`timer-span ${item.status}`}
              style={{
                left: `${position(item.startedAt)}%`,
                width: `${Math.max(0.15, position(item.endedAt) - position(item.startedAt))}%`,
              }}
              title={`${STATUS_LABELS[item.status]} ${clock(item.startedAt, zone)}–${clock(item.endedAt, zone)} ${zoneAbbreviation(zone, new Date(item.startedAt))}`}
            />
          ))}
        </div>
        <div className="timer-hours">
          {[0, 6, 12, 18, 24].map((hour) => (
            <span key={hour} style={{ left: `${(hour / 24) * 100}%` }}>
              {clock(dayStartMs + hour * 60 * 60 * 1000, zone)}
            </span>
          ))}
        </div>
      </div>
      <h3 className="timer-list-title">Periods</h3>
      {segments.length === 0 ? (
        <p className="hint">Nothing recorded on this day.</p>
      ) : (
        <ol className="timer-list">
          {[...segments].reverse().map((item) => (
            <li key={`${item.id}:${item.startedAt}`}>
              <span className={`timer-dot ${item.status}`} />
              <span className="timer-list-status">{STATUS_LABELS[item.status]}</span>
              <span className="timer-list-time">
                {clock(item.startedAt, zone)} – {clock(item.endedAt, zone)} {zoneAbbreviation(zone, new Date(item.startedAt))}
              </span>
              <span className="timer-list-length">
                {formatDuration(new Date(item.endedAt).getTime() - new Date(item.startedAt).getTime())}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
