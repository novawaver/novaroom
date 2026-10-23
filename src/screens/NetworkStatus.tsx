import { useNetwork } from "../lib/network"

type Signal = { bars: 0 | 1 | 2 | 3 | 4; quality: "offline" | "checking" | "weak" | "fair" | "good"; label: string }

// How many of four bars to light. Mostly the round trip to the server, since that is what the app
// feels; the system's download estimate, where there is one, can only lower it.
function signalOf(online: boolean, latencyMs: number | null, downlinkMbps: number | null): Signal {
  if (!online) return { bars: 0, quality: "offline", label: "Offline" }
  if (latencyMs === null) return { bars: 0, quality: "checking", label: "Checking…" }
  let bars: Signal["bars"] = latencyMs <= 150 ? 4 : latencyMs <= 300 ? 3 : latencyMs <= 600 ? 2 : 1
  if (downlinkMbps !== null) {
    const cap = downlinkMbps < 1 ? 2 : downlinkMbps < 3 ? 3 : 4
    bars = Math.min(bars, cap) as Signal["bars"]
  }
  if (bars >= 3) return { bars, quality: "good", label: bars === 4 ? "Excellent" : "Good" }
  if (bars === 2) return { bars, quality: "fair", label: "Fair" }
  return { bars, quality: "weak", label: "Weak" }
}

function SignalIcon({ bars }: { bars: number }) {
  return (
    <svg className="network-signal" viewBox="0 0 16 14" aria-hidden="true" data-tauri-drag-region>
      {[0, 1, 2, 3].map((index) => (
        <rect
          key={index}
          className={index < bars ? "on" : undefined}
          x={index * 4 + 0.5}
          y={10 - index * 3}
          width="3"
          height={4 + index * 3}
          rx="0.8"
        />
      ))}
    </svg>
  )
}

// The connection in the title bar: a signal icon, with the details in a card on hover (or keyboard
// focus): how good it is, the server's response time and the system's download estimate.
export function NetworkStatus() {
  const { online, latencyMs, downlinkMbps } = useNetwork()
  const signal = signalOf(online, latencyMs, downlinkMbps)
  const speed = downlinkMbps === null ? "Not reported" : downlinkMbps >= 10 ? "10+ Mbps" : `${downlinkMbps.toFixed(1)} Mbps`

  return (
    <div
      className={`network-status ${signal.quality}`}
      role="status"
      aria-live="polite"
      aria-label={`Connection: ${signal.label}`}
      tabIndex={0}
      data-tauri-drag-region
    >
      <SignalIcon bars={signal.bars} />
      <div className="network-card" role="tooltip">
        <strong>{signal.label === "Offline" ? "No connection" : `${signal.label} connection`}</strong>
        {online ? (
          <dl>
            <dt>Server response</dt>
            <dd>{latencyMs === null ? "Checking…" : `${latencyMs} ms`}</dd>
            <dt>Download speed</dt>
            <dd>{speed}</dd>
          </dl>
        ) : (
          <p>Can't reach Novaroom. It reconnects and catches up as soon as the network is back.</p>
        )}
      </div>
    </div>
  )
}
