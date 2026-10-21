import { useEffect } from "react"
import { useAuth } from "./auth"
import { inTauri } from "./lib/desktop"
import { listenForQuit } from "./lib/unsaved"
import { AppShell } from "./screens/AppShell"
import { OfflineShell, useLocalChat } from "./screens/LocalChat"
import { SignIn } from "./screens/SignIn"
import { TitleBar } from "./screens/TitleBar"
import { UpdateBanner } from "./screens/UpdateBanner"

function Screen() {
  const { ready, session, profile, offline, signOut } = useAuth()
  // Local chat keeps running when the app switches between offline and online.
  const local = useLocalChat(session, profile?.displayName || session?.email || "", offline)
  if (!ready) {
    return (
      <div className="boot">
        <p>Opening Novaroom…</p>
      </div>
    )
  }
  if (!session) return <SignIn />
  if (offline) return <OfflineShell local={local} session={session} onSignOut={() => void signOut()} />
  return <AppShell local={local} />
}

export default function App() {
  // Quit from the tray waits here while there are unsaved changes, so the person can save them.
  useEffect(() => {
    const stop = listenForQuit()
    return () => void stop.then((unlisten) => unlisten())
  }, [])

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
