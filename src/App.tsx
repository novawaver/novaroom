import { useAuth } from "./auth"
import { AppShell } from "./screens/AppShell"
import { SignIn } from "./screens/SignIn"

export default function App() {
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
