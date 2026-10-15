import { useAuth } from "../auth"
import { useState } from "react"
import type { RegisteredUser } from "../lib/users"
import { ROLES } from "../types"
import { LEADERSHIP } from "../lib/leaddesk"

const ACCENTS = ["violet", "green", "indigo", "blue", "amber", "red"]

// "all", "none" (users without a known role), or one of ROLES.
export type PeopleFilter = string

export const PEOPLE_FILTERS: Array<{ id: PeopleFilter; label: string }> = [
  { id: "all", label: "All" },
  ...ROLES.map((role) => ({ id: role, label: role })),
  { id: "none", label: "No role yet" },
]

export function matchesFilter(user: RegisteredUser, filter: PeopleFilter) {
  if (filter === "all") return true
  if (filter === "none") return !ROLES.includes(user.role)
  return user.role === filter
}

function groupByRole(users: RegisteredUser[]) {
  return PEOPLE_FILTERS.filter(({ id }) => id !== "all")
    .map(({ id, label }) => ({ role: label, users: users.filter((user) => matchesFilter(user, id)) }))
    .filter((group) => group.users.length > 0)
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 1).toUpperCase() || "?"
}

function accentFor(userId: string) {
  let hash = 0
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return ACCENTS[hash % ACCENTS.length]
}

function UserCard({
  user,
  isSelf,
  onMessage,
}: {
  user: RegisteredUser
  isSelf: boolean
  // Present only when the viewer may start a chat with this person.
  onMessage?: () => void
}) {
  const name = user.displayName || "Unnamed user"
  const details = [...user.skills, ...user.languages, ...user.domains]
  return (
    <article className={`person-card accent-${accentFor(user.userId)}`}>
      <span className="person-head">
        <span className="person-title">
          <strong>{name}</strong>
          <span>{user.status || (isSelf ? "This is you" : "No status yet")}</span>
          {isSelf && <span className="person-tag">You</span>}
        </span>
        <span className="person-photo">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span>{initials(name)}</span>}
          {user.avatarUrl && <span className="person-corner" />}
        </span>
      </span>
      <span className="person-rule" />
      <span className="person-details">{details.length > 0 ? details.join(", ") : "No skills listed yet."}</span>
      {/* Always present, even when empty, so every card is the same height. */}
      <span className="person-actions">
        {onMessage && (
          <button
            type="button"
            className="person-message"
            aria-label={`Start a chat with ${name}`}
            title="Start a chat"
            onClick={onMessage}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.2-4.2A8 8 0 1 1 21 12z" />
              <path d="M8.5 11h7M8.5 14.5h4.5" />
            </svg>
          </button>
        )}
      </span>
    </article>
  )
}

export function People({
  users,
  error,
  filter,
  canMessageLeaders,
  onMessage,
}: {
  users: RegisteredUser[] | null
  error: string
  filter: PeopleFilter
  // Leadership members can start a direct chat with other Leadership members from here.
  canMessageLeaders: boolean
  onMessage: (userId: string) => Promise<void>
}) {
  const { session } = useAuth()
  const [messageError, setMessageError] = useState("")
  // The person a chat is being opened with; shows a loading screen until the app moves to Chats.
  const [startingWith, setStartingWith] = useState<RegisteredUser | null>(null)

  if (!session) return null

  const messageHandler = (user: RegisteredUser) =>
    canMessageLeaders && user.role === LEADERSHIP && user.userId !== session.userId
      ? () => {
          if (startingWith) return
          setMessageError("")
          setStartingWith(user)
          // On success the app switches to Chats and this page goes away, so only failure clears it.
          void onMessage(user.userId).catch((caught) => {
            setStartingWith(null)
            setMessageError(caught instanceof Error ? caught.message : "Could not start that chat.")
          })
        }
      : undefined

  const label = PEOPLE_FILTERS.find((item) => item.id === filter)?.label ?? "People"
  const shown = users?.filter((user) => matchesFilter(user, filter)) ?? null

  return (
    <section className="settings">
      {startingWith && (
        <div className="people-loading" role="status" aria-live="polite">
          <span className="loading-spinner" aria-hidden="true" />
          <span>Opening your chat with {startingWith.displayName || "this person"}…</span>
        </div>
      )}
      <header className="thread-bar profile-bar">
        <h1>{filter === "all" ? "People" : label}</h1>
      </header>
      {messageError && (
        <p className="form-error people-note" role="alert">
          {messageError}
        </p>
      )}
      {error ? (
        <p className="form-error people-note" role="alert">
          {error}
        </p>
      ) : !shown ? (
        <div className="page-loading" role="status" aria-label="Loading people">
          <span className="loading-spinner" aria-hidden="true" />
        </div>
      ) : shown.length === 0 ? (
        <p className="hint people-note">{filter === "all" ? "No registered users yet." : "No one has this role yet."}</p>
      ) : filter !== "all" ? (
        <div className="people-grid people-grid-solo">
          {shown.map((user) => (
            <UserCard
                  key={user.userId}
                  user={user}
                  isSelf={user.userId === session.userId}
                  onMessage={messageHandler(user)}
                />
          ))}
        </div>
      ) : (
        groupByRole(shown).map((group) => (
          <div key={group.role}>
            <h2 className="people-section">
              {group.role}
              <span>{group.users.length}</span>
            </h2>
            <div className="people-grid">
              {group.users.map((user) => (
                <UserCard
                  key={user.userId}
                  user={user}
                  isSelf={user.userId === session.userId}
                  onMessage={messageHandler(user)}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  )
}
