import { useState } from "react"
import { installUpdate, useUpdates } from "../lib/updater"

// Offers a newer version of the app when one has been released, and shows it installing — on request,
// or straight away when automatic updates are on (Settings → Updates).
export function UpdateBanner() {
  const { update, progress, error } = useUpdates()
  const [dismissed, setDismissed] = useState<string | null>(null)

  const installing = progress !== undefined
  if (!update || (dismissed === update.version && !installing)) return null

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
          <button type="button" className="button" onClick={installUpdate}>
            {error ? "Try again" : "Update now"}
          </button>
        </div>
      )}
    </div>
  )
}
