import { useEffect, useRef, useState } from "react"
import { onNotificationClick } from "../lib/desktop"
import type { Session } from "../types"
import { VaultRail } from "./AppShell"
import { LocalChatRail, LocalChatThread, type LocalChatState } from "./LocalChat"
import { Vault, VaultLeaveDialog, useVault } from "./Vault"

type OfflineView = "local" | "vault"

/**
 * The whole app without the server: Local chat and Vault, which both keep everything on this
 * computer. `chosen` means the person picked offline mode on the sign-in screen; otherwise the app
 * opened without internet and the full app takes over once the server is reached again.
 */
export function OfflineShell({
  local,
  session,
  chosen,
  onSignOut,
}: {
  local: LocalChatState
  session: Session
  chosen: boolean
  onSignOut: () => void
}) {
  const [view, setView] = useState<OfflineView>("local")
  const vault = useVault(session.userId, view === "vault")
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

  const tabs: Array<{ id: OfflineView; label: string; hint: string; count: number }> = [
    { id: "local", label: "Local chat", hint: "Chats with people on this network", count: local.unreadTotal },
    { id: "vault", label: "Vault", hint: "Your tables, kept on this computer", count: 0 },
  ]

  return (
    <div className="offline-shell">
      <p className="offline-banner" role="status">
        {chosen ? (
          <>
            <strong>Offline mode.</strong> Local chat and Vault work without the server. Sign in to use everything else.
          </>
        ) : (
          <>
            <strong>No internet connection.</strong> Local chat and Vault still work. Everything else comes back once
            Novaroom reaches the server again.
          </>
        )}
        <button type="button" className="text-button" onClick={() => leaveTo(onSignOut)}>
          {chosen ? "Sign in" : "Sign out"}
        </button>
      </p>
      <div className="shell offline-shell-body">
        <aside className="rail">
          <div className="chat-mode" role="tablist" aria-label="Offline tools">
            {tabs.map(({ id, label, hint, count }) => (
              <button
                key={id}
                type="button"
                role="tab"
                className="chat-mode-tab"
                aria-selected={view === id}
                title={hint}
                onClick={() => {
                  if (id === "vault" && view === "vault") vault.selectTable(vault.data?.tables[0]?.id ?? null)
                  else if (id !== view) leaveTo(() => setView(id))
                }}
              >
                {label}
                {count > 0 && view !== id && <span className="chat-mode-count">{count > 9 ? "9+" : count}</span>}
              </button>
            ))}
          </div>
          {view === "local" ? <LocalChatRail local={local} /> : <VaultRail vault={vault} />}
        </aside>
        {view === "local" ? <LocalChatThread local={local} userId={session.userId} /> : <Vault vault={vault} />}
      </div>
      <VaultLeaveDialog vault={vault} />
    </div>
  )
}
