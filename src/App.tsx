import { useAuth } from "./auth"
import { inTauri } from "./lib/desktop"
import { AppShell } from "./screens/AppShell"
import { SignIn } from "./screens/SignIn"
import { TitleBar } from "./screens/TitleBar"
import { UpdateBanner } from "./screens/UpdateBanner"

function Screen() {
  const { ready, session } = useAuth()
  if (!ready) {
    return (
      <div className="boot">
        <p>Opening Novaroom…</p>
      </div>
    )
  }
  if (!session) return <SignIn />
  return <AppShell />
}

export default function App() {
  // In the browser the window keeps its own title bar; the in-app one is desktop only.
  if (!inTauri()) return <Screen />
  return (
    <div className="frame">
      <TitleBar />
      <div className="frame-body">
        <Screen />
      </div>
      {/* Only the installed desktop app can update itself, so the banner lives here. */}
      <UpdateBanner />
    </div>
  )
}
