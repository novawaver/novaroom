import type { Image } from "@tauri-apps/api/image"

function inTauri() {
  return "__TAURI_INTERNALS__" in window
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

export async function notifyIncoming(title: string, body: string) {
  if (!inTauri()) return
  const { isPermissionGranted, requestPermission, sendNotification } = await import(
    "@tauri-apps/plugin-notification"
  )
  let granted = await isPermissionGranted()
  if (!granted) {
    granted = (await requestPermission()) === "granted"
  }
  if (!granted) return
  sendNotification({
    title: title || "Novaroom",
    body: body.slice(0, 180),
  })
}

export async function windowIsActive() {
  if (!inTauri()) return document.hasFocus()
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  const windowHandle = getCurrentWindow()
  const [focused, visible] = await Promise.all([
    windowHandle.isFocused(),
    windowHandle.isVisible(),
  ])
  return focused && visible
}
