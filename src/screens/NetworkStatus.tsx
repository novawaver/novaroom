import { useNetwork } from "../lib/network"

// A small connection readout for the title bar: a coloured dot, the download speed the system
// estimates (where it reports one) and the round trip to the server.
export function NetworkStatus() {
  const { online, latencyMs, downlinkMbps } = useNetwork()
  const quality = !online ? "offline" : latencyMs === null ? "checking" : latencyMs > 600 ? "slow" : "good"
  const speed = downlinkMbps === null ? null : downlinkMbps >= 10 ? "10+ Mbps" : `${downlinkMbps.toFixed(1)} Mbps`
  const label = !online
    ? "Offline · reconnecting…"
    : latencyMs === null
      ? "Checking…"
      : [speed, `${latencyMs} ms`].filter(Boolean).join(" · ")
  const title = !online
    ? "Can't reach Novaroom. It will reconnect and catch up as soon as the network is back."
    : `Download speed: ${speed ?? "unknown"}. Server response time: ${latencyMs ?? "…"} ms.`

  return (
    <div className={`network-status ${quality}`} title={title} role="status" aria-live="polite" data-tauri-drag-region>
      <span className="network-dot" aria-hidden="true" data-tauri-drag-region />
      <span data-tauri-drag-region>{label}</span>
    </div>
  )
}
