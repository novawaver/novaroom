import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { AuthProvider } from "./auth"
import { applyStoredTheme } from "./lib/theme"
import "./styles.css"

applyStoredTheme()

// Hide the browser's right-click menu (Back, Reload, Inspect…) so the app feels native.
// Text fields keep it for cut, copy and paste.
document.addEventListener("contextmenu", (event) => {
  const target = event.target as HTMLElement | null
  if (target?.closest("input, textarea, [contenteditable='true']")) return
  event.preventDefault()
})

// While a modal, panel or image viewer is open, the page behind it doesn't scroll. The wheel still
// scrolls whatever inside the overlay can scroll that way, and nothing else, so reaching the end of
// a modal's content doesn't carry on into the page.
const OVERLAYS = ".desk-backdrop, .drawer-backdrop, .image-viewer"

function canScroll(element: Element, dx: number, dy: number) {
  const style = getComputedStyle(element)
  if (dy !== 0 && /auto|scroll/.test(style.overflowY)) {
    if (dy < 0 ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight - 1) return true
  }
  if (dx !== 0 && /auto|scroll/.test(style.overflowX)) {
    if (dx < 0 ? element.scrollLeft > 0 : element.scrollLeft + element.clientWidth < element.scrollWidth - 1) return true
  }
  return false
}

document.addEventListener(
  "wheel",
  (event) => {
    const overlays = document.querySelectorAll<HTMLElement>(OVERLAYS)
    if (overlays.length === 0) return
    // The newest overlay is on top.
    const overlay = overlays[overlays.length - 1]
    // Element rather than HTMLElement, so the wheel also works over an icon (an SVG element).
    let element = event.target instanceof Element ? event.target : null
    while (element && overlay.contains(element)) {
      if (canScroll(element, event.deltaX, event.deltaY)) return
      element = element.parentElement
    }
    event.preventDefault()
  },
  { passive: false },
)

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
)
