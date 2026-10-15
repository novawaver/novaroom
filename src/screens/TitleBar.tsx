import { useEffect, useState } from "react"
import { controlWindow, watchMaximized } from "../lib/desktop"

function MinimizeIcon() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0 5h10" />
    </svg>
  )
}

function MaximizeIcon() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true">
      <rect x="0.5" y="0.5" width="9" height="9" />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2.5 2.5V0.5h7v7h-2" />
      <rect x="0.5" y="2.5" width="7" height="7" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
    </svg>
  )
}

export function TitleBar() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => watchMaximized(setMaximized), [])

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <img src="/logo.png" alt="" width={16} height={16} data-tauri-drag-region />
        <span data-tauri-drag-region>Novaroom</span>
      </div>
      <div className="titlebar-controls">
        <button
          type="button"
          className="titlebar-button"
          aria-label="Minimize"
          onClick={() => controlWindow("minimize")}
        >
          <MinimizeIcon />
        </button>
        <button
          type="button"
          className="titlebar-button"
          aria-label={maximized ? "Restore" : "Maximize"}
          onClick={() => controlWindow("toggle-maximize")}
        >
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button
          type="button"
          className="titlebar-button close"
          aria-label="Close"
          onClick={() => controlWindow("close")}
        >
          <CloseIcon />
        </button>
      </div>
    </header>
  )
}
