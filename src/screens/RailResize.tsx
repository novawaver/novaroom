import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"

// The sidebar's width, chosen by dragging its right edge and kept on this computer.

const KEY = "novaroom.rail-width"
const DEFAULT_WIDTH = 320
const MIN_WIDTH = 220
const MAX_WIDTH = 560

const clamp = (width: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)))

function readWidth() {
  try {
    const saved = Number(localStorage.getItem(KEY))
    return Number.isFinite(saved) && saved > 0 ? clamp(saved) : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

function saveWidth(width: number) {
  try {
    if (width === DEFAULT_WIDTH) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, String(width))
  } catch {
    // Not kept; the sidebar still has this width until the app is closed.
  }
}

/**
 * The handle on the sidebar's right edge. Goes inside the page's `.shell`, whose columns follow
 * the width set here. Drag it, or use the arrow keys; double-click puts the usual width back.
 */
export function RailResize() {
  const [width, setWidth] = useState(readWidth)
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--rail-width", `${width}px`)
  }, [width])

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { startX: event.clientX, startWidth: width }
    setDragging(true)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    setWidth(clamp(drag.current.startWidth + event.clientX - drag.current.startX))
  }

  function onPointerEnd() {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    saveWidth(width)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    const next = clamp(width + (event.key === "ArrowLeft" ? -16 : 16))
    setWidth(next)
    saveWidth(next)
  }

  return (
    <div
      className={dragging ? "rail-resize dragging" : "rail-resize"}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the sidebar"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize the sidebar. Double-click to reset."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={() => {
        setWidth(DEFAULT_WIDTH)
        saveWidth(DEFAULT_WIDTH)
      }}
      onKeyDown={onKeyDown}
    />
  )
}
