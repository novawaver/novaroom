import { useEffect, useRef, useState, type FormEvent } from "react"
import { useAuth } from "../auth"
import { APP_VERSION, PRIVACY, TERMS } from "../legal"
import { readAvatarFile } from "../lib/image"
import { listBlocked, unblockUser, type BlockedPerson } from "../lib/safety"
import { applyTheme, readTheme, writeTheme, type ThemeChoice } from "../lib/theme"
import type { Profile } from "../types"

function initials(name: string, email: string) {
  const source = name.trim() || email
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

function TagField({
  label,
  hint,
  values,
  onChange,
}: {
  label: string
  hint: string
  values: string[]
  onChange: (values: string[]) => void
}) {
  const [draft, setDraft] = useState("")

  function add() {
    const next = draft.trim()
    if (!next) return
    if (values.some((value) => value.toLowerCase() === next.toLowerCase())) {
      setDraft("")
      return
    }
    if (values.length >= 12) return
    onChange([...values, next])
    setDraft("")
  }

  return (
    <fieldset className="tag-field">
      <legend>{label}</legend>
      <p className="hint">{hint}</p>
      <div className="tags">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            className="tag"
            onClick={() => onChange(values.filter((item) => item !== value))}
          >
            {value}
            <span className="tag-remove">Remove</span>
          </button>
        ))}
      </div>
      <div className="tag-add">
        <input
          aria-label={`Add ${label.toLowerCase()}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className="button secondary" onClick={add}>
          Add
        </button>
      </div>
    </fieldset>
  )
}

export function Settings({ onBack }: { onBack: () => void }) {
  const { session, profile, saveProfile, signOut } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<Profile>(
    profile ?? {
      displayName: "",
      status: "",
      avatarUrl: null,
      skills: [],
      languages: [],
      domains: [],
    },
  )
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!session) return null

  async function onPhoto(file: File | undefined) {
    if (!file) return
    setError("")
    setSaved(false)
    try {
      const avatarUrl = await readAvatarFile(file)
      setDraft((current) => ({ ...current, avatarUrl }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not use that image.")
    }
  }

  async function onSave(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setSaved(false)
    try {
      await saveProfile({
        ...draft,
        displayName: draft.displayName.trim(),
        status: draft.status.trim(),
      })
      setSaved(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your profile.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings">
      <header className="thread-bar">
        <button type="button" className="text-button" onClick={onBack}>
          Messages
        </button>
        <h1>Profile</h1>
      </header>
      <form className="settings-form" onSubmit={onSave}>
        <Appearance />
        <div className="photo-row">
          <button
            type="button"
            className="avatar large"
            onClick={() => fileRef.current?.click()}
          >
            {draft.avatarUrl ? (
              <img src={draft.avatarUrl} alt="" />
            ) : (
              <span>{initials(draft.displayName, session.email)}</span>
            )}
          </button>
          <div>
            <p className="photo-label">Photo</p>
            <button type="button" className="button secondary" onClick={() => fileRef.current?.click()}>
              Choose image
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                void onPhoto(event.target.files?.[0])
                event.target.value = ""
              }}
            />
          </div>
        </div>
        <label>
          Name
          <input
            value={draft.displayName}
            maxLength={40}
            onChange={(event) => {
              setSaved(false)
              setDraft({ ...draft, displayName: event.target.value })
            }}
            required
          />
        </label>
        <label>
          Short status
          <input
            value={draft.status}
            maxLength={80}
            placeholder="Available for writing tasks"
            onChange={(event) => {
              setSaved(false)
              setDraft({ ...draft, status: event.target.value })
            }}
          />
        </label>
        <TagField
          label="Skills"
          hint="What you work on. Click a tag to remove it."
          values={draft.skills}
          onChange={(skills) => {
            setSaved(false)
            setDraft({ ...draft, skills })
          }}
        />
        <TagField
          label="Languages"
          hint="Languages you can work in."
          values={draft.languages}
          onChange={(languages) => {
            setSaved(false)
            setDraft({ ...draft, languages })
          }}
        />
        <TagField
          label="Domains"
          hint="Areas you know well, such as coding, math, or rating."
          values={draft.domains}
          onChange={(domains) => {
            setSaved(false)
            setDraft({ ...draft, domains })
          }}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {saved && <p className="form-ok">Profile saved.</p>}
        <div className="form-actions">
          <button type="submit" className="button" disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              void signOut()
            }}
          >
            Sign out
          </button>
        </div>
      </form>
      <AboutNovaroom />
      <AccountSafety />
    </section>
  )
}

function AboutNovaroom() {
  const [doc, setDoc] = useState<"privacy" | "terms" | null>(null)
  const pages = { privacy: PRIVACY, terms: TERMS }

  return (
    <div className="settings-form about-zone">
      <h2>About</h2>
      <p className="hint">Novaroom {APP_VERSION}. For people 18 and older.</p>
      <div className="form-actions about-actions">
        <button
          type="button"
          className="button secondary"
          aria-expanded={doc === "privacy"}
          onClick={() => setDoc(doc === "privacy" ? null : "privacy")}
        >
          Privacy policy
        </button>
        <button
          type="button"
          className="button secondary"
          aria-expanded={doc === "terms"}
          onClick={() => setDoc(doc === "terms" ? null : "terms")}
        >
          Terms
        </button>
      </div>
      {doc && (
        <div className="legal">
          {pages[doc].map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      )}
    </div>
  )
}

function AccountSafety() {
  const { session, deleteAccount } = useAuth()
  const [blocked, setBlocked] = useState<BlockedPerson[]>([])
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

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
    <div className="settings-form danger-zone">
      <h2>Safety</h2>
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
      <h2>Delete account</h2>
      <p className="hint">
        This deletes your login, profile, and the contents of your messages. It cannot be undone.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {confirming ? (
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="button danger"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError("")
              void deleteAccount()
                .catch((caught) => {
                  setError(caught instanceof Error ? caught.message : "Could not delete your account.")
                  setBusy(false)
                })
            }}
          >
            {busy ? "Deleting…" : "Yes, delete my account"}
          </button>
        </div>
      ) : (
        <button type="button" className="button danger" onClick={() => setConfirming(true)}>
          Delete account
        </button>
      )}
    </div>
  )
}

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
      <legend>Appearance</legend>
      <div className="theme-choices">
        {(
          [
            ["system", "System"],
            ["light", "Light"],
            ["dark", "Dark"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="button secondary"
            aria-pressed={choice === value}
            onClick={() => choose(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
