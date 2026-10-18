import { inTauri } from "./desktop"

export type StartupSettings = {
  launchAtLogin: boolean
  startMinimized: boolean
}

export async function readStartup(): Promise<StartupSettings | null> {
  if (!inTauri()) return null
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<StartupSettings>("startup_settings")
}

export async function writeStartup(settings: StartupSettings) {
  if (!inTauri()) return
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("set_startup_settings", { settings })
}
