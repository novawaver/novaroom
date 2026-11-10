import { Markdown } from "../../lib/markdown"
import { RoomFormCard } from "../RoomFormCard"
import type { RoomPageModuleProps } from "./index"

function shortDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

/**
 * Custom page for the Earn room (slug "earn-reward-aicredits"). It lays out the admin-written page,
 * a small summary of the member's own task submissions, and the room's submission form. It only
 * reads and writes data the member already owns (their own submissions) and never asks for secrets.
 *
 * This is the reference example for a code-built room page: a plain React component that is handed
 * the standard room data and renders it its own way. Copy it to add a page for another room.
 */
export default function EarnRewardAicredits({ room, data, reload, onOpenLink, onSubmitForm }: RoomPageModuleProps) {
  const mine = data.mySubmissions
  const latest = mine[0]?.createdAt

  return (
    <div className="room-custom">
      {data.page && (
        <article className="room-page-content">
          <Markdown text={data.page} className="markdown" onOpenLink={onOpenLink} />
        </article>
      )}

      {room.joined ? (
        <>
          <section className="room-stats" aria-label="Your activity in this room">
            <div className="room-stat">
              <span className="room-stat-num">{mine.length}</span>
              <span className="room-stat-label">{mine.length === 1 ? "task submitted" : "tasks submitted"}</span>
            </div>
            <div className="room-stat">
              <span className="room-stat-num">{latest ? shortDate(latest) : "—"}</span>
              <span className="room-stat-label">last submission</span>
            </div>
          </section>

          {data.form && (
            <RoomFormCard
              form={data.form}
              mySubmissions={mine}
              onSubmit={onSubmitForm}
              onSubmitted={() => reload()}
            />
          )}
        </>
      ) : (
        <p className="room-page-join-note">Join the room to submit tasks and track your payouts.</p>
      )}
    </div>
  )
}
