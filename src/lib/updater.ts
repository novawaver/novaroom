import { inTauri } from "./desktop"

export type AvailableUpdate = {
  version: string
  notes: string
  // Downloads the update (reporting progress from 0 to 1, or null when the size is unknown),
  // checks its signature, installs it and restarts the app.
  install: (onProgress: (fraction: number | null) => void) => Promise<void>
}

// Asks the release server (GitHub Releases, set in tauri.conf.json) whether a newer version exists.
// Only the installed desktop app can update itself; in a browser or `tauri dev` this returns null.
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!inTauri() || import.meta.env.DEV) return null
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
