import { useEffect, useState } from "react"
import { beforeExit } from "../lib/unsaved"
import { checkForUpdate, type AvailableUpdate } from "../lib/updater"

// First check shortly after start-up (so it does not slow sign-in), then every few hours.
const FIRST_CHECK_MS = 15 * 1000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

// Offers a newer version of the app when one has been released, and installs it on request.
export function UpdateBanner() {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null | undefined>(undefined)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    const run = () => {
      void checkForUpdate()
        .then((next) => {
          if (active && next) setUpdate(next)
        })
        .catch(() => {
          // Offline or the release server is unreachable; try again at the next check.
        })
    }
    const first = window.setTimeout(run, FIRST_CHECK_MS)
    const repeat = window.setInterval(run, CHECK_EVERY_MS)
    return () => {
      active = false
      window.clearTimeout(first)
      window.clearInterval(repeat)
    }
  }, [])

  if (!update || dismissed === update.version) return null
  const installing = progress !== undefined

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <div className="update-text">
        <strong>Novaroom {update.version} is available</strong>
        <span>
          {error
            ? error
            : installing
              ? progress === null
                ? "Downloading…"
                : progress < 1
                  ? `Downloading… ${Math.round(progress * 100)}%`
                  : "Installing… Novaroom will restart."
              : "Update now to get the latest features and fixes. Novaroom will restart."}
        </span>
        {installing && progress !== null && progress < 1 && (
          <span className="update-progress" aria-hidden="true">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
        )}
      </div>
      {!installing && (
        <div className="update-actions">
          <button type="button" className="button secondary" onClick={() => setDismissed(update.version)}>
            Later
          </button>
          <button
            type="button"
            className="button"
            onClick={() =>
              // Installing restarts the app, so unsaved changes are saved or discarded first.
              beforeExit(() => {
                setError("")
                setProgress(null)
                void update.install(setProgress).catch((caught) => {
                  setProgress(undefined)
                  setError(caught instanceof Error ? caught.message : "The update could not be installed. Try again later.")
                })
              })
            }
          >
            {error ? "Try again" : "Update now"}
          </button>
        </div>
      )}
    </div>
  )
}
