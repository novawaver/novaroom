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

async function setTaskbarBadge(count: number) {
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

let trayLogo: Promise<HTMLImageElement> | null = null

function loadTrayLogo() {
  trayLogo ??= new Promise((resolve, reject) => {
    const image = new window.Image()
    image.onload = () => resolve(image)
    image.onerror = () => {
      trayLogo = null
      reject(new Error("Could not load the logo."))
    }
    image.src = "/logo.png"
  })
  return trayLogo
}

/** The tray icon with a count in a red circle at its lower right, as 32 by 32 RGBA. */
async function drawTrayIcon(count: number) {
  const size = 32
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d")
  if (!context) return null
  context.drawImage(await loadTrayLogo(), 0, 0, size, size)
  const label = count > 9 ? "9+" : String(count)
  // A ring in the clear area around the circle keeps it readable on any taskbar colour.
  context.fillStyle = "#fff"
  context.beginPath()
  context.arc(22, 22, 10.5, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = "#d32f2f"
  context.beginPath()
  context.arc(22, 22, 9, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = "#fff"
  context.font = `700 ${label.length > 1 ? 10 : 13}px Segoe UI, sans-serif`
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(label, 22, 23)
  return Array.from(context.getImageData(0, 0, size, size).data)
}

async function setTrayBadge(count: number) {
  const { invoke } = await import("@tauri-apps/api/core")
  const icon = count > 0 ? await drawTrayIcon(count) : null
  await invoke("set_tray_badge", { count: Math.max(0, count), icon })
}

let shownCount = -1

/** Shows how many unread things there are (messages, tasks, events) on the taskbar and tray icons. */
export async function setUnreadBadge(count: number) {
  if (!inTauri() || count === shownCount) return
  shownCount = count
  await Promise.all([setTaskbarBadge(count), setTrayBadge(count)]).catch(() => {
    // Shown again with the next change.
    shownCount = -1
  })
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image()
    // Lets the canvas be read afterwards; profile pictures are served with CORS allowed.
    image.crossOrigin = "anonymous"
    const timer = window.setTimeout(() => reject(new Error("Timed out")), 4000)
    image.onload = () => {
      window.clearTimeout(timer)
      resolve(image)
    }
    image.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error("Could not load the picture."))
    }
    image.src = src
  })
}

/**
 * The sender's profile picture as a PNG (base64), for the notification's round icon. Their initials
 * on the brand colour when there is no picture, or it can't be loaded (for example offline).
 */
async function senderPicture(from: { name: string; avatarUrl: string | null }) {
  const size = 128
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d")
  if (!context) return null
  const drawInitials = () => {
    const parts = from.name.split(/\s+/).filter(Boolean)
    const letters = (parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : from.name.slice(0, 2)).toUpperCase() || "?"
    context.clearRect(0, 0, size, size)
    context.fillStyle = "#d14a1d"
    context.fillRect(0, 0, size, size)
    context.fillStyle = "#fff"
    context.font = "700 52px Segoe UI, sans-serif"
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(letters, size / 2, size / 2 + 3)
  }
  if (from.avatarUrl) {
    try {
      const image = await loadImage(from.avatarUrl)
      // Fill the square, cropping the longer side, as profile pictures show elsewhere.
      const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight)
      const width = image.naturalWidth * scale
      const height = image.naturalHeight * scale
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
      return canvas.toDataURL("image/png").split(",")[1] ?? null
    } catch {
      // Fall through to initials; toDataURL also throws if the picture could not be read.
    }
  }
  drawInitials()
  return canvas.toDataURL("image/png").split(",")[1] ?? null
}

// target: what clicking the notification opens, such as "chat:<id>" or "desk:tasks". It comes back
// through onNotificationClick. from: who it is from, whose picture the notification shows.
export async function notifyIncoming(
  title: string,
  body: string,
  target?: string,
  from?: { name: string; avatarUrl: string | null } | null,
) {
  if (!inTauri()) return
  const text = { title: title || "Novaroom", body: body.slice(0, 180) }
  // On Windows the app shows its own toast, which opens the window when clicked.
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    const picture = from ? await senderPicture(from).catch(() => null) : null
    await invoke("notify", { ...text, target: target ?? null, picture })
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
