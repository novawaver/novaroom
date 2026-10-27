import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

export function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" />
      <path d="M5 19.5h14" />
    </svg>
  )
}

const MAX_ZOOM = 8
const ZOOM_STEP = 1.25
// Room left around an image shown whole.
const VIEWER_MARGIN = 48

/**
 * Shows an image over the app, whole at first. It zooms with the buttons, Ctrl+wheel, + / - / 0 or a
 * double-click, and once larger than the window it scrolls with the wheel or by dragging. Esc, the
 * close button or a click outside the image closes it. onSave, when given, adds a button to save it.
 */
export function ImageViewer({
  url,
  name,
  onSave,
  onClose,
}: {
  url: string
  name: string
  onSave?: () => Promise<void>
  onClose: () => void
}) {
  const [error, setError] = useState("")
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ width: 0, height: 0 })
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  // null shows the image whole; otherwise the scale, where 1 is its actual size.
  const [zoom, setZoom] = useState<number | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  // The point to keep still while zooming: where it is on the stage (x, y) and on the image (px, py).
  // Applied once the new size is drawn.
  const anchorRef = useRef<{ x: number; y: number; px: number; py: number; ratio: number } | null>(null)
  const dragRef = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null)

  // Measured before the stage has a size, the fit would be negative.
  const fit =
    natural && stage.width > 0
      ? Math.min(1, (stage.width - VIEWER_MARGIN * 2) / natural.width, (stage.height - VIEWER_MARGIN * 2) / natural.height)
      : 1
  const scale = zoom ?? fit
  const minZoom = Math.min(fit, 0.1)

  // Zooms to a scale (null to show it whole), keeping the given point of the stage, or its centre, still.
  const zoomTo = useCallback(
    (next: number | null, at?: { x: number; y: number }) => {
      const target = next === null ? fit : Math.min(MAX_ZOOM, Math.max(minZoom, next))
      if (target === scale) return
      const element = stageRef.current
      const image = imageRef.current
      if (element && image) {
        const x = at?.x ?? element.clientWidth / 2
        const y = at?.y ?? element.clientHeight / 2
        anchorRef.current = {
          x,
          y,
          px: element.scrollLeft + x - image.offsetLeft,
          py: element.scrollTop + y - image.offsetTop,
          ratio: target / scale,
        }
      }
      setZoom(next === null || target === fit ? null : target)
    },
    [fit, minZoom, scale],
  )

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const measure = () => setStage({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const element = stageRef.current
    const image = imageRef.current
    if (!anchor || !element || !image) return
    anchorRef.current = null
    element.scrollLeft = anchor.px * anchor.ratio + image.offsetLeft - anchor.x
    element.scrollTop = anchor.py * anchor.ratio + image.offsetTop - anchor.y
  }, [scale])

  // Caught on the way down so Esc closes only the viewer, not a panel or form open beneath it.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation()
        onClose()
      } else if (event.key === "+" || event.key === "=") zoomTo(scale * ZOOM_STEP)
      else if (event.key === "-") zoomTo(scale / ZOOM_STEP)
      else if (event.key === "0") zoomTo(null)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onClose, scale, zoomTo])

  // Ctrl+wheel (and a touchpad pinch, which arrives as one) zooms at the pointer. A plain wheel scrolls.
  // Attached by hand because React's wheel listener can't stop the window itself from zooming.
  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey) return
      event.preventDefault()
      const box = element!.getBoundingClientRect()
      const factor = Math.exp(-event.deltaY * 0.0025)
      zoomTo(scale * factor, { x: event.clientX - box.left, y: event.clientY - box.top })
    }
    element.addEventListener("wheel", onWheel, { passive: false })
    return () => element.removeEventListener("wheel", onWheel)
  }, [scale, zoomTo])

  const zoomed = natural !== null && (natural.width * scale > stage.width || natural.height * scale > stage.height)

  return createPortal(
    <div className="image-viewer" role="dialog" aria-label={name}>
      <div
        ref={stageRef}
        className={zoomed ? "image-viewer-stage zoomed" : "image-viewer-stage"}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const element = stageRef.current!
          dragRef.current = {
            x: event.clientX,
            y: event.clientY,
            left: element.scrollLeft,
            top: element.scrollTop,
            moved: false,
          }
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (!drag) return
          const dx = event.clientX - drag.x
          const dy = event.clientY - drag.y
          if (!drag.moved && Math.hypot(dx, dy) < 4) return
          if (!drag.moved) event.currentTarget.setPointerCapture(event.pointerId)
          drag.moved = true
          event.currentTarget.scrollLeft = drag.left - dx
          event.currentTarget.scrollTop = drag.top - dy
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current
          dragRef.current = null
          // A click (not the end of a drag) on the dark area around the image closes the viewer.
          if (drag && !drag.moved && !(event.target instanceof HTMLImageElement)) onClose()
        }}
        onPointerCancel={() => (dragRef.current = null)}
      >
        <div className="image-viewer-canvas">
          <img
            ref={imageRef}
            src={url}
            alt={name}
            draggable={false}
            style={natural ? { width: natural.width * scale, height: natural.height * scale } : { visibility: "hidden" }}
            onLoad={(event) =>
              setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
            }
            onDoubleClick={(event) => {
              const box = stageRef.current!.getBoundingClientRect()
              const at = { x: event.clientX - box.left, y: event.clientY - box.top }
              zoomTo(zoom === null ? Math.max(1, fit * 2) : null, at)
            }}
          />
        </div>
      </div>
      <div className="image-viewer-zoom" role="toolbar" aria-label="Zoom">
        <button type="button" aria-label="Zoom out" title="Zoom out (-)" disabled={scale <= minZoom} onClick={() => zoomTo(scale / ZOOM_STEP)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 12h12" />
          </svg>
        </button>
        <button type="button" className="image-viewer-scale" title="Actual size" onClick={() => zoomTo(1)}>
          {Math.round(scale * 100)}%
        </button>
        <button type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={scale >= MAX_ZOOM} onClick={() => zoomTo(scale * ZOOM_STEP)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 12h12M12 6v12" />
          </svg>
        </button>
        <button type="button" aria-label="Fit to window" title="Fit to window (0)" disabled={zoom === null} onClick={() => zoomTo(null)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      </div>
      {onSave && (
        <button
          type="button"
          className="image-viewer-save"
          aria-label="Save image"
          title="Save image"
          onClick={() => {
            setError("")
            onSave().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not save the image."))
          }}
        >
          <DownloadIcon />
        </button>
      )}
      <button type="button" className="image-viewer-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      {error && <p className="image-viewer-error">{error}</p>}
    </div>,
    document.body,
  )
}
