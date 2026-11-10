import { Suspense, useCallback, useEffect, useState } from "react"
import { Markdown } from "../lib/markdown"
import { loadRoomPage, submitRoomForm, type RoomInfo, type RoomPageData } from "../lib/rooms"
import { watchConversation } from "../lib/safety"
import type { Session } from "../types"
import { RoomFormCard } from "./RoomFormCard"
import { getRoomPage } from "./rooms"

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function formatUpdated(value: string) {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

const spinner = (
  <div className="thread-loading" role="status" aria-label="Loading the room">
    <span className="loading-spinner" aria-hidden="true" />
  </div>
)

/**
 * A topic room's own page, in the main area. A room whose slug has a custom page (src/screens/rooms)
 * shows that; every other room shows the Markdown page an admin wrote for it, then its form, links
 * and members. The room's chat sits beside it (AppShell draws that).
 */
export function RoomPage({
  session,
  room,
  busy,
  error,
  onJoin,
  onLeave,
  onOpenLink,
  presenceOf,
}: {
  session: Session
  room: RoomInfo
  busy: boolean
  error: string
  onJoin: () => void
  onLeave: () => void
  onOpenLink: (url: string) => void
  presenceOf?: (userId: string) => string
}) {
  const [data, setData] = useState<RoomPageData | null>(null)
  const [loadError, setLoadError] = useState("")

  const reload = useCallback(async () => {
    try {
      setData(await loadRoomPage(session, room.id))
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "Could not load this room.")
    }
  }, [session, room.id])

  const onSubmitForm = useCallback(
    (answers: Record<string, string>) => submitRoomForm(session, room.id, answers),
    [session, room.id],
  )

  useEffect(() => {
    let active = true
    setData(null)
    setLoadError("")
    const run = () =>
      void loadRoomPage(session, room.id)
        .then((next) => {
          if (active) setData(next)
        })
        .catch((caught: unknown) => {
          if (active) setLoadError(caught instanceof Error ? caught.message : "Could not load this room.")
        })
    run()
    // An admin may save a new page while it is open.
    const stop = watchConversation(room.id, run)
    return () => {
      active = false
      stop()
    }
    // Joining or leaving changes what can be read (form, links and members are for members only).
  }, [session, room.id, room.joined])

  const CustomPage = getRoomPage(room.slug)

  return (
    <section className="room-page" aria-label={`${room.title} room`}>
      <header className="room-page-head">
        <span className="avatar room-page-avatar" aria-hidden="true">
          <span>{initials(room.title)}</span>
        </span>
        <div className="room-page-title">
          <h1>{room.title}</h1>
          <p>{room.description}</p>
        </div>
        {room.joined ? (
          <button type="button" className="button secondary" disabled={busy} onClick={onLeave}>
            Leave
          </button>
        ) : (
          <button type="button" className="button" disabled={busy} onClick={onJoin}>
            {busy ? "Joining…" : "Join room"}
          </button>
        )}
      </header>
      <div className="room-page-scroll">
        {(error || loadError) && (
          <p className="form-error" role="alert">
            {error || loadError}
          </p>
        )}
        {!data && !loadError ? (
          spinner
        ) : data ? (
          CustomPage ? (
            <Suspense fallback={spinner}>
              <CustomPage
                session={session}
                room={room}
                data={data}
                reload={() => void reload()}
                onOpenLink={onOpenLink}
                presenceOf={presenceOf}
                onSubmitForm={onSubmitForm}
              />
            </Suspense>
          ) : (
            <>
              <article className="room-page-content">
                {data.page ? (
                  <Markdown text={data.page} className="markdown" onOpenLink={onOpenLink} />
                ) : (
                  <p className="room-page-empty">This room doesn't have a page yet.</p>
                )}
                {data.page && data.updatedAt && (
                  <p className="room-page-updated">Page updated {formatUpdated(data.updatedAt)}</p>
                )}
              </article>
              {room.joined && data.form && (
                <RoomFormCard
                  form={data.form}
                  mySubmissions={data.mySubmissions}
                  onSubmit={onSubmitForm}
                  onSubmitted={(submission) =>
                    setData((current) =>
                      current ? { ...current, mySubmissions: [submission, ...current.mySubmissions] } : current,
                    )
                  }
                />
              )}
              {room.joined ? (
                <div className="room-page-extras">
                  <section className="room-page-section" aria-labelledby="room-links-title">
                    <h2 id="room-links-title">Links</h2>
                    {data.links.length === 0 ? (
                      <p className="room-page-none">No links yet.</p>
                    ) : (
                      <ul className="room-links">
                        {data.links.map((link) => (
                          <li key={link.id}>
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              onClick={(event) => {
                                event.preventDefault()
                                onOpenLink(link.url)
                              }}
                            >
                              <strong>{link.title}</strong>
                              <span>{hostOf(link.url)}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <section className="room-page-section" aria-labelledby="room-members-title">
                    <h2 id="room-members-title">
                      Members <span className="room-page-count">{data.members.length}</span>
                    </h2>
                    <ul className="room-members">
                      {data.members.map((member) => (
                        <li key={member.id} title={member.name}>
                          <span className="room-member-photo">
                            <span className="avatar room-member-avatar">
                              {member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : <span>{initials(member.name)}</span>}
                            </span>
                            {presenceOf && <span className={`presence-dot room-member-presence ${presenceOf(member.id)}`} />}
                          </span>
                          <span className="room-member-name">
                            {member.name}
                            {member.id === session.userId && <span className="room-member-you"> (you)</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              ) : (
                <p className="room-page-join-note">
                  Join the room to chat with its members{data.form ? ", fill in its form" : ""} and see its links.
                </p>
              )}
            </>
          )
        ) : null}
      </div>
    </section>
  )
}

function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return url
  }
}
