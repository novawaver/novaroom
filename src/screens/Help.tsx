import { useEffect, useState } from "react"

/**
 * Settings > Help: fixes for problems people have run into with the installed app. Each entry
 * says what you see, why it happens, and the steps that fixed it, with the commands ready to copy.
 */

type Fix = {
  id: string
  title: string
  /** What the person sees. */
  symptom: string
  /** What is going on, in one or two sentences. */
  cause: string
  steps: Array<string | { text: string; commands: string[] }>
  /** What to try when the steps are not enough. */
  more?: string[]
}

// Windows rebuilds its network stack (Winsock and the IP settings) from these. They need an
// administrator terminal, and the change only fully takes effect after a restart.
const NETWORK_RESET_COMMANDS = ["netsh winsock reset", "netsh int ip reset", "ipconfig /flushdns"]

export const FIXES: Fix[] = [
  {
    id: "closes-after-ten-seconds",
    title: "Novaroom closes about 10 seconds after it opens",
    symptom:
      "The window opens normally, then disappears on its own roughly 10 seconds later, every time. No error is shown. Novaroom is gone from the tray too.",
    cause:
      "A VPN that filters network traffic, in particular Astrill, leaves a filter in Windows' network stack (Winsock) that stays active even while the VPN is off or closed. When that filter is in a broken state, the part of Windows that draws the Novaroom window stops as soon as the app makes its first connection to the server. Resetting the network stack removes the broken entries.",
    steps: [
      "Quit Novaroom: right-click the tray icon and choose Quit. Also quit the VPN completely, including from the tray.",
      "Open Windows Terminal or PowerShell as administrator: press the Windows key, type “terminal”, then choose Run as administrator.",
      { text: "Run these three commands, one after the other. Each one prints a short confirmation.", commands: NETWORK_RESET_COMMANDS },
      "Restart Windows. The reset only finishes after a restart.",
      "Open Novaroom before you open the VPN. If it stays open for a minute, the reset worked. You can then start the VPN again.",
    ],
    more: [
      "If it comes back later, the VPN has put its filter back, usually after it started or updated itself. Run the same reset again. In the VPN's settings, look for an application filter or app guard option and turn it off, or add Novaroom as an exception, so it stops happening.",
      "If the commands do not help, use the full reset: open Windows Settings, go to Network & internet, Advanced network settings, then Network reset. Windows reinstalls every network adapter, including the VPN's, and restarts. You may need to enter your Wi-Fi password again.",
      "Novaroom writes its own restarts to %LOCALAPPDATA%\\com.novawave.novaroom\\logs\\watchdog.log. If that file has new lines from the time the window closed, the problem is something else: send the lines along when you report it.",
    ],
  },
]

/** Puts the commands on the clipboard as one block, one per line, and says so for a moment. */
function CopyCommands({ commands }: { commands: string[] }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <button
      type="button"
      className="button secondary help-copy"
      onClick={() => {
        navigator.clipboard.writeText(commands.join("\r\n")).then(
          () => setCopied(true),
          () => {
            // The clipboard was not available; the text can still be selected and copied by hand.
          },
        )
      }}
    >
      {copied ? "Copied" : "Copy commands"}
    </button>
  )
}

function FixEntry({ fix }: { fix: Fix }) {
  return (
    <article className="help-fix" id={fix.id}>
      <h2>{fix.title}</h2>
      <h3>What you see</h3>
      <p className="hint">{fix.symptom}</p>
      <h3>Why</h3>
      <p className="hint">{fix.cause}</p>
      <h3>Fix</h3>
      <ol className="help-steps">
        {fix.steps.map((step, index) =>
          typeof step === "string" ? (
            <li key={index}>{step}</li>
          ) : (
            <li key={index}>
              {step.text}
              <div className="help-commands">
                <pre>
                  <code>{step.commands.join("\n")}</code>
                </pre>
                <CopyCommands commands={step.commands} />
              </div>
            </li>
          ),
        )}
      </ol>
      {fix.more && fix.more.length > 0 && (
        <>
          <h3>If that is not enough</h3>
          {fix.more.map((paragraph) => (
            <p className="hint" key={paragraph}>
              {paragraph}
            </p>
          ))}
        </>
      )}
    </article>
  )
}

export function Help() {
  return (
    <div className="settings-panel help-panel">
      <p className="hint">
        Problems people have run into with Novaroom on Windows, and what fixed them. For anything else, write to the
        contact on the page where you downloaded Novaroom.
      </p>
      {FIXES.map((fix, index) => (
        <div key={fix.id}>
          {index > 0 && <hr className="settings-divider" />}
          <FixEntry fix={fix} />
        </div>
      ))}
    </div>
  )
}
