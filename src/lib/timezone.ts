// Time zone helpers built on the browser's Intl support, so no date library is needed.
// Dates are "yyyy-mm-dd" and times "hh:mm" wall-clock values in the given zone.
// The admin site keeps an identical copy in novaroom-admin/src/timezone.ts.

export function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

export function isTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone })
    return true
  } catch {
    return false
  }
}

// Every zone the browser knows, with the viewer's own and UTC guaranteed to be present.
export function timeZoneOptions(extra?: string) {
  const supported =
    (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? []
  return [...new Set([localTimeZone(), "UTC", ...(extra ? [extra] : []), ...supported])].sort()
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>()

function wallParts(instant: number, zone: string) {
  let format = partsFormatters.get(zone)
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    partsFormatters.set(zone, format)
  }
  const parts = format.formatToParts(new Date(instant))
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  }
}

// How far the zone's clock is ahead of UTC at that moment, in milliseconds.
function offsetAt(instant: number, zone: string) {
  const p = wallParts(instant, zone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000
}

// The moment a wall-clock date and time happens in a zone.
export function zonedToInstant(date: string, time: string, zone: string): Date {
  const [year, month, day] = date.split("-").map(Number)
  const [hour, minute] = time.split(":").map(Number)
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  // Two passes settle the offset around daylight-saving changes.
  const first = guess - offsetAt(guess, zone)
  return new Date(guess - offsetAt(first, zone))
}

// The wall-clock date and time of a moment in a zone.
export function instantToZoned(instant: Date | string, zone: string) {
  const p = wallParts(new Date(instant).getTime(), zone)
  const pad = (value: number) => String(value).padStart(2, "0")
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` }
}

export function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

// A short label such as "GMT+9" or "PDT" for showing next to times.
export function zoneAbbreviation(zone: string, at: Date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(at)
    return parts.find((part) => part.type === "timeZoneName")?.value ?? zone
  } catch {
    return zone
  }
}
