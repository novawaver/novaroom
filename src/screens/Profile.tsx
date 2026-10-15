import { useEffect, useRef, useState, type FormEvent } from "react"
import { useAuth } from "../auth"
import { readAvatarFile } from "../lib/image"
import type { ChatSummary } from "../lib/chats"
import { LEADERSHIP } from "../lib/leaddesk"
import { isSupabaseConfigured } from "../lib/supabase"
import { ROLES, type Profile as ProfileData } from "../types"

// Only admins grant Leadership (enforced in the database). Offline preview has no admins, so it stays selectable there.
const SELF_ROLES = isSupabaseConfigured ? ROLES.filter((role) => role !== LEADERSHIP) : ROLES

export type ProfileTab = "edit" | "contacts" | "starred"

export const PROFILE_TABS: Array<{ id: ProfileTab; label: string }> = [
  { id: "edit", label: "Edit profile" },
  { id: "contacts", label: "Contacts" },
  { id: "starred", label: "Starred messages" },
]

function initials(name: string, email: string) {
  const source = name.trim() || email
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

export function Profile({
  tab,
  contacts,
  chatCount,
  onBack,
  onOpenChat,
  onSelectTab,
}: {
  tab: ProfileTab
  contacts: ChatSummary[]
  chatCount: number
  onBack: () => void
  onOpenChat: (chatId: string) => void
  onSelectTab: (tab: ProfileTab) => void
}) {
  const { profile } = useAuth()
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const label = tab === "edit" ? "Personal Profile" : PROFILE_TABS.find((item) => item.id === tab)?.label
  const formOpen = tab === "edit" && (editing || !profile)

  useEffect(() => {
    if (tab !== "edit") setEditing(false)
  }, [tab])

  useEffect(() => {
    if (!menuOpen) return
    function onPointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false)
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [menuOpen])

  function pick(next: ProfileTab) {
    setMenuOpen(false)
    setEditing(false)
    onSelectTab(next)
  }

  return (
    <section className="settings">
      <header className="thread-bar profile-bar">
        <h1>{label}</h1>
        {formOpen ? (
          <div className="profile-bar-actions">
            {profile && (
              <button type="button" className="button secondary" disabled={saving} onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
            <button type="submit" form="profile-form" className="button" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        ) : (
          <div className="profile-bar-actions" ref={menuRef}>
            <button
              type="button"
              className="bar-icon"
              aria-label="Edit profile"
              title="Edit profile"
              aria-pressed={tab === "edit" && editing}
              onClick={() => {
                setMenuOpen(false)
                onSelectTab("edit")
                setEditing(true)
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M11 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13" />
                <path d="M17.6 3.9a2 2 0 0 1 2.8 2.8L12.5 14.6 9 15.5l.9-3.5 7.7-8.1z" />
              </svg>
            </button>
            <button
              type="button"
              className="bar-icon danger"
              aria-label="Delete account"
              title="Delete account"
              onClick={() => {
                setMenuOpen(false)
                setDeleting(true)
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l.9 12.6a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.6" />
                <path d="M10 10.5v6M14 10.5v6" />
              </svg>
            </button>
            <button
              type="button"
              className="bar-icon"
              aria-label="Profile menu"
              title="Menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {menuOpen && (
              <div className="bar-menu" role="menu">
                {PROFILE_TABS.map(({ id, label: itemLabel }) => (
                  <button
                    key={id}
                    type="button"
                    role="menuitem"
                    aria-current={tab === id ? "page" : undefined}
                    onClick={() => pick(id)}
                  >
                    {itemLabel}
                  </button>
                ))}
                <hr />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    onBack()
                  }}
                >
                  Back to messages
                </button>
              </div>
            )}
          </div>
        )}
      </header>
      {tab === "edit" && (
        <EditProfile
          key={editing ? "form" : "card"}
          editing={editing}
          chatCount={chatCount}
          contactCount={contacts.length}
          onEditingChange={setEditing}
          onSavingChange={setSaving}
        />
      )}
      {tab === "contacts" && <Contacts contacts={contacts} onOpenChat={onOpenChat} />}
      {tab === "starred" && (
        <div className="settings-panel">
          <p className="hint">No starred messages yet.</p>
        </div>
      )}
      {deleting && <DeleteAccountDialog onClose={() => setDeleting(false)} />}
    </section>
  )
}

// Confirms before deleting the signed-in account for good.
function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const { deleteAccount } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [busy, onClose])

  return (
    <div
      className="desk-backdrop"
      onPointerDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <div className="desk-modal" role="alertdialog" aria-labelledby="delete-account-title">
        <h2 id="delete-account-title">Delete your account?</h2>
        <p className="hint">
          This deletes your login, profile, and the contents of your messages. It can't be undone.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            className="button danger"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError("")
              void deleteAccount().catch((caught) => {
                setError(caught instanceof Error ? caught.message : "Could not delete your account.")
                setBusy(false)
              })
            }}
          >
            {busy ? "Deleting…" : "Delete my account"}
          </button>
        </div>
      </div>
    </div>
  )
}

function Contacts({
  contacts,
  onOpenChat,
}: {
  contacts: ChatSummary[]
  onOpenChat: (chatId: string) => void
}) {
  if (contacts.length === 0) {
    return (
      <div className="settings-panel">
        <p className="hint">People you chat with directly appear here.</p>
      </div>
    )
  }
  return (
    <div className="settings-panel contact-list">
      {contacts.map((chat) => (
        <button key={chat.id} type="button" className="contact-row" onClick={() => onOpenChat(chat.id)}>
          <span className="avatar">
            {chat.avatarUrl ? <img src={chat.avatarUrl} alt="" /> : <span>{initials(chat.title, "")}</span>}
          </span>
          <span className="profile-chip-text">
            <strong>{chat.title}</strong>
            <span>{chat.detail}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
function splitList(text: string) {
  const seen = new Set<string>()
  return text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLowerCase()
      if (!item || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 12)
}

function SkillChips({
  values,
  editing,
  onChange,
}: {
  values: string[]
  editing: boolean
  onChange: (values: string[]) => void
}) {
  const [draft, setDraft] = useState("")

  function add() {
    const next = draft.trim()
    setDraft("")
    if (!next || values.length >= 12) return
    if (values.some((value) => value.toLowerCase() === next.toLowerCase())) return
    onChange([...values, next])
  }

  if (!editing && values.length === 0) return <p className="profile-field-empty">Not added yet</p>

  return (
    <div className="profile-chips">
      {values.map((skill, index) => (
        <span key={skill} className={`profile-chip tone-${index % 3}`}>
          {skill}
          {editing && (
            <button
              type="button"
              className="profile-chip-remove"
              aria-label={`Remove ${skill}`}
              onClick={() => onChange(values.filter((item) => item !== skill))}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {editing && values.length < 12 && (
        <input
          className="profile-chip-input"
          aria-label="Add skill"
          placeholder="+ Add skill"
          value={draft}
          maxLength={40}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={add}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault()
              add()
            }
          }}
        />
      )}
    </div>
  )
}

function ListField({
  label,
  values,
  text,
  editing,
  placeholder,
  onChange,
}: {
  label: string
  values: string[]
  text: string
  editing: boolean
  placeholder: string
  onChange: (text: string) => void
}) {
  return (
    <div className="profile-field">
      <p className="profile-field-label">{label}</p>
      {editing ? (
        <input
          className="profile-input"
          aria-label={label}
          value={text}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : values.length > 0 ? (
        <p className="profile-field-value">{values.join(", ")}</p>
      ) : (
        <p className="profile-field-empty">Not added yet</p>
      )}
    </div>
  )
}

function EditProfile({
  editing: editingProp,
  chatCount,
  contactCount,
  onEditingChange: setEditing,
  onSavingChange,
}: {
  editing: boolean
  chatCount: number
  contactCount: number
  onEditingChange: (editing: boolean) => void
  onSavingChange: (saving: boolean) => void
}) {
  const { session, profile, saveProfile } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const start: ProfileData = profile ?? {
    displayName: "",
    role: "",
    status: "",
    avatarUrl: null,
    skills: [],
    languages: [],
    domains: [],
  }
  const [draft, setDraft] = useState<ProfileData>(start)
  const [languagesText, setLanguagesText] = useState(start.languages.join(", "))
  const [domainsText, setDomainsText] = useState(start.domains.join(", "))
  const [error, setError] = useState("")
  const editing = editingProp || !profile

  if (!session) return null

  const shown = editing ? draft : start

  async function onPhoto(file: File | undefined) {
    if (!file) return
    setError("")
    try {
      const avatarUrl = await readAvatarFile(file)
      setDraft((current) => ({ ...current, avatarUrl }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not use that image.")
    }
  }

  async function onSave(event: FormEvent) {
    event.preventDefault()
    onSavingChange(true)
    setError("")
    try {
      await saveProfile({
        ...draft,
        displayName: draft.displayName.trim(),
        status: draft.status.trim(),
        languages: splitList(languagesText),
        domains: splitList(domainsText),
      })
      setEditing(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your profile.")
    } finally {
      onSavingChange(false)
    }
  }

  const avatar = shown.avatarUrl ? (
    <img src={shown.avatarUrl} alt="" />
  ) : (
    <span>{initials(shown.displayName, session.email)}</span>
  )

  return (
    <form id="profile-form" className={editing ? "profile-card editing" : "profile-card"} onSubmit={onSave}>
      <div className="profile-hero">
        {editing ? (
          <button
            type="button"
            className="avatar profile-avatar"
            aria-label="Change photo"
            onClick={() => fileRef.current?.click()}
          >
            {avatar}
            <span className="profile-avatar-change">Change</span>
          </button>
        ) : (
          <span className="avatar profile-avatar">{avatar}</span>
        )}
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
        <div className="profile-stats">
          <div className="profile-stat cool">
            <strong>{chatCount}</strong>
            <span>Chats</span>
          </div>
          <div className="profile-stat warm">
            <strong>{contactCount}</strong>
            <span>Contacts</span>
          </div>
        </div>
      </div>
      {editing ? (
        <textarea
          className="profile-bio profile-input"
          aria-label="Short status"
          rows={2}
          maxLength={80}
          placeholder="Write a short status"
          value={draft.status}
          onChange={(event) => setDraft({ ...draft, status: event.target.value })}
        />
      ) : (
        shown.status && <p className="profile-bio">{shown.status}</p>
      )}
      <div className="profile-field">
        <p className="profile-field-label">Name</p>
        {editing ? (
          <input
            className="profile-input"
            aria-label="Name"
            value={draft.displayName}
            maxLength={40}
            required
            onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
          />
        ) : shown.displayName ? (
          <p className="profile-field-value">{shown.displayName}</p>
        ) : (
          <p className="profile-field-empty">Not added yet</p>
        )}
      </div>
      <div className="profile-field">
        <p className="profile-field-label">Role</p>
        {editing && start.role === LEADERSHIP && isSupabaseConfigured ? (
          <p className="profile-field-value">
            {LEADERSHIP} <span className="profile-field-note">Set by an admin</span>
          </p>
        ) : editing ? (
          <select
            className="profile-input"
            aria-label="Role"
            value={draft.role}
            onChange={(event) => setDraft({ ...draft, role: event.target.value })}
          >
            <option value="">No role</option>
            {SELF_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
            {draft.role && !SELF_ROLES.includes(draft.role) && <option value={draft.role}>{draft.role}</option>}
          </select>
        ) : shown.role ? (
          <p className="profile-field-value">{shown.role}</p>
        ) : (
          <p className="profile-field-empty">Not added yet</p>
        )}
      </div>
      <div className="profile-field">
        <p className="profile-field-label">Email</p>
        <p className="profile-field-value">{session.email}</p>
      </div>
      <div className="profile-field">
        <p className="profile-field-label">Skills</p>
        <SkillChips
          values={shown.skills}
          editing={editing}
          onChange={(skills) => setDraft({ ...draft, skills })}
        />
      </div>
      <ListField
        label="Knowledge of languages"
        values={shown.languages}
        text={languagesText}
        editing={editing}
        placeholder="English, Spanish"
        onChange={setLanguagesText}
      />
      <ListField
        label="Domains"
        values={shown.domains}
        text={domainsText}
        editing={editing}
        placeholder="Coding, math, rating"
        onChange={setDomainsText}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
