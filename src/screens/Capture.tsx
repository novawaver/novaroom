import { useCallback, useEffect, useRef, useState } from "react"
import {
  captureFolder,
  captureSaves,
  deleteRecording,
  listMicrophones,
  listRecordings,
  openRecording,
  revealRecording,
  startRecording,
  type ActiveRecording,
  type CaptureSources,
  type Recording,
} from "../lib/capture"
import { ConfirmDialog } from "./ChatTools"

export type CaptureTab = "record" | "recordings"

export const CAPTURE_TABS: Array<{ id: CaptureTab; label: string }> = [
  { id: "record", label: "Record" },
  { id: "recordings", label: "Recordings" },
]

// What to record and which microphone, remembered on this computer.
const SOURCES_KEY = "novaroom.capture-sources"
const MIC_KEY = "novaroom.capture-mic"
const DEFAULT_SOURCES: CaptureSources = { screen: true, mic: true, speaker: true }

function readSources(): CaptureSources {
  try {
    const saved = JSON.parse(localStorage.getItem(SOURCES_KEY) ?? "null")
    if (saved && typeof saved === "object") return { ...DEFAULT_SOURCES, ...saved }
  } catch {
    // Use the defaults.
  }
  return DEFAULT_SOURCES
}

function remember(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Not remembered; the choice still applies until the app closes.
  }
}

type Phase = "idle" | "starting" | "recording" | "paused" | "stopping"

export type CaptureState = ReturnType<typeof useCapture>

/**
 * Runs Capture for the whole app, so a recording keeps going while the person uses other pages,
 * and across the switch between online and offline. Stops when `signedIn` turns false, since the
 * controls are gone then.
 */
export function useCapture(signedIn: boolean) {
  const [sources, setSourcesState] = useState(readSources)
  const [micId, setMicIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(MIC_KEY)
    } catch {
      return null
    }
  })
  const [mics, setMics] = useState<Array<{ id: string; label: string }>>([])
  const [phase, setPhase] = useState<Phase>("idle")
  const [error, setError] = useState("")
  const [warning, setWarning] = useState("")
  const [saved, setSaved] = useState<Recording | null>(null)
  const [preview, setPreview] = useState<MediaStream | null>(null)
  const [recordings, setRecordings] = useState<Recording[] | null>(null)
  const [listError, setListError] = useState("")
  const [folder, setFolder] = useState("")
  // Time recorded so far, not counting pauses: what was done before the last resume, plus since then.
  const [elapsed, setElapsed] = useState(0)
  const timing = useRef({ before: 0, since: 0 })
  const active = useRef<ActiveRecording | null>(null)

  const setSources = (next: CaptureSources) => {
    setSourcesState(next)
    remember(SOURCES_KEY, JSON.stringify(next))
  }
  const setMicId = (next: string | null) => {
    setMicIdState(next)
    remember(MIC_KEY, next)
  }

  const refresh = useCallback(async () => {
    if (!captureSaves()) return
    try {
      const [list, where] = await Promise.all([listRecordings(), captureFolder()])
      setRecordings(list)
      setFolder(where)
      setListError("")
    } catch (caught) {
      setListError(caught instanceof Error ? caught.message : "Could not list the recordings.")
    }
  }, [])

  const refreshMics = useCallback(async () => {
    try {
      setMics(await listMicrophones())
    } catch {
      // The default microphone is still offered.
    }
  }, [])

  useEffect(() => {
    void refresh()
    void refreshMics()
    const devices = navigator.mediaDevices
    devices?.addEventListener?.("devicechange", refreshMics)
    return () => devices?.removeEventListener?.("devicechange", refreshMics)
  }, [refresh, refreshMics])

  useEffect(() => {
    if (phase !== "recording") return
    const tick = window.setInterval(() => {
      setElapsed(timing.current.before + Date.now() - timing.current.since)
    }, 500)
    return () => window.clearInterval(tick)
  }, [phase])

  const stop = useCallback(async (reason = "") => {
    const recording = active.current
    if (!recording) return
    active.current = null
    setPhase("stopping")
    setPreview(null)
    try {
      const result = await recording.stop()
      setSaved(result)
      setError(reason && reason !== "Screen sharing stopped." ? reason : "")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The recording could not be finished.")
    }
    setPhase("idle")
    void refresh()
  }, [refresh])

  async function start() {
    if (active.current || phase !== "idle") return
    setPhase("starting")
    setError("")
    setWarning("")
    setSaved(null)
    try {
      const recording = await startRecording(sources, sources.mic ? micId : null, (reason) => void stop(reason))
      active.current = recording
      timing.current = { before: 0, since: Date.now() }
      setElapsed(0)
      setPreview(recording.preview)
      setWarning(recording.warning)
      setPhase("recording")
      // Microphone names show once one has been allowed.
      if (sources.mic) void refreshMics()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The recording could not start.")
      setPhase("idle")
    }
  }

  function pause() {
    if (phase !== "recording" || !active.current) return
    active.current.pause()
    timing.current.before += Date.now() - timing.current.since
    setElapsed(timing.current.before)
    setPhase("paused")
  }

  function resume() {
    if (phase !== "paused" || !active.current) return
    active.current.resume()
    timing.current.since = Date.now()
    setPhase("recording")
  }

  useEffect(() => {
    if (!signedIn) void stop()
  }, [signedIn, stop])

  return {
    sources,
    setSources,
    micId,
    setMicId,
    mics,
    phase,
    // Recording or paused: there is a file being made.
    live: phase === "recording" || phase === "paused",
    elapsed,
    error,
    warning,
    saved,
    preview,
    recordings,
    listError,
    folder,
    refresh,
    start,
    pause,
    resume,
    stop: () => void stop(),
    remove: async (name: string) => {
      await deleteRecording(name)
      setSaved((current) => (current?.name === name ? null : current))
      await refresh()
    },
  }
}

export function formatElapsed(ms: number) {
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0")
  const seconds = String(total % 60).padStart(2, "0")
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`
}

function formatSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.ceil(size / 1024))} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatWhen(ms: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms))
}

/** Shows what a failed action said, as the other pages do. */
function useActionError() {
  const [actionError, setActionError] = useState("")
  const run = (action: () => Promise<void>) => {
    setActionError("")
    void action().catch((caught) => setActionError(caught instanceof Error ? caught.message : "That didn't work."))
  }
  return [actionError, run] as const
}

function LivePreview({ stream }: { stream: MediaStream }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (video.current) video.current.srcObject = stream
  }, [stream])
  return <video ref={video} className="capture-preview" autoPlay muted playsInline aria-label="What is being recorded" />
}

const SOURCE_ROWS: Array<{ id: keyof CaptureSources; title: string; hint: string }> = [
  {
    id: "screen",
    title: "Screen",
    hint: "When you start, Windows asks which screen or window to record.",
  },
  {
    id: "mic",
    title: "Microphone",
    hint: "Your voice.",
  },
  {
    id: "speaker",
    title: "Speaker",
    hint: "Everything your computer plays, such as the other people in a call or a video.",
  },
]

function StartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <circle className="capture-icon-fill" cx="12" cy="12" r="4.5" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect className="capture-icon-fill" x="6.5" y="6.5" width="11" height="11" rx="2" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6.5v11M15 6.5v11" />
    </svg>
  )
}

function ResumeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="capture-icon-fill" d="M8.5 6v12l9.5-6z" />
    </svg>
  )
}

/** Start, or Pause and Stop while recording, as icons in the Record page's title bar. */
function RecordControls({ capture }: { capture: CaptureState }) {
  const { phase, sources } = capture
  const nothing = !sources.screen && !sources.mic && !sources.speaker
  if (phase === "idle" || phase === "starting") {
    const label = phase === "starting" ? "Starting…" : nothing ? "Turn on something to record" : "Start recording"
    return (
      <button
        type="button"
        className="icon-button capture-icon start"
        aria-label={label}
        title={label}
        disabled={nothing || phase === "starting"}
        onClick={() => void capture.start()}
      >
        <StartIcon />
      </button>
    )
  }
  const stopping = phase === "stopping"
  const paused = phase === "paused"
  return (
    <>
      <button
        type="button"
        className="icon-button capture-icon"
        aria-label={paused ? "Resume" : "Pause"}
        title={paused ? "Resume" : "Pause"}
        disabled={stopping}
        onClick={paused ? capture.resume : capture.pause}
      >
        {paused ? <ResumeIcon /> : <PauseIcon />}
      </button>
      <button
        type="button"
        className="icon-button capture-icon stop"
        aria-label={stopping ? "Saving…" : "Stop and save"}
        title={stopping ? "Saving…" : "Stop and save"}
        disabled={stopping}
        onClick={capture.stop}
      >
        <StopIcon />
      </button>
    </>
  )
}

export function Capture({ tab, capture }: { tab: CaptureTab; capture: CaptureState }) {
  return (
    <section className="settings capture">
      <header className="thread-bar">
        <h1>{tab === "record" ? "Record" : "Recordings"}</h1>
        <div className="thread-actions">
          {capture.live && (
            <span className={capture.phase === "paused" ? "capture-live paused" : "capture-live"} role="status">
              {capture.phase === "paused" ? "Paused" : "Recording"} {formatElapsed(capture.elapsed)}
            </span>
          )}
          {tab === "record" && <RecordControls capture={capture} />}
        </div>
      </header>
      {tab === "record" ? <Record capture={capture} /> : <Recordings capture={capture} />}
    </section>
  )
}

function Record({ capture }: { capture: CaptureState }) {
  const { sources, phase, live } = capture
  const [actionError, run] = useActionError()
  const locked = phase !== "idle"
  const nothing = !sources.screen && !sources.mic && !sources.speaker

  return (
    <div className="settings-panel">
      <p className="hint">
        Record your screen, your microphone and what your computer plays, in any mix.{" "}
        {captureSaves()
          ? `Recordings stay on this computer${capture.folder ? `, in ${capture.folder}` : ""}. Nothing is uploaded.`
          : "In the browser, the recording downloads when you stop."}
      </p>
      {capture.error && (
        <p className="form-error" role="alert">
          {capture.error}
        </p>
      )}
      {capture.warning && <p className="notice">{capture.warning}</p>}
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}

      {SOURCE_ROWS.map(({ id, title, hint }) => (
        <div className="startup-row" key={id}>
          <div>
            <strong>{title}</strong>
            <p className="hint">{hint}</p>
            {id === "mic" && sources.mic && (
              <select
                className="capture-mic"
                aria-label="Microphone"
                value={capture.micId ?? ""}
                disabled={locked}
                onChange={(event) => capture.setMicId(event.target.value || null)}
              >
                <option value="">Default microphone</option>
                {capture.mics.map((mic) => (
                  <option key={mic.id} value={mic.id}>
                    {mic.label}
                  </option>
                ))}
                {capture.micId && !capture.mics.some((mic) => mic.id === capture.micId) && (
                  <option value={capture.micId}>Last chosen microphone</option>
                )}
              </select>
            )}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={sources[id]}
            aria-label={`Record ${title.toLowerCase()}`}
            className="switch"
            disabled={locked}
            onClick={() => capture.setSources({ ...sources, [id]: !sources[id] })}
          >
            <span />
          </button>
        </div>
      ))}

      {phase === "stopping" && <p className="hint">Saving the recording…</p>}
      {nothing && <p className="hint">Turn on at least one of screen, microphone or speaker.</p>}

      {capture.preview && <LivePreview stream={capture.preview} />}
      {live && !capture.preview && (
        <p className="hint">Recording sound only. Novaroom keeps recording while you use other pages.</p>
      )}

      {capture.saved && !live && (
        <div className="form-ok capture-saved" role="status">
          <span>
            Saved <strong>{capture.saved.name}</strong> ({formatSize(capture.saved.size)}).
          </span>
          {captureSaves() && (
            <span className="capture-saved-actions">
              <button type="button" className="text-button" onClick={() => run(() => openRecording(capture.saved!.name))}>
                Open
              </button>
              <button type="button" className="text-button" onClick={() => run(() => revealRecording(capture.saved!.name))}>
                Show in folder
              </button>
            </span>
          )}
        </div>
      )}

      <hr className="settings-divider" />
      <p className="hint">
        Before you record, check that it is allowed. Client work is usually under an NDA, and people in a call should
        know they are being recorded.
      </p>
    </div>
  )
}

function Recordings({ capture }: { capture: CaptureState }) {
  const { recordings, refresh } = capture
  const [actionError, run] = useActionError()
  const [deleting, setDeleting] = useState<Recording | null>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!captureSaves()) {
    return (
      <div className="settings-panel">
        <p className="hint">Saved recordings are listed in the Novaroom desktop app. In the browser, they go to your downloads.</p>
      </div>
    )
  }

  return (
    <div className="settings-panel capture-recordings">
      <div className="capture-toolbar">
        <p className="hint">{capture.folder ? `Saved in ${capture.folder}` : "Saved in your Videos folder"}</p>
        <button type="button" className="button secondary" onClick={() => run(() => revealRecording(null))}>
          Open folder
        </button>
      </div>
      {(capture.listError || actionError) && (
        <p className="form-error" role="alert">
          {capture.listError || actionError}
        </p>
      )}
      {recordings === null ? (
        <p className="hint">Loading…</p>
      ) : recordings.length === 0 ? (
        <p className="hint">No recordings yet. Start one from Record.</p>
      ) : (
        <ul className="capture-list">
          {recordings.map((recording) => (
            <li key={recording.name} className="capture-item">
              <div className="capture-item-text">
                <strong title={recording.name}>{recording.name}</strong>
                <span>
                  {formatWhen(recording.modified)} · {formatSize(recording.size)}
                </span>
              </div>
              <div className="capture-item-actions">
                <button type="button" className="text-button" onClick={() => run(() => openRecording(recording.name))}>
                  Open
                </button>
                <button type="button" className="text-button" onClick={() => run(() => revealRecording(recording.name))}>
                  Show in folder
                </button>
                <button type="button" className="text-button danger" onClick={() => setDeleting(recording)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this recording?"
          text={`${deleting.name} is deleted from this computer. This can't be undone.`}
          actions={[{ label: "Delete", danger: true, onSelect: () => capture.remove(deleting.name) }]}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
