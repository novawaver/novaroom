import { useSyncExternalStore } from "react"
import { inTauri } from "./desktop"
import { beforeExit } from "./unsaved"

export type AvailableUpdate = {
  version: string
  notes: string
  // Downloads the update (reporting progress from 0 to 1, or null when the size is unknown),
  // checks its signature, installs it and restarts the app.
  install: (onProgress: (fraction: number | null) => void) => Promise<void>
}

// Only the installed desktop app can update itself; in a browser or `tauri dev` there is nothing to check.
export function canUpdate() {
  return inTauri() && !import.meta.env.DEV
}

// Asks the release server (GitHub Releases, set in tauri.conf.json) whether a newer version exists.
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!canUpdate()) return null
  const { check } = await import("@tauri-apps/plugin-updater")
  const update = await check()
  if (!update) return null
  return {
    version: update.version,
    notes: update.body ?? "",
    async install(onProgress) {
      let total = 0
      let received = 0
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0
          onProgress(total ? 0 : null)
        } else if (event.event === "Progress") {
          received += event.data.chunkLength
          onProgress(total ? Math.min(1, received / total) : null)
        }
      })
      // On Windows the installer usually closes and reopens the app itself; this covers the rest.
      const { relaunch } = await import("@tauri-apps/plugin-process")
      await relaunch()
    },
  }
}

const AUTO_UPDATE_KEY = "novaroom.autoUpdate"

// On unless the person turned it off.
export function readAutoUpdate() {
  return localStorage.getItem(AUTO_UPDATE_KEY) !== "off"
}

// What the banner and Settings show about updates.
//   checking: a check is under way.
//   checkedAt: when the last check finished without an error.
//   update: the newer version found by the last check, if any.
//   progress: undefined until installing starts, then the download fraction (null when the size is unknown).
//   error: why the last check or install failed.
export type UpdateState = {
  autoUpdate: boolean
  checking: boolean
  checkedAt: number | null
  update: AvailableUpdate | null
  progress: number | null | undefined
  error: string
}

// First check shortly after start-up (so it does not slow sign-in), then often enough that a new
// release reaches people within minutes of being published.
const FIRST_CHECK_MS = 15 * 1000
const CHECK_EVERY_MS = 5 * 60 * 1000

let state: UpdateState = {
  autoUpdate: readAutoUpdate(),
  checking: false,
  checkedAt: null,
  update: null,
  progress: undefined,
  error: "",
}
const listeners = new Set<() => void>()
let started = false
// Auto-update installs each version once; if that fails or the person keeps unsaved changes,
// the banner offers it instead of asking again at every check.
let autoTried: string | null = null

function set(next: Partial<UpdateState>) {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

function message(caught: unknown, fallback: string) {
  if (caught instanceof Error && caught.message) return caught.message
  if (typeof caught === "string" && caught) return caught
  return fallback
}

/** Checks for a newer version now. Background checks fail quietly; checks the person asked for say why. */
export async function checkNow(manual = false) {
  if (!canUpdate() || state.checking || state.progress !== undefined) return
  set({ checking: true, ...(manual ? { error: "" } : {}) })
  try {
    const update = await checkForUpdate()
    set({ checking: false, checkedAt: Date.now(), update, error: "" })
    if (update && state.autoUpdate && autoTried !== update.version) {
      autoTried = update.version
      installUpdate()
    }
  } catch (caught) {
    // Offline or the release server is unreachable; background checks try again next time.
    set({
      checking: false,
      ...(manual ? { error: message(caught, "Could not check for updates. Try again later.") } : {}),
    })
  }
}

/** Installs the update found by the last check and restarts Novaroom. */
export function installUpdate() {
  const update = state.update
  if (!update || state.progress !== undefined) return
  // Installing restarts the app, so unsaved changes are saved or discarded first.
  beforeExit(() => {
    set({ error: "", progress: null })
    void update.install((progress) => set({ progress })).catch((caught) => {
      set({ progress: undefined, error: message(caught, "The update could not be installed. Try again later.") })
    })
  })
}

export function setAutoUpdate(on: boolean) {
  localStorage.setItem(AUTO_UPDATE_KEY, on ? "on" : "off")
  set({ autoUpdate: on })
  if (on && state.update && autoTried !== state.update.version) {
    autoTried = state.update.version
    installUpdate()
  }
}

function start() {
  if (started || !canUpdate()) return
  started = true
  window.setTimeout(() => void checkNow(), FIRST_CHECK_MS)
  window.setInterval(() => void checkNow(), CHECK_EVERY_MS)
  // Timers pause while the computer sleeps; check again when the window is back in view.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkNow()
  })
}

function subscribe(listener: () => void) {
  start()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const snapshot = () => state

export function useUpdates(): UpdateState {
  return useSyncExternalStore(subscribe, snapshot)
}
