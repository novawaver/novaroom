import { inTauri } from "./desktop"

// Lets a page with unsaved changes (the Vault) step in before Novaroom quits or restarts.
// The page answers by asking the person, then calls proceed once they save or discard.
type ExitGuard = (proceed: () => void) => void

let guard: ExitGuard | null = null

/** Set while there are unsaved changes; null once they are saved or discarded. */
export function setExitGuard(next: ExitGuard | null) {
  const changed = (guard === null) !== (next === null)
  guard = next
  // Tells the tray's Quit whether it has to ask the window first.
  if (changed && inTauri()) {
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("set_unsaved_changes", { unsaved: next !== null }).catch(() => {}),
    )
  }
}

/** Runs proceed now, or once the person has dealt with unsaved changes. */
export function beforeExit(proceed: () => void) {
  if (guard) guard(proceed)
  else proceed()
}

/** Handles Quit from the tray while there are unsaved changes. Returns a function that stops listening. */
export async function listenForQuit() {
  if (!inTauri()) return () => {}
  const [{ listen }, { invoke }] = await Promise.all([import("@tauri-apps/api/event"), import("@tauri-apps/api/core")])
  return listen("quit-requested", () => beforeExit(() => void invoke("quit_app")))
}
