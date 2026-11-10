import { lazy, type ComponentType, type LazyExoticComponent } from "react"
import type { RoomInfo, RoomPageData, RoomSubmission } from "../../lib/rooms"
import type { Session } from "../../types"

/**
 * Props every custom room page receives. RoomPage loads the room's standard data (page text, form,
 * the viewer's own submissions, links, members) and hands it in, so a page can render that however
 * it likes and still reach the database itself through `session` and `room.id`.
 */
export type RoomPageModuleProps = {
  session: Session
  room: RoomInfo
  data: RoomPageData
  /** Re-run the standard room load, e.g. after writing something. */
  reload: () => void
  /** Open a link the Novaroom-safe way (a browser tab, or the opener plugin on desktop). */
  onOpenLink: (url: string) => void
  /** Presence class ("online" | "idle" | "") for a member id, when the room view knows it. */
  presenceOf?: (userId: string) => string
  /** Send one filled-in room form; resolves with the stored submission. */
  onSubmitForm: (answers: Record<string, string>) => Promise<RoomSubmission>
}

export type RoomPageModule = ComponentType<RoomPageModuleProps>

/**
 * Custom, code-built pages for specific rooms, keyed by the room's web-address slug (set in the
 * admin site under Rooms → Web address, or derived from the title in local preview). A room with an
 * entry here shows this component in its main area instead of the plain Markdown page; every other
 * room falls back to the Markdown page. The room's chat still sits beside it either way.
 *
 * To add one:
 *   1. Give the room a slug in the admin site, e.g. "earn-reward-aicredits".
 *   2. Create src/screens/rooms/<slug>.tsx with a default export of type RoomPageModule.
 *   3. Add a line below. The import stays lazy, so a page's code only loads when its room is opened.
 *   4. If the page needs its own data, add a Supabase migration for it and query it from the page.
 *
 * Keep the no-secrets rule: a room page never asks for passwords, API keys or other credentials.
 */
const PAGES: Record<string, LazyExoticComponent<RoomPageModule>> = {
  "earn-reward-aicredits": lazy(() => import("./earn-reward-aicredits")),
}

/** The custom page for a room slug, or null to fall back to the Markdown page. */
export function getRoomPage(slug: string | null | undefined): LazyExoticComponent<RoomPageModule> | null {
  if (!slug) return null
  return PAGES[slug] ?? null
}
