import { useEffect, useRef, useState } from "react"
import { onNotificationClick, setUnreadBadge } from "../lib/desktop"
import { onOpenVaultShare } from "../lib/vaultShare"
import type { Session } from "../types"
import { CaptureRail, NAV_EXPANDED_KEY, NAV_ITEMS, NavBar, VaultRail, readNavExpanded } from "./AppShell"
import { Capture, type CaptureState, type CaptureTab } from "./Capture"
import { LocalChatRail, LocalChatThread, type LocalChatState } from "./LocalChat"
import { RailResize } from "./RailResize"
import { VoiceCallBar, useVoiceCall } from "./VoiceCall"
import { Vault, VaultLeaveDialog, useVault } from "./Vault"

// The last four need the server: their page only says so.
type OfflineView = "local" | "vault" | "capture" | "rooms" | "people" | "timer" | "settings"

/**
 * The whole app without the server: Local chat, Vault and Capture, which all keep everything on
 * this computer. `chosen` means the person picked offline mode on the sign-in screen; otherwise the app
 * opened without internet and the full app takes over once the server is reached again.
 */
export function OfflineShell({
  local,
  capture,
  session,
  chosen,
  onSignOut,
}: {
  local: LocalChatState
  capture: CaptureState
  session: Session
  chosen: boolean
  onSignOut: () => void
}) {
  const [view, setView] = useState<OfflineView>("local")
  const [captureTab, setCaptureTab] = useState<CaptureTab>("record")
  // The same nav bar as online, with the same remembered width.
  const [navExpanded, setNavExpanded] = useState(readNavExpanded)
  const vault = useVault(session.userId, view === "vault")
  // Without internet, calls still work with people on the same network.
  const voice = useVoiceCall(session, true)
  // Leaving the Vault with unsaved changes first asks whether to save or discard them.
  const leaveTo = (go: () => void) => (view === "vault" ? vault.guard(go) : go())
  const { select } = local

  // Clicking a Local chat notification opens that chat. Kept in a ref so the listener sees the
  // current view without being added again on every render.
  const openChatRef = useRef<(chat: string) => void>(() => {})
  openChatRef.current = (chat) =>
    leaveTo(() => {
      select(chat)
      setView("local")
    })
  useEffect(
    () =>
      onNotificationClick((target) => {
        if (target.startsWith("local:")) openChatRef.current(target.slice("local:".length))
      }),
    [],
  )

  // A link to shared data in a chat opens the Vault's page for it.
  const { openShared } = vault
  useEffect(
    () =>
      onOpenVaultShare((id) => {
        openShared(id)
        setView("vault")
      }),
    [openShared],
  )

  // Only Local chat can have unread messages offline.
  useEffect(() => {
    void setUnreadBadge(local.unreadTotal)
  }, [local.unreadTotal])
  useEffect(() => () => void setUnreadBadge(0), [])

  const pageName = NAV_ITEMS.find(({ id }) => id === view)?.label ?? "This page"

  return (
    <div className="offline-shell">
      <p className="offline-banner" role="status">
        {chosen ? (
          <>
            <strong>Offline mode.</strong> Local chat, Vault and Capture work without the server. Sign in to use everything else.
          </>
        ) : (
          <>
            <strong>No internet connection.</strong> Local chat, Vault and Capture still work. Everything else comes back once
            Novaroom reaches the server again.
          </>
        )}
        <button type="button" className="text-button" onClick={() => leaveTo(onSignOut)}>
          {chosen ? "Sign in" : "Sign out"}
        </button>
      </p>
      <div className={navExpanded ? "shell offline-shell-body nav-open" : "shell offline-shell-body"}>
        <NavBar
          expanded={navExpanded}
          onToggle={() => {
            const next = !navExpanded
            setNavExpanded(next)
            try {
              localStorage.setItem(NAV_EXPANDED_KEY, String(next))
            } catch {
              // Not remembered; the bar still opens and closes.
            }
          }}
          active={view === "local" ? "chats" : view}
          showLeadDesk={false}
          badges={{ chats: local.unreadTotal }}
          live={capture.live ? { capture: "Recording" } : undefined}
          onSelect={(item) => {
            if (item === "leaddesk") return
            const next: OfflineView = item === "chats" ? "local" : item
            if (next === "vault" && view === "vault") vault.selectTable(vault.data?.tables[0]?.id ?? null)
            else if (next !== view) leaveTo(() => setView(next))
          }}
        />
        <RailResize />
        <aside className="rail">
          {view === "local" ? (
            <LocalChatRail local={local} />
          ) : view === "capture" ? (
            <CaptureRail capture={capture} tab={captureTab} onSelect={setCaptureTab} />
          ) : view === "vault" ? (
            <VaultRail vault={vault} />
          ) : (
            <>
              <div className="rail-head">
                <p className="list-label">{pageName}</p>
              </div>
              <p className="offline-only-rail">Available when you are online.</p>
            </>
          )}
        </aside>
        {view === "local" ? (
          <LocalChatThread local={local} userId={session.userId} voice={voice} />
        ) : view === "capture" ? (
          <Capture tab={captureTab} capture={capture} />
        ) : view === "vault" ? (
          <Vault vault={vault} />
        ) : (
          <section className="thread">
            <div className="thread-empty" role="status">
              <h2>{pageName} is only available online</h2>
              <p>
                {chosen
                  ? "This page needs the Novaroom server. Sign in to use it."
                  : "This page needs the Novaroom server. It comes back once Novaroom is connected again."}
              </p>
            </div>
          </section>
        )}
      </div>
      <VaultLeaveDialog vault={vault} />
      <VoiceCallBar voice={voice} />
    </div>
  )
}
