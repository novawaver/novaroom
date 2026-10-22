import { inTauri } from "./desktop"

// The keyboard shortcut that brings the window forward from anywhere in Windows. The desktop app
// listens for it (see src-tauri/src/shortcut.rs); shortcuts are written like "Ctrl+Alt+S".

export const DEFAULT_OPEN_SHORTCUT = "Ctrl+Alt+S"

/** The saved shortcut ("" when turned off) and whether it works: another app may have it first. */
export type OpenShortcut = { shortcut: string; active: boolean }

async function call<T>(command: string, args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core")
  try {
    return await invoke<T>(command, args)
  } catch (caught) {
    throw new Error(typeof caught === "string" ? caught : "Could not change the shortcut.")
  }
}

export async function readOpenShortcut(): Promise<OpenShortcut | null> {
  if (!inTauri()) return null
  return call<OpenShortcut>("open_shortcut")
}

/** Saves and starts using a new shortcut; an empty one turns it off. Throws if it can't be used. */
export const writeOpenShortcut = (shortcut: string) => call<OpenShortcut>("set_open_shortcut", { shortcut })

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/

/** The shortcut for a key press, like "Ctrl+Shift+K", or null while only modifiers are held. */
export function shortcutFromKey(event: KeyboardEvent): string | null {
  if (!event.code || MODIFIER_CODES.test(event.code)) return null
  const key = event.code.replace(/^Key(?=[A-Z]$)/, "").replace(/^Digit(?=\d$)/, "")
  const parts = [
    event.ctrlKey && "Ctrl",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && "Super",
    key,
  ]
  return parts.filter(Boolean).join("+")
}

/** The keys of a shortcut as people know them, e.g. ["Ctrl", "Win", "S"]. */
export function shortcutKeys(shortcut: string) {
  return shortcut
    .split("+")
    .filter(Boolean)
    .map((part) => (part === "Super" ? "Win" : part.replace(/^Arrow/, "")))
}
