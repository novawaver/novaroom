import { inTauri } from "./desktop"
import { supabase } from "./supabase"
import { addDays, instantToZoned, zonedToInstant } from "./timezone"

export type TimerStatus = "awake" | "idle"

// A recorded stretch of awake or idle time. Offline time is whatever is not covered by these.
export type TimerSegment = { id: string; status: TimerStatus; startedAt: string; endedAt: string }

// No keyboard or mouse input for longer than this counts as idle.
export const IDLE_AFTER_SECONDS = 60

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

// Offline preview keeps everything in local storage on this computer.
const previewSettingKey = (userId: string) => `novaroom.preview.timer-enabled.${userId}`
const previewSegmentsKey = (userId: string) => `novaroom.preview.timer-segments.${userId}`

function readPreviewSegments(userId: string): TimerSegment[] {
  try {
    return JSON.parse(localStorage.getItem(previewSegmentsKey(userId)) ?? "[]") as TimerSegment[]
  } catch {
    return []
  }
}

function writePreviewSegments(userId: string, segments: TimerSegment[]) {
  localStorage.setItem(previewSegmentsKey(userId), JSON.stringify(segments))
}

// Whether a normal user turned the Timer on. Leadership members are always on, whatever this says.
export async function readTimerEnabled(userId: string): Promise<boolean> {
  if (!supabase) return localStorage.getItem(previewSettingKey(userId)) === "true"
  const { data, error } = await supabase.from("timer_settings").select("enabled").eq("user_id", userId).maybeSingle()
  fail(error)
  return Boolean((data as { enabled: boolean } | null)?.enabled)
}

export async function writeTimerEnabled(userId: string, enabled: boolean) {
  if (!supabase) {
    localStorage.setItem(previewSettingKey(userId), String(enabled))
    return
  }
  const { error } = await supabase
    .from("timer_settings")
    .upsert({ user_id: userId, enabled, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
  fail(error)
}

// Seconds since the last keyboard or mouse input anywhere on the computer, or null when only the
// app's own window can be watched (in a browser, or if the system call fails).
export async function systemIdleSeconds(): Promise<number | null> {
  if (!inTauri()) return null
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    return await invoke<number | null>("idle_seconds")
  } catch {
    return null
  }
}

export async function startSegment(userId: string, status: TimerStatus, startedAt: Date, endedAt: Date) {
  const segment = { status, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString() }
  if (!supabase) {
    const id = crypto.randomUUID()
    writePreviewSegments(userId, [...readPreviewSegments(userId), { id, ...segment }])
    return id
  }
  const { data, error } = await supabase
    .from("timer_segments")
    .insert({ user_id: userId, status, started_at: segment.startedAt, ended_at: segment.endedAt })
    .select("id")
    .single()
  fail(error)
  return (data as { id: string }).id
}

export async function extendSegment(userId: string, id: string, endedAt: Date) {
  if (!supabase) {
    writePreviewSegments(
      userId,
      readPreviewSegments(userId).map((item) => (item.id === id ? { ...item, endedAt: endedAt.toISOString() } : item)),
    )
    return
  }
  const { error } = await supabase.from("timer_segments").update({ ended_at: endedAt.toISOString() }).eq("id", id)
  fail(error)
}

// Segments overlapping [from, to], oldest first.
export async function listSegments(userId: string, from: Date, to: Date): Promise<TimerSegment[]> {
  if (!supabase) {
    return readPreviewSegments(userId)
      .filter((item) => item.endedAt >= from.toISOString() && item.startedAt <= to.toISOString())
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  }
  const { data, error } = await supabase
    .from("timer_segments")
    .select("id, status, started_at, ended_at")
    .eq("user_id", userId)
    .gte("ended_at", from.toISOString())
    .lte("started_at", to.toISOString())
    .order("started_at")
  fail(error)
  return (data as Array<{ id: string; status: TimerStatus; started_at: string; ended_at: string }>).map((row) => ({
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  }))
}

export type DayTotals = { awake: number; idle: number; offline: number; tracked: number }

// Milliseconds of awake, idle and offline time in [start, end), counting only up to now.
// Offline is the part of that window no segment covers, such as when the app was not running.
export function totalsFor(segments: TimerSegment[], start: Date, end: Date, now = Date.now()): DayTotals {
  const from = start.getTime()
  const to = Math.min(end.getTime(), now)
  const totals = { awake: 0, idle: 0, offline: 0, tracked: Math.max(0, to - from) }
  for (const segment of segments) {
    const overlap =
      Math.min(new Date(segment.endedAt).getTime(), to) - Math.max(new Date(segment.startedAt).getTime(), from)
    if (overlap > 0) totals[segment.status] += overlap
  }
  totals.offline = Math.max(0, totals.tracked - totals.awake - totals.idle)
  return totals
}

export function formatDuration(ms: number) {
  const minutes = Math.floor(ms / 60000)
  const hours = Math.floor(minutes / 60)
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`
}

// Awake and idle milliseconds for one day ("yyyy-mm-dd" on the viewer's clock).
export type DayRow = { day: string; awake: number; idle: number }

// Per-day totals from fromDay (or from the first recorded day when null), on the viewer's clock.
// The database adds these up so long ranges do not have to download every period.
export async function dailyTotals(userId: string, fromDay: string | null, zone: string): Promise<DayRow[]> {
  if (!supabase) {
    const rows = new Map<string, DayRow>()
    for (const segment of readPreviewSegments(userId)) {
      let cursor = new Date(segment.startedAt).getTime()
      const end = new Date(segment.endedAt).getTime()
      while (cursor < end) {
        const key = instantToZoned(new Date(cursor), zone).date
        const pieceEnd = Math.min(end, zonedToInstant(addDays(key, 1), "00:00", zone).getTime())
        if (!fromDay || key >= fromDay) {
          const row = rows.get(key) ?? { day: key, awake: 0, idle: 0 }
          row[segment.status] += pieceEnd - cursor
          rows.set(key, row)
        }
        cursor = pieceEnd
      }
    }
    return [...rows.values()].sort((a, b) => a.day.localeCompare(b.day))
  }
  const { data, error } = await supabase.rpc("timer_daily", { from_day: fromDay, zone })
  fail(error)
  return (data as Array<{ day: string; awake_seconds: number; idle_seconds: number }>).map((row) => ({
    day: row.day,
    awake: Number(row.awake_seconds) * 1000,
    idle: Number(row.idle_seconds) * 1000,
  }))
}
