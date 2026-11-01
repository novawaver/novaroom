import { inTauri } from "./desktop"

// Capture: recordings of the screen, the microphone and what the speakers play. The window records
// with MediaRecorder; the desktop app hears the speakers (WASAPI loopback, see
// src-tauri/src/capture.rs) and writes each recording to Videos\Novaroom as it goes. Nothing is
// uploaded. In a plain browser the speakers come from the screen picker's "share audio" option and
// the recording downloads when it stops.

export type CaptureSources = { screen: boolean; mic: boolean; speaker: boolean }

export type Recording = {
  name: string
  size: number
  // Milliseconds since 1970, when it was last written.
  modified: number
}

export type ActiveRecording = {
  // The file being written.
  name: string
  // The shared screen, for a live preview. Null for sound-only recordings.
  preview: MediaStream | null
  // Something the person should know about this recording, such as a source that could not be used.
  warning: string
  pause: () => void
  resume: () => void
  // Finishes the file. Safe to call more than once.
  stop: () => Promise<Recording>
}

export const captureSaves = inTauri

async function call<T>(command: string, args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core")
  try {
    return await invoke<T>(command, args)
  } catch (caught) {
    throw new Error(typeof caught === "string" ? caught : "Capture ran into a problem.")
  }
}

export const captureFolder = () => call<string>("capture_folder")

export const listRecordings = () => call<Recording[]>("capture_list")

export const openRecording = (name: string) => call<void>("capture_open", { name })

/** Shows the recording in File Explorer, or opens the folder when there is no name. */
export const revealRecording = (name: string | null) => call<void>("capture_reveal", { name })

export const deleteRecording = (name: string) => call<void>("capture_delete", { name })

// Tried in order. MP4 first: players can seek in it, while MediaRecorder's WebM has no duration.
const VIDEO_TYPES: Array<[string, string]> = [
  ["video/mp4;codecs=avc1,mp4a.40.2", "mp4"],
  ["video/mp4", "mp4"],
  ["video/webm;codecs=vp9,opus", "webm"],
  ["video/webm;codecs=vp8,opus", "webm"],
  ["video/webm", "webm"],
]
const AUDIO_TYPES: Array<[string, string]> = [
  ["audio/mp4;codecs=mp4a.40.2", "m4a"],
  ["audio/webm;codecs=opus", "webm"],
  ["audio/webm", "webm"],
]
// Screens are mostly text, which blurs at MediaRecorder's default rate.
const VIDEO_BITS = 6_000_000
const AUDIO_BITS = 128_000
// How often MediaRecorder hands over what it has, which is then saved.
const PIECE_MS = 1000

// Plays the speaker samples from the desktop app into the mix. Keeps a short cushion so the sound
// does not stutter, and drops the oldest samples if they pile up, so it never drifts behind.
const SPEAKER_WORKLET = `
class SpeakerSource extends AudioWorkletProcessor {
  constructor() {
    super()
    this.pieces = []
    this.offset = 0
    this.queued = 0
    this.playing = false
    this.port.onmessage = (event) => {
      const piece = new Float32Array(event.data)
      this.pieces.push(piece)
      this.queued += piece.length / 2
      while (this.queued > sampleRate * 0.3 && this.pieces.length > 1) {
        this.queued -= (this.pieces.shift().length - this.offset) / 2
        this.offset = 0
      }
    }
  }
  process(_inputs, outputs) {
    const [left, right] = outputs[0]
    if (!this.playing) {
      if (this.queued < sampleRate * 0.06) return true
      this.playing = true
    }
    for (let i = 0; i < left.length; i++) {
      const piece = this.pieces[0]
      if (!piece) {
        this.playing = false
        break
      }
      left[i] = piece[this.offset]
      if (right) right[i] = piece[this.offset + 1]
      this.offset += 2
      this.queued -= 1
      if (this.offset >= piece.length) {
        this.pieces.shift()
        this.offset = 0
      }
    }
    return true
  }
}
registerProcessor("novaroom-speaker", SpeakerSource)
`

function pickType(video: boolean) {
  const found = (video ? VIDEO_TYPES : AUDIO_TYPES).find(([type]) => MediaRecorder.isTypeSupported(type))
  // Let MediaRecorder choose; it records WebM when it names no type.
  return found ?? ["", "webm"]
}

/** A file name from the local date and time, such as "Recording 2026-11-01 14.05.33". */
function recordingName(now = new Date()) {
  const two = (value: number) => String(value).padStart(2, "0")
  const date = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
  return `Recording ${date} ${two(now.getHours())}.${two(now.getMinutes())}.${two(now.getSeconds())}`
}

function mediaError(caught: unknown, what: string) {
  if (caught instanceof DOMException) {
    if (caught.name === "NotAllowedError") return new Error(`Novaroom was not allowed to use the ${what}.`)
    if (caught.name === "NotFoundError") return new Error(`No ${what} was found.`)
    if (caught.name === "NotReadableError")
      return new Error(`The ${what} is busy or blocked. Close other apps using it and try again.`)
  }
  if (caught instanceof Error) return caught
  return new Error(`Could not use the ${what}.`)
}

/** Microphones on this computer. Their names only show once Novaroom has been allowed to use one. */
export async function listMicrophones() {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((device) => device.kind === "audioinput" && device.deviceId && device.deviceId !== "default")
    .map((device, index) => ({ id: device.deviceId, label: device.label || `Microphone ${index + 1}` }))
}

/**
 * Starts a recording. Asks which screen to share first when `screen` is on. `onEnded` is called if
 * the recording has to stop by itself (the person stopped sharing, or saving failed); call `stop`
 * then to finish the file.
 */
export async function startRecording(
  sources: CaptureSources,
  micId: string | null,
  onEnded: (reason: string) => void,
): Promise<ActiveRecording> {
  if (!sources.screen && !sources.mic && !sources.speaker) throw new Error("Choose at least one thing to record.")
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices)
    throw new Error("This version of Windows' web view cannot record. Update Microsoft Edge WebView2 and try again.")
  const desktop = inTauri()
  if (sources.speaker && !desktop && !sources.screen)
    throw new Error("In the browser, the speakers can only be recorded along with a screen.")

  // Everything opened so far, closed again if a later step fails or when the recording ends.
  const cleanups: Array<() => void> = []
  const cleanUp = () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      try {
        cleanup()
      } catch {
        // Already closed.
      }
    }
  }
  let warning = ""

  try {
    let display: MediaStream | null = null
    if (sources.screen) {
      if (!navigator.mediaDevices.getDisplayMedia)
        throw new Error("This version of Windows' web view cannot share the screen. Update Microsoft Edge WebView2.")
      try {
        display = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30, max: 30 } },
          // The desktop app hears the speakers itself; the browser can only get them from here.
          audio: sources.speaker && !desktop,
          ...(sources.speaker && !desktop ? { systemAudio: "include" } : {}),
        } as DisplayMediaStreamOptions)
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "NotAllowedError")
          throw new Error("No screen was chosen, so the recording did not start.")
        throw mediaError(caught, "screen")
      }
      const stream = display
      cleanups.push(() => stream.getTracks().forEach((track) => track.stop()))
    }

    let mic: MediaStream | null = null
    if (sources.mic) {
      try {
        mic = await navigator.mediaDevices.getUserMedia({
          audio: micId ? { deviceId: { exact: micId } } : true,
        })
      } catch (caught) {
        throw mediaError(caught, "microphone")
      }
      const stream = mic
      cleanups.push(() => stream.getTracks().forEach((track) => track.stop()))
    }

    let speakerRate: number | null = null
    let speakerChannel: { onmessage: (data: ArrayBuffer) => void } | null = null
    if (sources.speaker && desktop) {
      const { Channel } = await import("@tauri-apps/api/core")
      const channel = new Channel<ArrayBuffer>()
      // Samples that arrive before the mixer is ready are dropped.
      channel.onmessage = () => {}
      speakerChannel = channel
      const format = await call<{ sampleRate: number }>("capture_speaker_start", { channel })
      speakerRate = format.sampleRate
      cleanups.push(() => {
        channel.onmessage = () => {}
        void call("capture_speaker_stop").catch(() => {})
      })
    }

    // Every sound source goes through one mixer, so the recording has a single sound track.
    const displayAudio = display?.getAudioTracks() ?? []
    if (sources.speaker && !desktop && displayAudio.length === 0)
      warning = "The speakers are not in this recording. Next time, turn on sharing audio in the screen picker."
    let mixed: MediaStreamTrack[] = []
    if (mic || speakerChannel || displayAudio.length > 0) {
      const context = new AudioContext(speakerRate ? { sampleRate: speakerRate } : undefined)
      cleanups.push(() => void context.close())
      const mix = context.createMediaStreamDestination()
      if (mic) context.createMediaStreamSource(mic).connect(mix)
      if (displayAudio.length > 0) context.createMediaStreamSource(new MediaStream(displayAudio)).connect(mix)
      if (speakerChannel) {
        const url = URL.createObjectURL(new Blob([SPEAKER_WORKLET], { type: "text/javascript" }))
        try {
          await context.audioWorklet.addModule(url)
        } finally {
          URL.revokeObjectURL(url)
        }
        const node = new AudioWorkletNode(context, "novaroom-speaker", {
          numberOfInputs: 0,
          outputChannelCount: [2],
        })
        node.connect(mix)
        speakerChannel.onmessage = (data) => {
          const buffer = data instanceof ArrayBuffer ? data : new Uint8Array(data as unknown as ArrayLike<number>).buffer
          node.port.postMessage(buffer, [buffer])
        }
      }
      // A hidden window can suspend its sound; the recording needs it running.
      if (context.state === "suspended") await context.resume().catch(() => {})
      mixed = mix.stream.getAudioTracks()
    }

    const video = display?.getVideoTracks() ?? []
    const [mimeType, ext] = pickType(video.length > 0)
    const recorder = new MediaRecorder(new MediaStream([...video, ...mixed]), {
      ...(mimeType ? { mimeType } : {}),
      ...(video.length > 0 ? { videoBitsPerSecond: VIDEO_BITS } : {}),
      audioBitsPerSecond: AUDIO_BITS,
    })

    const name = desktop
      ? await call<string>("capture_begin", { name: recordingName(), ext })
      : `${recordingName()}.${ext}`
    let ended = false
    const end = (reason: string) => {
      if (ended) return
      ended = true
      onEnded(reason)
    }

    // Pieces are saved one after another, in order. The browser keeps them until the end.
    const kept: Blob[] = []
    let saving = Promise.resolve()
    let saveError = ""
    recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return
      if (!desktop) {
        kept.push(event.data)
        return
      }
      saving = saving.then(async () => {
        if (saveError) return
        try {
          const bytes = new Uint8Array(await event.data.arrayBuffer())
          const { invoke } = await import("@tauri-apps/api/core")
          await invoke("capture_write", bytes, { headers: { "x-name": name } })
        } catch (caught) {
          saveError = typeof caught === "string" ? caught : "Could not save the recording."
          end(saveError)
        }
      })
    }

    // Stopping from Windows' own "Stop sharing" bar ends the recording too.
    for (const track of video) track.addEventListener("ended", () => end("Screen sharing stopped."))

    const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve()))
    recorder.start(PIECE_MS)

    let finished: Promise<Recording> | null = null
    const stop = () => {
      finished ??= (async () => {
        ended = true
        if (recorder.state !== "inactive") recorder.stop()
        await stopped
        await saving
        cleanUp()
        if (!desktop) {
          const blob = new Blob(kept, { type: mimeType || kept[0]?.type || "video/webm" })
          const link = document.createElement("a")
          link.href = URL.createObjectURL(blob)
          link.download = name
          link.click()
          window.setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
          return { name, size: blob.size, modified: Date.now() }
        }
        const saved = await call<Recording>("capture_finish", { name })
        if (saveError) throw new Error(`${saveError} What was recorded before that is in ${name}.`)
        return saved
      })()
      return finished
    }

    return {
      name,
      preview: display && video.length > 0 ? new MediaStream(video) : null,
      warning,
      pause: () => recorder.state === "recording" && recorder.pause(),
      resume: () => recorder.state === "paused" && recorder.resume(),
      stop,
    }
  } catch (caught) {
    cleanUp()
    throw caught
  }
}
