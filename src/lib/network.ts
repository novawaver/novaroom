import { useSyncExternalStore } from "react"
import { supabase } from "./supabase"

// How the connection to Novaroom's server looks right now, for the title bar indicator and for
// reloading data after the connection comes back.
//   online: the last check reached the server.
//   latencyMs: round trip of that check.
//   downlinkMbps: the system's estimate of download speed, where the browser reports one.
//   epoch: goes up each time the connection comes back after being lost, so screens can reload
//     what they missed and subscribe to live changes again.
export type NetworkState = {
  online: boolean
  latencyMs: number | null
  downlinkMbps: number | null
  epoch: number
}

const CHECK_EVERY_MS = 15 * 1000
// While offline, check more often so the app recovers soon after the network does.
const RETRY_EVERY_MS = 4 * 1000
const CHECK_TIMEOUT_MS = 6 * 1000
// Two failed checks in a row before showing offline, so one slow reply does not flash it.
const FAILURES_BEFORE_OFFLINE = 2

type Connection = EventTarget & { downlink?: number }

function connection() {
  return (navigator as Navigator & { connection?: Connection }).connection
}

function downlink() {
  const value = connection()?.downlink
  return typeof value === "number" && value > 0 ? value : null
}

let state: NetworkState = { online: navigator.onLine, latencyMs: null, downlinkMbps: downlink(), epoch: 0 }
const listeners = new Set<() => void>()
let started = false
let timer: number | undefined
let failures = 0
let checking = false

function update(next: Partial<NetworkState>) {
  const merged = { ...state, ...next }
  if (
    merged.online === state.online &&
    merged.latencyMs === state.latencyMs &&
    merged.downlinkMbps === state.downlinkMbps &&
    merged.epoch === state.epoch
  ) {
    return
  }
  state = merged
  listeners.forEach((listener) => listener())
}

async function ping(): Promise<number> {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  const started = performance.now()
  if (url && key) {
    const response = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key },
      cache: "no-store",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    if (!response.ok && response.status >= 500) throw new Error(`Server replied ${response.status}`)
  } else if (!navigator.onLine) {
    // Offline preview has no server; follow what the system says.
    throw new Error("Offline")
  }
  return Math.round(performance.now() - started)
}

// The connection came back: refresh the sign-in if it expired meanwhile, make sure live updates
// reconnect, and tell screens to reload.
function recovered() {
  if (supabase) {
    const client = supabase
    void client.auth
      .getSession()
      .then(({ data }) => {
        if (data.session) client.realtime.setAuth(data.session.access_token)
      })
      .catch(() => {})
      .finally(() => {
        if (!client.realtime.isConnected()) client.realtime.connect()
      })
  }
  update({ online: true, epoch: state.epoch + 1 })
}

async function check() {
  if (checking) return
  checking = true
  try {
    const latencyMs = await ping()
    failures = 0
    if (!state.online) recovered()
    update({ online: true, latencyMs, downlinkMbps: downlink() })
  } catch {
    failures += 1
    if (failures >= FAILURES_BEFORE_OFFLINE || !navigator.onLine) {
      update({ online: false, latencyMs: null, downlinkMbps: downlink() })
    }
  } finally {
    checking = false
    schedule()
  }
}

function schedule() {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void check(), state.online ? CHECK_EVERY_MS : RETRY_EVERY_MS)
}

function start() {
  if (started) return
  started = true
  window.addEventListener("online", () => void check())
  window.addEventListener("offline", () => {
    failures = FAILURES_BEFORE_OFFLINE
    update({ online: false, latencyMs: null })
  })
  // Timers pause while the window is hidden or the computer sleeps; check again on return.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check()
  })
  connection()?.addEventListener("change", () => update({ downlinkMbps: downlink() }))
  void check()
}

function subscribe(listener: () => void) {
  start()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const snapshot = () => state

export function useNetwork(): NetworkState {
  return useSyncExternalStore(subscribe, snapshot)
}

// Just the reconnect counter, for effects that reload or resubscribe when the connection returns.
export function useReconnectEpoch() {
  return useSyncExternalStore(subscribe, () => state.epoch)
}
