import { useState, type FormEvent } from "react"
import { useAuth } from "../auth"
import { inTauri } from "../lib/desktop"

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase() || "?"
}

export function SignIn() {
  const { configured, requestCode, verifyCode, offlineAccounts, signInOffline, forgetOfflineAccount } = useAuth()
  // Offline mode is Local chat and Vault, which only the desktop app has.
  const offlineOption = configured && inTauri()
  const [step, setStep] = useState<"email" | "code">("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function onEmail(event: FormEvent) {
    event.preventDefault()
    setError("")
    setBusy(true)
    try {
      await requestCode(email)
      setStep("code")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send a code.")
    } finally {
      setBusy(false)
    }
  }

  async function onCode(event: FormEvent) {
    event.preventDefault()
    setError("")
    setBusy(true)
    try {
      await verifyCode(email, code)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign you in.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-layout">
      <section className="auth-story">
        <p className="eyebrow">Novaroom</p>
        <h1>A home base for AI trainers.</h1>
        <p>
          Annotators, raters, and prompt writers talk in one place instead of scattered
          Discord servers and Slack groups.
        </p>
      </section>
      <section className="auth-panel">
        <div className="auth-stack">
          <form onSubmit={step === "email" ? onEmail : onCode}>
            <h2>{step === "email" ? "Sign in" : "Enter your code"}</h2>
            <p className="lede">
              {step === "email"
                ? "New here? Enter your email and we’ll create your account."
                : configured
                  ? `We sent a code to ${email.trim()}.`
                  : `Use 000000 to continue as ${email.trim()}.`}
            </p>
            {!configured && (
              <p className="notice">
                Local preview. No email is sent. Use code 000000. Add your Supabase URL and
                anon key to <code>.env</code> for real sign-in.
              </p>
            )}
            {step === "email" ? (
              <label>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
            ) : (
              <label>
                6-digit code
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                />
              </label>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              {step === "code" && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setStep("email")
                    setCode("")
                    setError("")
                  }}
                >
                  Back
                </button>
              )}
              <button type="submit" className="button" disabled={busy}>
                {busy ? "Please wait…" : step === "email" ? "Send code" : "Sign in"}
              </button>
            </div>
          </form>
          {offlineOption && step === "email" && (
            <div className="offline-signin">
              <h3>Continue offline</h3>
              <p className="hint">Use Local chat and Vault without internet. Nothing else works until you sign in.</p>
              {offlineAccounts.length === 0 ? (
                <p className="hint">Sign in on this computer once to use offline mode.</p>
              ) : (
                <ul>
                  {offlineAccounts.map(({ session, profile }) => {
                    const name = profile.displayName || session.email
                    return (
                      <li key={session.userId}>
                        <button type="button" className="offline-account" onClick={() => signInOffline(session.userId)}>
                          <span className="avatar">
                            {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : <span>{initials(name)}</span>}
                          </span>
                          <span className="offline-account-text">
                            <strong>{name}</strong>
                            {name !== session.email && <span>{session.email}</span>}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          title="Remove this account from offline mode on this computer"
                          onClick={() => forgetOfflineAccount(session.userId)}
                        >
                          Forget
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
