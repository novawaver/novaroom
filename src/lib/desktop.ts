import type { Image } from "@tauri-apps/api/image"

export function inTauri() {
  return "__TAURI_INTERNALS__" in window
}

export type WindowAction = "minimize" | "toggle-maximize" | "close"

export async function controlWindow(action: WindowAction) {
  if (!inTauri()) return
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  const windowHandle = getCurrentWindow()
  if (action === "minimize") await windowHandle.minimize()
  else if (action === "toggle-maximize") await windowHandle.toggleMaximize()
  else await windowHandle.close()
}

// Reports the current maximized state, then every change. Returns an unsubscribe.
export function watchMaximized(onChange: (maximized: boolean) => void) {
  if (!inTauri()) return () => {}
  let unlisten: (() => void) | null = null
  let stopped = false
  import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
    const windowHandle = getCurrentWindow()
    onChange(await windowHandle.isMaximized())
    const stop = await windowHandle.onResized(async () => {
      onChange(await windowHandle.isMaximized())
    })
    if (stopped) stop()
    else unlisten = stop
  })
  return () => {
    stopped = true
    unlisten?.()
  }
}

let overlay: Image | null = null

function drawBadge(count: number) {
  const size = 32
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d")
  if (!context) return new Uint8Array(size * size * 4)
  context.clearRect(0, 0, size, size)
  context.fillStyle = "#c4552a"
  context.beginPath()
  context.arc(16, 16, 15, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = "#fff"
  context.font = "700 15px Segoe UI, sans-serif"
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(count > 9 ? "9+" : String(count), 16, 17)
  return new Uint8Array(context.getImageData(0, 0, size, size).data)
}

export async function setTaskbarBadge(count: number) {
  if (!inTauri()) return
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  const { Image } = await import("@tauri-apps/api/image")
  const windowHandle = getCurrentWindow()
  if (count <= 0) {
    await windowHandle.setOverlayIcon()
    if (overlay) {
      await overlay.close()
      overlay = null
    }
    return
  }
  const image = await Image.new(drawBadge(count), 32, 32)
  await windowHandle.setOverlayIcon(image)
  if (overlay) await overlay.close()
  overlay = image
}

// target: what clicking the notification opens, such as "chat:<id>" or "desk:tasks". It comes back
// through onNotificationClick.
export async function notifyIncoming(title: string, body: string, target?: string) {
  if (!inTauri()) return
  const text = { title: title || "Novaroom", body: body.slice(0, 180) }
  // On Windows the app shows its own toast, which opens the window when clicked.
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("notify", { ...text, target: target ?? null })
    return
  } catch {
    // Not Windows, or the toast could not be built; fall back to the plugin's notification.
  }
  const { isPermissionGranted, requestPermission, sendNotification } = await import(
    "@tauri-apps/plugin-notification"
  )
  let granted = await isPermissionGranted()
  if (!granted) {
    granted = (await requestPermission()) === "granted"
  }
  if (!granted) return
  sendNotification(text)
}

// Calls onClick with the target given to notifyIncoming when the person clicks a notification.
// Returns an unsubscribe.
export function onNotificationClick(onClick: (target: string) => void) {
  if (!inTauri()) return () => {}
  let unlisten: (() => void) | null = null
  let stopped = false
  import("@tauri-apps/api/event").then(async ({ listen }) => {
    const stop = await listen<string>("notification-clicked", (event) => onClick(event.payload))
    if (stopped) stop()
    else unlisten = stop
  })
  return () => {
    stopped = true
    unlisten?.()
  }
}

// True only when the person can actually see the app: the page is visible and focused, and in the
// desktop app the window is also focused and shown. Both checks must agree, because the desktop
// focus check alone can report a minimized or background window as active.
export async function windowIsActive() {
  const pageActive = document.visibilityState === "visible" && document.hasFocus()
  if (!pageActive) return false
  if (!inTauri()) return true
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  const windowHandle = getCurrentWindow()
  const [focused, visible] = await Promise.all([
    windowHandle.isFocused(),
    windowHandle.isVisible(),
  ])
  return focused && visible
}
