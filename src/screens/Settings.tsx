import { useEffect, useState } from "react"
import { useAuth } from "../auth"
import { APP_VERSION, PRIVACY, TERMS } from "../legal"
import { listBlocked, unblockUser, type BlockedPerson } from "../lib/safety"
import { applyTheme, readTheme, writeTheme, type ThemeChoice } from "../lib/theme"

export type SettingsTab = "appearance" | "about" | "safety"

export const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "appearance", label: "Appearance" },
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
      {tab === "about" && <AboutNovaroom />}
      {tab === "safety" && <AccountSafety />}
    </section>
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
