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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
)
