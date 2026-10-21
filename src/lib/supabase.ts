import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Requests that hang on a bad connection would leave screens loading forever, so give up after a
// while and let the screen show an error (and reload once the connection is back). File uploads
// and downloads are left alone, since a large file can take longer than this on a slow link.
const REQUEST_TIMEOUT_MS = 20 * 1000

const fetchWithTimeout: typeof fetch = (input, init) => {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (target.includes("/storage/v1/object") || init?.signal?.aborted) return fetch(input, init)
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  return fetch(input, { ...init, signal })
}

// Realtime's heartbeat runs in a Web Worker. Windows slows timers down to about once a minute in a
// minimized or hidden window, which let the live connection time out: the person then showed as
// offline to others and stopped receiving live alerts, even though the app was still running.
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, { global: { fetch: fetchWithTimeout }, realtime: { worker: true } })
    : null

export const isSupabaseConfigured = supabase !== null
