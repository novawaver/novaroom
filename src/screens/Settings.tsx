import { useEffect, useState } from "react"
import { useAuth } from "../auth"
import { APP_VERSION, PRIVACY, TERMS } from "../legal"
import { listBlocked, unblockUser, type BlockedPerson } from "../lib/safety"
import {
  DEFAULT_OPEN_SHORTCUT,
  readOpenShortcut,
  shortcutFromKey,
  shortcutKeys,
  writeOpenShortcut,
  type OpenShortcut,
} from "../lib/shortcut"
import { readStartup, writeStartup, type StartupSettings } from "../lib/startup"
import { applyTheme, readTheme, writeTheme, type ThemeChoice } from "../lib/theme"
import { canUpdate, checkNow, installUpdate, setAutoUpdate, useUpdates } from "../lib/updater"

export type SettingsTab = "appearance" | "startup" | "shortcut" | "updates" | "about" | "safety"

export const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "appearance", label: "Appearance" },
  { id: "startup", label: "Startup" },
  { id: "shortcut", label: "Shortcut" },
  { id: "updates", label: "Updates" },
  { id: "about", label: "About" },
  { id: "safety", label: "Safety" },
]

export function Settings({ tab }: { tab: SettingsTab }) {
  const { session } = useAuth()

  if (!session) return null

  const label = SETTINGS_TABS.find((item) => item.id === tab)?.label ?? "Settings"

  return (
    <section className="settings">
      <header className="thread-bar">
        <h1>{label}</h1>
      </header>
      {tab === "appearance" && (
        <div className="settings-panel">
          <Appearance />
        </div>
      )}
      {tab === "startup" && <Startup />}
      {tab === "shortcut" && <Shortcut />}
      {tab === "updates" && <Updates />}
      {tab === "about" && <AboutNovaroom />}
      {tab === "safety" && <AccountSafety />}
    </section>
  )
}

function Startup() {
  const [settings, setSettings] = useState<StartupSettings | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    void readStartup()
      .then((loaded) => {
        if (!active) return
        if (loaded) setSettings(loaded)
        else setUnavailable(true)
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load startup settings.")
      })
    return () => {
      active = false
    }
  }, [])

  function change(next: StartupSettings) {
    const previous = settings
    setSettings(next)
    setError("")
    void writeStartup(next).catch((caught) => {
      setSettings(previous)
      setError(typeof caught === "string" ? caught : "Could not change startup settings.")
    })
  }

  return (
    <div className="settings-panel">
      {unavailable ? (
        <p className="hint">These settings are only in the Novaroom desktop app.</p>
      ) : (
        <>
          <div className="startup-row">
            <div>
              <strong>Open Novaroom when Windows starts</strong>
              <p className="hint">Novaroom starts when you sign in to your computer, so you see new messages.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings?.launchAtLogin ?? false}
              aria-label="Open Novaroom when Windows starts"
              className="switch"
              disabled={!settings}
              onClick={() => settings && change({ ...settings, launchAtLogin: !settings.launchAtLogin })}
            >
              <span />
            </button>
          </div>
          <div className="startup-row">
            <div>
              <strong>Start minimized</strong>
              <p className="hint">
                Novaroom starts in the system tray, without opening its window. Turn this off to open the window when
                Windows starts.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings?.startMinimized ?? false}
              aria-label="Start minimized"
              className="switch"
              disabled={!settings?.launchAtLogin}
              onClick={() => settings && change({ ...settings, startMinimized: !settings.startMinimized })}
            >
              <span />
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function ShortcutKeys({ shortcut }: { shortcut: string }) {
  return (
    <span className="shortcut-keys">
      {shortcutKeys(shortcut).map((key, index) => (
        <kbd key={index}>{key}</kbd>
      ))}
    </span>
  )
}

function Shortcut() {
  const [status, setStatus] = useState<OpenShortcut | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  // While true, the next key press with Ctrl, Alt or Win becomes the new shortcut.
  const [recording, setRecording] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    void readOpenShortcut()
      .then((loaded) => {
        if (!active) return
        if (loaded) setStatus(loaded)
        else setUnavailable(true)
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load the shortcut.")
      })
    return () => {
      active = false
    }
  }, [])

  async function change(shortcut: string) {
    setSaving(true)
    setError("")
    try {
      setStatus(await writeOpenShortcut(shortcut))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change the shortcut.")
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!recording) return
    function onKey(event: KeyboardEvent) {
      // Keep the press away from the rest of the page, e.g. Esc closing something.
      event.preventDefault()
      event.stopPropagation()
      if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        setRecording(false)
        return
      }
      const shortcut = shortcutFromKey(event)
      if (!shortcut) return
      if (!event.ctrlKey && !event.altKey && !event.metaKey) {
        setError("Include Ctrl, Alt or the Windows key in the shortcut.")
        return
      }
      setRecording(false)
      void change(shortcut)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [recording])

  if (unavailable) {
    return (
      <div className="settings-panel">
        <p className="hint">This setting is only in the Novaroom desktop app.</p>
      </div>
    )
  }

  return (
    <div className="settings-panel">
      <div className="startup-row">
        <div>
          <strong>Open Novaroom</strong>
          <p className="hint">Press this anywhere in Windows to bring the Novaroom window forward, even from the tray.</p>
        </div>
        {recording ? (
          <span className="shortcut-keys recording">Press keys…</span>
        ) : status?.shortcut ? (
          <ShortcutKeys shortcut={status.shortcut} />
        ) : (
          <span className="shortcut-keys off">{status ? "Off" : ""}</span>
        )}
      </div>
      {recording && <p className="hint">Hold Ctrl, Alt or the Windows key and press another key. Esc cancels.</p>}
      {status && status.shortcut && !status.active && !recording && (
        <p className="notice">Another app is using this shortcut, so it isn't working. Choose a different one.</p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="shortcut-actions">
        {recording ? (
          <button type="button" className="button secondary" onClick={() => setRecording(false)}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="button"
            disabled={!status || saving}
            onClick={() => {
              setError("")
              setRecording(true)
            }}
          >
            {saving ? "Saving…" : "Change shortcut"}
          </button>
        )}
        {!recording && status && status.shortcut !== DEFAULT_OPEN_SHORTCUT && (
          <button type="button" className="button secondary" disabled={saving} onClick={() => void change(DEFAULT_OPEN_SHORTCUT)}>
            Reset to {shortcutKeys(DEFAULT_OPEN_SHORTCUT).join(" + ")}
          </button>
        )}
        {!recording && status?.shortcut && (
          <button type="button" className="button secondary" disabled={saving} onClick={() => void change("")}>
            Turn off
          </button>
        )}
      </div>
    </div>
  )
}

function Updates() {
  const { autoUpdate, checking, checkedAt, update, progress, error } = useUpdates()
  const installing = progress !== undefined

  if (!canUpdate()) {
    return (
      <div className="settings-panel">
        <p className="hint">Updates are only in the installed Novaroom desktop app.</p>
      </div>
    )
  }

  let status: string
  if (installing) {
    status =
      progress === null
        ? `Downloading Novaroom ${update?.version}…`
        : progress < 1
          ? `Downloading Novaroom ${update?.version}… ${Math.round(progress * 100)}%`
          : "Installing… Novaroom will restart."
  } else if (checking) {
    status = "Checking for updates…"
  } else if (update) {
    status = `Novaroom ${update.version} is available.`
  } else if (checkedAt) {
    status = `Novaroom is up to date. Last checked at ${new Date(checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
  } else {
    status = "Novaroom has not checked for updates yet."
  }

  return (
    <div className="settings-panel">
      <div className="startup-row">
        <div>
          <strong>Update automatically</strong>
          <p className="hint">
            Novaroom installs new versions as soon as they are released, then restarts. Turn this off to choose
            when to update.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoUpdate}
          aria-label="Update automatically"
          className="switch"
          onClick={() => setAutoUpdate(!autoUpdate)}
        >
          <span />
        </button>
      </div>
      <hr className="settings-divider" />
      <h2>Version</h2>
      <p className="hint">You have Novaroom {APP_VERSION}.</p>
      <p className="hint" role="status" aria-live="polite">
        {status}
      </p>
      {installing && progress !== null && progress < 1 && (
        <span className="update-progress" aria-hidden="true">
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
      )}
      {!installing && (
        <div className="update-actions settings-update-actions">
          <button
            type="button"
            className="button secondary"
            disabled={checking}
            onClick={() => void checkNow(true)}
          >
            {checking ? "Checking…" : "Check for updates"}
          </button>
          {update && (
            <button type="button" className="button" disabled={checking} onClick={installUpdate}>
              Update now
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function AboutNovaroom() {
  return (
    <div className="settings-panel">
      <h2>About</h2>
      <p className="hint">Novaroom {APP_VERSION}. For people 18 and older.</p>
      <hr className="settings-divider" />
      <h2>Privacy policy</h2>
      <div className="legal">
        {PRIVACY.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <hr className="settings-divider" />
      <h2>Terms</h2>
      <div className="legal">
        {TERMS.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </div>
  )
}

function AccountSafety() {
  const { session } = useAuth()
  const [blocked, setBlocked] = useState<BlockedPerson[]>([])
  const [error, setError] = useState("")

  useEffect(() => {
    if (!session) return
    let active = true
    const load = () => {
      void listBlocked(session)
        .then((people) => {
          if (active) setBlocked(people)
        })
        .catch((caught) => {
          if (active) setError(caught instanceof Error ? caught.message : "Could not load blocked people.")
        })
    }
    load()
    window.addEventListener("novaroom-safety", load)
    return () => {
      active = false
      window.removeEventListener("novaroom-safety", load)
    }
  }, [session])

  if (!session) return null

  return (
    <div className="settings-panel">
      <h2>Blocked people</h2>
      <p className="hint">
        Blocking hides that person’s messages and stops direct messages either way. Unblock them here.
      </p>
      {blocked.length === 0 ? (
        <p className="hint">You have not blocked anyone.</p>
      ) : (
        blocked.map((person) => (
          <div className="blocked-row" key={person.userId}>
            <span>{person.displayName}</span>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setError("")
                void unblockUser(session, person.userId).catch((caught) => {
                  setError(caught instanceof Error ? caught.message : "Could not unblock that person.")
                })
              }}
            >
              Unblock
            </button>
          </div>
        ))
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    </svg>
  )
}

function MonitorIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  )
}

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const

function Appearance() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme)

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      if (readTheme() === "system") applyTheme("system")
    }
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  function choose(next: ThemeChoice) {
    setChoice(next)
    writeTheme(next)
  }

  return (
    <fieldset className="tag-field">
      <legend>Color mode</legend>
      <p className="hint">Choose if Novaroom should be light or dark, or follow your computer’s settings.</p>
      <div className="theme-choices">
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            className="theme-choice"
            aria-pressed={choice === value}
            onClick={() => choose(value)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
