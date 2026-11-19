import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  MAX_CALL_PEOPLE,
  clearCallSignals,
  clearOldCallSignals,
  iceServers,
  listCallMemberIds,
  localCallsAvailable,
  onlineCallsAvailable,
  sendCallSignal,
  sendLocalCallSignal,
  subscribeToCallSignals,
  subscribeToLocalCallSignals,
  type CallSignal,
  type CallSignalKind,
  type CallTransport,
} from "../lib/calls"
import {
  addCallRecord,
  clearCallHistory,
  onCallHistoryChange,
  readCallHistory,
  type CallOutcome,
  type CallRecord,
} from "../lib/callHistory"
import { sendMessage } from "../lib/chats"
import { notifyIncoming, windowIsActive } from "../lib/desktop"
import { localAvatars, localPeers } from "../lib/localChat"
import { personById } from "../lib/users"
import type { Session } from "../types"

// How long a call rings before it counts as not answered, and how long two apps get to connect.
const RING_MS = 45 * 1000
const CONNECT_MS = 30 * 1000
// How long the result of a call ("Call ended", "No answer") stays on screen.
const ENDED_SHOWS_MS = 3500
// How long a group call that rang here is offered to join, when nothing says it is over.
const ONGOING_MS = 4 * 60 * 60 * 1000
const NO_ROUTE = "The call could not connect. The network between you may not allow calls."

export type VoiceCallPhase = "calling" | "ringing" | "connecting" | "active" | "ended"

/** Someone else in the call. */
export type CallPeer = {
  userId: string
  name: string
  avatarUrl: string | null
  connected: boolean
  // Whether their camera is on, as their app last said.
  camera: boolean
  // Their sound and picture. Tracks are added to it as they arrive.
  stream: MediaStream
}

export type VoiceCall = {
  id: string
  transport: CallTransport
  conversationId: string
  // The other person, or the group's or room's name.
  title: string
  avatarUrl: string | null
  group: boolean
  // Started as a video call, so cameras come on when it is answered.
  video: boolean
  // "out": this person started or joined it. "in": it rang here.
  direction: "out" | "in"
  // Who rang, for a call that rang here.
  fromId: string | null
  // Everyone else who can be in the call: who the set-up notes go to.
  memberIds: string[]
  phase: VoiceCallPhase
  muted: boolean
  // Whether this person's camera is on.
  camera: boolean
  peers: CallPeer[]
  // When the ringing started, and when people first heard each other (milliseconds since 1970).
  rangAt: number
  startedAt: number | null
  // Why the call ended, or a passing remark.
  note: string
}

/** Who to call: a chat between two people, or a group or room with everyone in it. */
export type CallTarget = {
  transport: CallTransport
  conversationId: string
  title: string
  avatarUrl: string | null
  group: boolean
  // The other person, for a call between two people.
  otherId: string | null
}

type Connection = {
  pc: RTCPeerConnection
  channel: RTCDataChannel | null
  // Ways to reach the other app that arrived before it could be told about them.
  waiting: RTCIceCandidateInit[]
  // Where this person's camera goes out, once the two apps have agreed on it.
  videoSender: RTCRtpSender | null
  attached: boolean
  timer: number
}

/** A repeating tone made in the app, so no sound file is needed. Returns how to stop it. */
function startTone(kind: "ring" | "ringback") {
  let audio: AudioContext
  try {
    audio = new AudioContext()
  } catch {
    return () => {}
  }
  const loud = kind === "ring" ? 0.16 : 0.07
  const beep = (at: number, frequency: number, length: number) => {
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(loud, at + 0.03)
    gain.gain.setValueAtTime(loud, at + length - 0.05)
    gain.gain.linearRampToValueAtTime(0, at + length)
    oscillator.connect(gain).connect(audio.destination)
    oscillator.start(at)
    oscillator.stop(at + length)
  }
  const play = () => {
    const now = audio.currentTime
    if (kind === "ring") {
      beep(now, 660, 0.35)
      beep(now + 0.45, 880, 0.35)
    } else beep(now, 440, 1)
  }
  play()
  const timer = window.setInterval(play, kind === "ring" ? 2000 : 3000)
  return () => {
    window.clearInterval(timer)
    void audio.close().catch(() => undefined)
  }
}

function deviceProblem(caught: unknown, device: "microphone" | "camera") {
  const name = caught instanceof DOMException ? caught.name : ""
  if (name === "NotAllowedError") return `Novaroom is not allowed to use the ${device}. Allow it, then try again.`
  if (name === "NotFoundError") return `No ${device} was found on this computer.`
  if (name === "NotReadableError") return `The ${device} is in use by another app.`
  return `Could not use the ${device}.`
}

type RingPayload = { video?: unknown; group?: unknown; title?: unknown }

/**
 * Everything about calls for one signed-in person, kept outside React because a call outlives
 * renders: making one, being rung, the connections to everyone in it, and its history. One call at
 * a time. `changed` is called whenever there is something new to show.
 */
class CallEngine {
  call: VoiceCall | null = null
  // This person's own camera picture, while it is on.
  preview: MediaStream | null = null
  session: Session
  private changed: () => void
  private connections = new Map<string, Connection>()
  private earlyIce = new Map<string, RTCIceCandidateInit[]>()
  private microphone: MediaStream | null = null
  private cameraTrack: MediaStreamTrack | null = null
  private stopTone: (() => void) | null = null
  private ringTimer = 0
  private clearTimer = 0
  // Group calls that rang here and may still be going on, by chat, so they can be joined later.
  private ongoing = new Map<string, { callId: string; video: boolean; at: number }>()

  constructor(session: Session, changed: () => void) {
    this.session = session
    this.changed = changed
  }

  get busy() {
    return this.call !== null && this.call.phase !== "ended"
  }

  /** A group call in this chat that this person could join now, if one is known. */
  joinable(conversationId: string) {
    const known = this.ongoing.get(conversationId)
    if (!known || Date.now() - known.at > ONGOING_MS) return null
    return this.busy && this.call?.id === known.callId ? null : known
  }

  private set(next: VoiceCall | null) {
    this.call = next
    this.changed()
  }

  private patch(id: string, change: Partial<VoiceCall>) {
    if (this.call && this.call.id === id) this.set({ ...this.call, ...change })
  }

  private patchPeer(id: string, userId: string, change: Partial<CallPeer>) {
    const call = this.call
    if (!call || call.id !== id) return
    this.set({ ...call, peers: call.peers.map((peer) => (peer.userId === userId ? { ...peer, ...change } : peer)) })
  }

  private send(call: VoiceCall, recipientId: string, kind: CallSignalKind, payload?: unknown) {
    if (call.transport === "local") return sendLocalCallSignal(recipientId, { callId: call.id, kind, payload })
    return sendCallSignal(this.session.userId, {
      callId: call.id,
      conversationId: call.conversationId,
      recipientId,
      kind,
      payload,
    })
  }

  /** Sends to everyone who can be in the call. Gives how many it reached and the first problem. */
  private async sendAll(call: VoiceCall, kind: CallSignalKind, payload?: unknown) {
    const results = await Promise.allSettled(call.memberIds.map((id) => this.send(call, id, kind, payload)))
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected")
    return {
      reached: results.filter((result) => result.status === "fulfilled").length,
      problem: failed ? (failed.reason instanceof Error ? failed.reason.message : "Could not reach them.") : "",
    }
  }

  private async describe(transport: CallTransport, userId: string) {
    if (transport === "online") {
      const person = await personById(userId)
      return { name: person?.name || "Someone", avatarUrl: person?.avatarUrl ?? null }
    }
    const [peers, avatars] = await Promise.all([
      localPeers().catch(() => []),
      localAvatars().catch(() => ({}) as Record<string, string>),
    ])
    return { name: peers.find((peer) => peer.userId === userId)?.name || "Someone", avatarUrl: avatars[userId] ?? null }
  }

  // Media ---------------------------------------------------------------------------------------

  private async openMicrophone() {
    this.microphone = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  }

  private async openCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
    })
    const track = stream.getVideoTracks()[0]
    if (!track) throw new DOMException("No camera", "NotFoundError")
    // Unplugging the camera turns it off for everyone.
    track.onended = () => {
      if (this.cameraTrack === track) void this.setCamera(false)
    }
    this.cameraTrack = track
    this.preview = new MediaStream([track])
  }

  private closeCamera() {
    if (this.cameraTrack) {
      this.cameraTrack.onended = null
      this.cameraTrack.stop()
    }
    this.cameraTrack = null
    this.preview = null
  }

  /** Tells everyone in the call whether this person's camera is on. */
  private announceCamera() {
    const note = JSON.stringify({ camera: this.cameraTrack !== null })
    for (const connection of this.connections.values()) {
      if (connection.channel?.readyState === "open") connection.channel.send(note)
    }
  }

  async setCamera(on: boolean) {
    const call = this.call
    if (!call || call.phase === "ended" || call.phase === "ringing") return
    if (on === (this.cameraTrack !== null)) return
    if (on) {
      try {
        await this.openCamera()
      } catch (caught) {
        this.patch(call.id, { note: deviceProblem(caught, "camera") })
        window.setTimeout(() => {
          if (this.call?.id === call.id && this.call.phase !== "ended") this.patch(call.id, { note: "" })
        }, 5000)
        return
      }
      // Hung up while the camera was being asked for.
      if (this.call?.id !== call.id || this.call.phase === "ended") {
        this.closeCamera()
        return
      }
    } else this.closeCamera()
    for (const connection of this.connections.values()) {
      void connection.videoSender?.replaceTrack(this.cameraTrack).catch(() => undefined)
    }
    this.announceCamera()
    this.patch(call.id, { camera: this.cameraTrack !== null, note: "" })
  }

  toggleMute() {
    const call = this.call
    if (!call || call.phase === "ended") return
    const muted = !call.muted
    this.microphone?.getAudioTracks().forEach((track) => {
      track.enabled = !muted
    })
    this.set({ ...call, muted })
  }

  // Connections -----------------------------------------------------------------------------------

  /** Puts this person's microphone, and their camera if it is on, on a connection. */
  private attach(connection: Connection, offering: boolean) {
    if (connection.attached) return
    connection.attached = true
    const { pc } = connection
    this.microphone?.getTracks().forEach((track) => pc.addTrack(track, this.microphone!))
    // A place for video is always agreed, so a camera can come on later without setting up again.
    const video = offering
      ? pc.addTransceiver("video", { direction: "sendrecv" })
      : pc.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === "video")
    if (!video) return
    video.direction = "sendrecv"
    connection.videoSender = video.sender
    if (this.cameraTrack) void video.sender.replaceTrack(this.cameraTrack).catch(() => undefined)
  }

  private watchChannel(call: VoiceCall, userId: string, connection: Connection, channel: RTCDataChannel) {
    connection.channel = channel
    channel.onopen = () => channel.send(JSON.stringify({ camera: this.cameraTrack !== null }))
    channel.onmessage = (event) => {
      try {
        const note = JSON.parse(String(event.data)) as { camera?: unknown }
        if (typeof note.camera === "boolean") this.patchPeer(call.id, userId, { camera: note.camera })
      } catch {
        // Not a note this app understands.
      }
    }
  }

  private connect(call: VoiceCall, userId: string, offering: boolean) {
    const pc = new RTCPeerConnection({ iceServers: iceServers(call.transport) })
    const stream = new MediaStream()
    const connection: Connection = {
      pc,
      channel: null,
      waiting: this.earlyIce.get(userId) ?? [],
      videoSender: null,
      attached: false,
      timer: 0,
    }
    this.earlyIce.delete(userId)
    this.connections.set(userId, connection)
    if (!this.call?.peers.some((peer) => peer.userId === userId)) {
      const peer: CallPeer = { userId, name: "…", avatarUrl: null, connected: false, camera: false, stream }
      this.patch(call.id, { peers: [...(this.call?.peers ?? []), peer] })
      void this.describe(call.transport, userId).then((person) => this.patchPeer(call.id, userId, person))
    } else this.patchPeer(call.id, userId, { connected: false, camera: false, stream })

    pc.onicecandidate = (event) => {
      if (event.candidate) void this.send(call, userId, "ice", event.candidate.toJSON()).catch(() => undefined)
    }
    pc.ontrack = (event) => {
      stream.addTrack(event.track)
      this.changed()
    }
    pc.onconnectionstatechange = () => {
      if (this.connections.get(userId) !== connection) return
      if (pc.connectionState === "connected") {
        window.clearTimeout(connection.timer)
        this.patchPeer(call.id, userId, { connected: true })
        this.patch(call.id, { phase: "active", note: "", startedAt: this.call?.startedAt ?? Date.now() })
      } else if (pc.connectionState === "failed") this.lose(call.id, userId)
    }
    if (offering) {
      this.watchChannel(call, userId, connection, pc.createDataChannel("state"))
      this.attach(connection, true)
    } else pc.ondatachannel = (event) => this.watchChannel(call, userId, connection, event.channel)
    connection.timer = window.setTimeout(() => {
      if (this.connections.get(userId) === connection && pc.connectionState !== "connected") this.lose(call.id, userId)
    }, CONNECT_MS)
    return connection
  }

  private disconnect(userId: string) {
    const connection = this.connections.get(userId)
    if (!connection) return
    this.connections.delete(userId)
    window.clearTimeout(connection.timer)
    connection.pc.onicecandidate = null
    connection.pc.ontrack = null
    connection.pc.onconnectionstatechange = null
    connection.pc.ondatachannel = null
    connection.pc.close()
  }

  /** Takes someone out of the call on this side, and ends the call when nobody is left. */
  private drop(id: string, userId: string, whenEmpty: string) {
    const call = this.call
    if (!call || call.id !== id) return
    this.disconnect(userId)
    this.set({ ...call, peers: call.peers.filter((peer) => peer.userId !== userId) })
    if (this.connections.size === 0 && call.phase !== "calling" && call.phase !== "ringing") {
      // The last one out says the call is over, so nobody is offered to join an empty call.
      if (call.group) void this.sendAll(call, "end", { over: true })
      this.finish(id, whenEmpty)
    }
  }

  /** A connection that never came up, or broke for good. */
  private lose(id: string, userId: string) {
    const call = this.call
    if (!call || call.id !== id) return
    void this.send(call, userId, "end").catch(() => undefined)
    this.drop(id, userId, call.startedAt ? "Call ended" : NO_ROUTE)
  }

  private async flush(connection: Connection) {
    const candidates = connection.waiting
    connection.waiting = []
    for (const candidate of candidates) await connection.pc.addIceCandidate(candidate).catch(() => undefined)
  }

  // Ending ----------------------------------------------------------------------------------------

  private release() {
    window.clearTimeout(this.ringTimer)
    this.stopTone?.()
    this.stopTone = null
    for (const userId of [...this.connections.keys()]) this.disconnect(userId)
    this.earlyIce.clear()
    this.microphone?.getTracks().forEach((track) => track.stop())
    this.microphone = null
    this.closeCamera()
  }

  /** Ends the call on this side, writes it in the history and shows why for a moment. */
  private finish(id: string, note: string, outcome?: CallOutcome) {
    const call = this.call
    if (!call || call.id !== id || call.phase === "ended") return
    this.release()
    const seconds = call.startedAt ? Math.max(0, Math.round((Date.now() - call.startedAt) / 1000)) : 0
    addCallRecord(this.session.userId, {
      id: call.id,
      at: call.rangAt,
      transport: call.transport,
      conversationId: call.conversationId,
      otherId: call.group ? null : (call.memberIds[0] ?? null),
      title: call.title,
      avatarUrl: call.avatarUrl,
      group: call.group,
      video: call.video,
      direction: call.direction,
      outcome: call.startedAt ? "answered" : (outcome ?? "failed"),
      seconds,
    })
    this.set({ ...call, phase: "ended", camera: false, peers: [], note })
    if (call.transport === "online") {
      // The other apps need a moment to receive the last note before the notes are deleted.
      window.setTimeout(() => void clearCallSignals(id).catch(() => undefined), 8000)
    }
    window.clearTimeout(this.clearTimer)
    this.clearTimer = window.setTimeout(() => {
      if (this.call?.id === id) this.set(null)
    }, ENDED_SHOWS_MS)
  }

  /** Declines a ringing call, hangs up any other, or closes the note a finished call left. */
  hangUp() {
    const call = this.call
    if (!call) return
    if (call.phase === "ended") {
      window.clearTimeout(this.clearTimer)
      this.set(null)
      return
    }
    if (call.phase === "ringing") {
      // A group carries on without this person; only a call between two is turned down.
      if (!call.group && call.fromId) void this.send(call, call.fromId, "decline").catch(() => undefined)
      this.finish(call.id, "Call declined", "declined")
      return
    }
    // Leaving a group lets the others carry on, unless nobody else is in it.
    void this.sendAll(call, "end", { over: !call.group || this.connections.size === 0 })
    if (call.group && this.connections.size === 0) this.ongoing.delete(call.conversationId)
    this.finish(call.id, "Call ended", "no-answer")
  }

  /** Signing out, or closing the page. */
  dispose() {
    const call = this.call
    if (call && call.phase !== "ended") {
      void this.sendAll(call, "end", { over: !call.group || this.connections.size === 0 })
    }
    this.release()
    window.clearTimeout(this.clearTimer)
    this.call = null
  }

  // Starting and answering ------------------------------------------------------------------------

  private newCall(target: CallTarget, id: string, video: boolean, memberIds: string[], phase: VoiceCallPhase): VoiceCall {
    return {
      id,
      transport: target.transport,
      conversationId: target.conversationId,
      title: target.title || "Someone",
      avatarUrl: target.avatarUrl,
      group: target.group,
      video,
      direction: "out",
      fromId: null,
      memberIds,
      phase,
      muted: false,
      camera: false,
      peers: [],
      rangAt: Date.now(),
      startedAt: null,
      note: "",
    }
  }

  /** Whether the call is still this one and still going, after waiting for something. */
  private still(id: string) {
    return this.call?.id === id && this.call.phase !== "ended"
  }

  /** Opens the microphone, and the camera for a video call. False if the call ended over it. */
  private async openDevices(call: VoiceCall) {
    try {
      await this.openMicrophone()
    } catch (caught) {
      this.finish(call.id, deviceProblem(caught, "microphone"))
      return false
    }
    if (call.video) {
      try {
        await this.openCamera()
      } catch {
        // No camera: the call goes ahead with sound only.
      }
    }
    if (!this.still(call.id)) {
      this.microphone?.getTracks().forEach((track) => track.stop())
      this.microphone = null
      this.closeCamera()
      return false
    }
    this.patch(call.id, { camera: this.cameraTrack !== null })
    return true
  }

  /** Everyone else in the chat, for a group or room call. Throws when it is too big to call. */
  private async membersOf(target: CallTarget) {
    if (!target.group) return target.otherId ? [target.otherId] : []
    const ids = await listCallMemberIds(target.conversationId)
    if (ids.length > MAX_CALL_PEOPLE) throw new Error(`Calls work in chats of up to ${MAX_CALL_PEOPLE} people.`)
    return ids.filter((id) => id !== this.session.userId)
  }

  /** Calls a person, or everyone in a group or room. */
  async start(target: CallTarget, video: boolean) {
    if (this.busy) return
    window.clearTimeout(this.clearTimer)
    const call = this.newCall(target, crypto.randomUUID(), video, [], "calling")
    this.set(call)
    let memberIds: string[]
    try {
      memberIds = await this.membersOf(target)
    } catch (caught) {
      this.finish(call.id, caught instanceof Error ? caught.message : "Could not start the call.")
      return
    }
    if (!this.still(call.id)) return
    if (memberIds.length === 0) {
      this.finish(call.id, "There is nobody else to call here.")
      return
    }
    this.patch(call.id, { memberIds })
    if (!(await this.openDevices(call))) return
    const ringing = this.call!
    const sent = await this.sendAll(ringing, "ring", { video, group: target.group, title: target.group ? target.title : null })
    if (!this.still(call.id)) return
    if (sent.reached === 0) {
      this.finish(call.id, sent.problem || "Could not start the call.")
      return
    }
    if (target.group) this.ongoing.set(target.conversationId, { callId: call.id, video, at: Date.now() })
    this.stopTone = startTone("ringback")
    this.ringTimer = window.setTimeout(() => {
      const current = this.call
      if (!current || current.id !== call.id || current.phase !== "calling") return
      void this.sendAll(current, "end", { over: true })
      this.ongoing.delete(current.conversationId)
      this.finish(call.id, "No answer", "no-answer")
      // Leaves a trace in the chat, for when they are back.
      if (current.transport === "online" && !current.group) {
        const text = video ? "Missed video call" : "Missed voice call"
        void sendMessage(this.session, current.conversationId, text).catch(() => undefined)
      }
    }, RING_MS)
  }

  /** Joins a group call that is already going on. */
  async join(target: CallTarget) {
    const known = this.joinable(target.conversationId)
    if (!known || this.busy) return
    window.clearTimeout(this.clearTimer)
    const call = this.newCall(target, known.callId, known.video, [], "connecting")
    this.set(call)
    let memberIds: string[]
    try {
      memberIds = await this.membersOf(target)
    } catch (caught) {
      this.finish(call.id, caught instanceof Error ? caught.message : "Could not join the call.")
      return
    }
    if (!this.still(call.id)) return
    this.patch(call.id, { memberIds })
    await this.enter(call.id)
  }

  /** Answers the call that is ringing. */
  async accept() {
    const call = this.call
    if (!call || call.phase !== "ringing") return
    window.clearTimeout(this.ringTimer)
    this.stopTone?.()
    this.stopTone = null
    this.set({ ...call, phase: "connecting" })
    await this.enter(call.id)
  }

  /** Tells everyone in the call that this person is in; each of them then connects to this app. */
  private async enter(id: string) {
    const call = this.call
    if (!call || call.id !== id) return
    if (!(await this.openDevices(call))) return
    const sent = await this.sendAll(this.call!, "accept")
    if (!this.still(id)) return
    if (sent.reached === 0) {
      this.finish(id, sent.problem || "Could not answer the call.")
      return
    }
    // Nobody connecting back means the call is over, or nothing gets through.
    this.ringTimer = window.setTimeout(() => {
      const current = this.call
      if (!current || current.id !== id || current.phase !== "connecting" || this.connections.size > 0) return
      this.ongoing.delete(current.conversationId)
      this.finish(id, current.group ? "That call has ended." : NO_ROUTE)
    }, CONNECT_MS)
  }

  // Signals ---------------------------------------------------------------------------------------

  private async onRing(signal: CallSignal) {
    const payload = (signal.payload ?? {}) as RingPayload
    const video = payload.video === true
    const group = signal.transport === "online" && payload.group === true
    // A ring from long ago, such as one that arrived while this computer was asleep.
    if (Date.now() - new Date(signal.createdAt).getTime() > RING_MS) return
    if (group) this.ongoing.set(signal.conversationId, { callId: signal.callId, video, at: Date.now() })
    if (this.busy) {
      // A group does not need telling; someone calling on their own does.
      if (this.call?.id !== signal.callId && !group) {
        const reply = { callId: signal.callId, kind: "busy" as const }
        if (signal.transport === "local") void sendLocalCallSignal(signal.senderId, reply).catch(() => undefined)
        else {
          void sendCallSignal(this.session.userId, {
            ...reply,
            conversationId: signal.conversationId,
            recipientId: signal.senderId,
          }).catch(() => undefined)
        }
      }
      return
    }
    window.clearTimeout(this.clearTimer)
    const [caller, members] = await Promise.all([
      this.describe(signal.transport, signal.senderId),
      group ? listCallMemberIds(signal.conversationId).catch(() => [signal.senderId]) : Promise.resolve([signal.senderId]),
    ])
    // Another call may have got through while that was looked up.
    if (this.busy) return
    const title = group
      ? typeof payload.title === "string" && payload.title.trim()
        ? payload.title.trim().slice(0, 80)
        : "Group call"
      : caller.name
    const ringing: VoiceCall = {
      id: signal.callId,
      transport: signal.transport,
      conversationId: signal.conversationId,
      title,
      avatarUrl: group ? null : caller.avatarUrl,
      group,
      video,
      direction: "in",
      fromId: signal.senderId,
      memberIds: members.filter((id) => id !== this.session.userId),
      phase: "ringing",
      muted: false,
      camera: false,
      peers: [],
      rangAt: Date.now(),
      startedAt: null,
      note: group ? `${caller.name} started a ${video ? "video" : "voice"} call` : "",
    }
    this.set(ringing)
    this.stopTone?.()
    this.stopTone = startTone("ring")
    window.clearTimeout(this.ringTimer)
    this.ringTimer = window.setTimeout(() => this.finish(ringing.id, "Missed call", "missed"), RING_MS)
    if (!(await windowIsActive())) {
      const target = signal.transport === "local" ? `local:${signal.senderId}` : `chat:${signal.conversationId}`
      void notifyIncoming(title, video ? "Incoming video call" : "Incoming voice call", target, caller)
    }
  }

  async onSignal(signal: CallSignal) {
    if (signal.senderId === this.session.userId) return
    if (signal.kind === "ring") {
      await this.onRing(signal)
      return
    }
    const over = ((signal.payload ?? {}) as { over?: unknown }).over === true
    const call = this.call
    if (!call || call.id !== signal.callId || call.phase === "ended") {
      // A call this person is not in has finished: it is no longer offered to join.
      if (signal.kind === "end" && over && this.ongoing.get(signal.conversationId)?.callId === signal.callId) {
        this.ongoing.delete(signal.conversationId)
        this.changed()
      }
      return
    }
    const from = signal.senderId
    const inCall = call.phase !== "ringing"
    try {
      if (signal.kind === "accept") {
        // Whoever is already in the call connects to the one who came in.
        if (!inCall || this.connections.has(from)) return
        this.stopTone?.()
        this.stopTone = null
        window.clearTimeout(this.ringTimer)
        if (call.phase === "calling") this.patch(call.id, { phase: "connecting" })
        const connection = this.connect(this.call!, from, true)
        const offer = await connection.pc.createOffer()
        await connection.pc.setLocalDescription(offer)
        await this.send(call, from, "offer", { type: offer.type, sdp: offer.sdp })
      } else if (signal.kind === "offer") {
        if (!inCall) return
        let connection = this.connections.get(from)
        if (connection && connection.pc.signalingState === "have-local-offer") {
          // Two people came in at the same moment and each offered to the other. The one whose
          // account id sorts first keeps their offer; the other takes it.
          if (this.session.userId < from) return
          this.disconnect(from)
          connection = undefined
        }
        connection ??= this.connect(this.call!, from, false)
        window.clearTimeout(this.ringTimer)
        await connection.pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit)
        this.attach(connection, false)
        await this.flush(connection)
        const answer = await connection.pc.createAnswer()
        await connection.pc.setLocalDescription(answer)
        await this.send(call, from, "answer", { type: answer.type, sdp: answer.sdp })
      } else if (signal.kind === "answer") {
        const connection = this.connections.get(from)
        if (!connection || connection.pc.signalingState !== "have-local-offer") return
        await connection.pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit)
        await this.flush(connection)
      } else if (signal.kind === "ice") {
        const candidate = signal.payload as RTCIceCandidateInit
        const connection = this.connections.get(from)
        if (connection?.pc.remoteDescription) await connection.pc.addIceCandidate(candidate).catch(() => undefined)
        else if (connection) connection.waiting.push(candidate)
        else this.earlyIce.set(from, [...(this.earlyIce.get(from) ?? []), candidate].slice(-50))
      } else if (signal.kind === "decline" || signal.kind === "busy") {
        if (call.group || call.phase !== "calling") return
        if (signal.kind === "decline") this.finish(call.id, "Call declined", "declined")
        else this.finish(call.id, `${call.title} is on another call`, "busy")
      } else if (signal.kind === "end") {
        if (over) this.ongoing.delete(call.conversationId)
        if (call.phase === "ringing") {
          if (from === call.fromId && (!call.group || over)) this.finish(call.id, "Missed call", "missed")
        } else if (this.connections.has(from)) this.drop(call.id, from, "Call ended")
        else if (!call.group && call.phase === "connecting") this.finish(call.id, "Call ended")
      }
    } catch {
      this.lose(call.id, from)
    }
  }
}

/**
 * Voice and video calls for the signed-in person, through the server and over the office network.
 * `offline` is true where there is no server to go through, so only the office network is listened to.
 */
export function useVoiceCall(session: Session | null, offline = false) {
  const [, setVersion] = useState(0)
  const engine = useRef<CallEngine | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const userId = session?.userId ?? null
  const online = !offline && onlineCallsAvailable()
  const local = localCallsAvailable()

  // One engine per signed-in person, listening for calls for as long as they are signed in.
  useEffect(() => {
    if (!session || (!online && !local)) return
    const created = new CallEngine(session, () => setVersion((version) => version + 1))
    engine.current = created
    const stops: Array<() => void> = []
    if (online) {
      void clearOldCallSignals().catch(() => undefined)
      stops.push(subscribeToCallSignals(session.userId, (signal) => void created.onSignal(signal)))
    }
    if (local) stops.push(subscribeToLocalCallSignals((signal) => void created.onSignal(signal)))
    setVersion((version) => version + 1)
    return () => {
      stops.forEach((stop) => stop())
      created.dispose()
      if (engine.current === created) engine.current = null
    }
    // The engine belongs to the account, not to each new copy of its session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, online, local])
  if (engine.current && session) engine.current.session = session

  const current = engine.current
  return {
    online,
    local,
    userId,
    call: current?.call ?? null,
    preview: current?.preview ?? null,
    // True while a call is being made, ringing or under way.
    busy: current?.busy ?? false,
    /** A group call going on in this chat that could be joined, if one is known. */
    joinable: (conversationId: string) => current?.joinable(conversationId) ?? null,
    start: (target: CallTarget, video: boolean) => void current?.start(target, video),
    join: (target: CallTarget) => void current?.join(target),
    accept: () => void current?.accept(),
    hangUp: () => current?.hangUp(),
    toggleMute: () => current?.toggleMute(),
    toggleCamera: () => void current?.setCamera(!current.call?.camera),
    historyOpen,
    openHistory: () => setHistoryOpen(true),
    closeHistory: () => setHistoryOpen(false),
  }
}

export type VoiceCallState = ReturnType<typeof useVoiceCall>

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  )
}

function clock(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}

export function CallIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.5 6a2 2 0 0 1 2-2Z" />
    </svg>
  )
}

export function VideoIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="6.5" width="12" height="11" rx="2.5" />
      <path d="m15 10.5 5.5-3v9l-5.500-3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  )
}

function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3.5" width="6" height="10.5" rx="3" />
      <path d="M5.5 11.5a6.500 6.500 0 0 0 13 0M12 18v2.500" />
      {muted && <path d="M4.500 4.500l15 15" />}
    </svg>
  )
}

/**
 * The buttons that start a call in a chat's header: voice and video, or "Join" while a group call
 * is known to be going on there.
 */
export function CallButtons({
  voice,
  target,
  blockedHint,
}: {
  voice: VoiceCallState
  target: CallTarget
  // Why this chat cannot be called right now, if it cannot.
  blockedHint?: string
}) {
  if (target.transport === "online" ? !voice.online : !voice.local) return null
  const joinable = target.group ? voice.joinable(target.conversationId) : null
  const disabled = voice.busy || Boolean(blockedHint)
  const hint = (action: string) => blockedHint || (voice.busy ? "You are already on a call" : action)
  if (joinable) {
    return (
      <button
        type="button"
        className="button secondary thread-call-join"
        title={hint(`Join the ${joinable.video ? "video" : "voice"} call going on in ${target.title}`)}
        disabled={disabled}
        onClick={() => voice.join(target)}
      >
        <CallIcon /> Join call
      </button>
    )
  }
  return (
    <>
      <button
        type="button"
        className="icon-button thread-call"
        aria-label={`Voice call with ${target.title}`}
        title={hint(`Voice call with ${target.title}`)}
        disabled={disabled}
        onClick={() => voice.start(target, false)}
      >
        <CallIcon />
      </button>
      <button
        type="button"
        className="icon-button thread-call"
        aria-label={`Video call with ${target.title}`}
        title={hint(`Video call with ${target.title}`)}
        disabled={disabled}
        onClick={() => voice.start(target, true)}
      >
        <VideoIcon />
      </button>
    </>
  )
}

/** Plays a stream: someone's sound and picture, or this person's own camera (silent). */
function CallMedia({ stream, silent }: { stream: MediaStream; silent?: boolean }) {
  const element = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    if (element.current && element.current.srcObject !== stream) element.current.srcObject = stream
  }, [stream])
  return <video ref={element} autoPlay playsInline muted={silent} />
}

function PeerTile({ peer }: { peer: CallPeer }) {
  return (
    <div className={peer.camera ? "voice-call-tile camera" : "voice-call-tile"}>
      <CallMedia stream={peer.stream} />
      {!peer.camera && (
        <span className="avatar voice-call-avatar" aria-hidden="true">
          {peer.avatarUrl ? <img src={peer.avatarUrl} alt="" /> : <span>{initials(peer.name)}</span>}
        </span>
      )}
      <span className="voice-call-name">
        {peer.name}
        {!peer.connected && " · connecting…"}
      </span>
    </div>
  )
}

const OUTCOMES: Record<CallOutcome, string> = {
  answered: "",
  missed: "Missed",
  declined: "Declined",
  "no-answer": "No answer",
  busy: "Busy",
  failed: "Did not connect",
}

/** The calls made and received on this computer, newest first, each with buttons to call again. */
function CallHistoryDialog({ voice }: { voice: VoiceCallState }) {
  const { userId, closeHistory } = voice
  const [records, setRecords] = useState<CallRecord[]>(() => (userId ? readCallHistory(userId) : []))

  useEffect(() => {
    if (!userId) return
    return onCallHistoryChange(() => setRecords(readCallHistory(userId)))
  }, [userId])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeHistory()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [closeHistory])

  const target = (record: CallRecord): CallTarget => ({
    transport: record.transport,
    conversationId: record.conversationId,
    title: record.title,
    avatarUrl: record.avatarUrl,
    group: record.group,
    otherId: record.otherId,
  })

  return createPortal(
    <div className="desk-backdrop" onPointerDown={(event) => event.target === event.currentTarget && closeHistory()}>
      <div className="vault-modal call-history" role="dialog" aria-label="Call history">
        <div className="vault-modal-head">
          <h2>Call history</h2>
          <button type="button" className="vault-remove" aria-label="Close" title="Close" onClick={closeHistory}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {records.length === 0 ? (
          <p className="hint">No calls yet. Calls you make and receive on this computer are listed here.</p>
        ) : (
          <ul className="call-history-list">
            {records.map((record) => {
              const reachable = record.transport === "online" ? voice.online : voice.local
              const missed = record.outcome === "missed"
              return (
                <li key={record.id} className={missed ? "missed" : undefined}>
                  <span className="avatar call-history-avatar" aria-hidden="true">
                    {record.avatarUrl ? <img src={record.avatarUrl} alt="" /> : <span>{initials(record.title)}</span>}
                  </span>
                  <div className="call-history-who">
                    <strong>{record.title}</strong>
                    <span>
                      {record.direction === "in" ? "Incoming" : "Outgoing"} {record.video ? "video" : "voice"} call
                      {record.transport === "local" ? " · Local network" : ""}
                      {record.outcome === "answered" ? ` · ${clock(record.seconds)}` : ` · ${OUTCOMES[record.outcome]}`}
                    </span>
                    <span>{new Date(record.at).toLocaleString()}</span>
                  </div>
                  {reachable && (
                    <div className="call-history-actions">
                      <button
                        type="button"
                        className="icon-button thread-call"
                        aria-label={`Voice call with ${record.title}`}
                        title={voice.busy ? "You are already on a call" : `Voice call with ${record.title}`}
                        disabled={voice.busy}
                        onClick={() => {
                          voice.start(target(record), false)
                          closeHistory()
                        }}
                      >
                        <CallIcon />
                      </button>
                      <button
                        type="button"
                        className="icon-button thread-call"
                        aria-label={`Video call with ${record.title}`}
                        title={voice.busy ? "You are already on a call" : `Video call with ${record.title}`}
                        disabled={voice.busy}
                        onClick={() => {
                          voice.start(target(record), true)
                          closeHistory()
                        }}
                      >
                        <VideoIcon />
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {records.length > 0 && userId && (
          <div className="form-actions">
            <button
              type="button"
              className="button secondary vault-small"
              onClick={() => {
                if (window.confirm("Clear the call history on this computer?")) clearCallHistory(userId)
              }}
            >
              Clear history
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/**
 * The call on screen, over whatever page is open: who it is with and how it is going, with the
 * buttons to answer, mute, turn the camera on and hang up. A call with pictures or several people
 * opens into tiles. It also plays everyone's sound, and holds the call history.
 */
export function VoiceCallBar({ voice }: { voice: VoiceCallState }) {
  const { call, preview } = voice
  const [, setTick] = useState(0)
  const [large, setLarge] = useState(false)

  // The call's length counts up once a second.
  const counting = call?.phase === "active"
  useEffect(() => {
    if (!counting) return
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 1000)
    return () => window.clearInterval(timer)
  }, [counting])

  const history = voice.historyOpen ? <CallHistoryDialog voice={voice} /> : null
  if (!call) return history
  const ringing = call.phase === "ringing"
  const live = call.phase !== "ended" && !ringing
  // Tiles for a call with pictures or several people; otherwise a small bar.
  const tiles = live && (call.group || call.camera || call.peers.some((peer) => peer.camera))
  const length = clock(Math.max(0, Math.floor((Date.now() - (call.startedAt ?? Date.now())) / 1000)))
  const status =
    call.phase === "ended"
      ? call.note
      : call.note ||
        (call.phase === "calling"
          ? "Calling…"
          : ringing
            ? call.video
              ? "Incoming video call"
              : "Incoming voice call"
            : call.phase === "connecting"
              ? "Connecting…"
              : call.group
                ? `${length} · ${call.peers.length + 1} in the call`
                : length)

  return (
    <>
      {history}
      {createPortal(
        <div
          className={["voice-call", call.phase, tiles && "tiles", tiles && large && "large"].filter(Boolean).join(" ")}
          role="dialog"
          aria-label={`Call with ${call.title}`}
        >
          {tiles ? (
            <div className="voice-call-stage" data-count={Math.min(call.peers.length, 6)}>
              {call.peers.length === 0 && <p className="voice-call-waiting">Waiting for others to join…</p>}
              {call.peers.map((peer) => (
                <PeerTile key={peer.userId} peer={peer} />
              ))}
              {preview && (
                <div className="voice-call-self" title="Your camera">
                  <CallMedia stream={preview} silent />
                </div>
              )}
            </div>
          ) : (
            // Everyone's sound still plays while the call is a small bar.
            <div className="voice-call-sound" aria-hidden="true">
              {call.peers.map((peer) => (
                <CallMedia key={peer.userId} stream={peer.stream} />
              ))}
            </div>
          )}
          <div className="voice-call-row">
            <span className="avatar voice-call-avatar" aria-hidden="true">
              {call.avatarUrl ? <img src={call.avatarUrl} alt="" /> : <span>{initials(call.title)}</span>}
            </span>
            <div className="voice-call-who">
              <strong>{call.title}</strong>
              <span role="status">{status}</span>
            </div>
            <div className="voice-call-actions">
              {ringing && (
                <button type="button" className="voice-call-button accept" aria-label="Answer" title="Answer" onClick={voice.accept}>
                  {call.video ? <VideoIcon /> : <CallIcon />}
                </button>
              )}
              {live && (
                <>
                  <button
                    type="button"
                    className="voice-call-button"
                    aria-pressed={call.muted}
                    aria-label={call.muted ? "Turn the microphone on" : "Mute the microphone"}
                    title={call.muted ? "Your microphone is off. Click to turn it on." : "Mute the microphone"}
                    onClick={voice.toggleMute}
                  >
                    <MicIcon muted={call.muted} />
                  </button>
                  <button
                    type="button"
                    className="voice-call-button"
                    aria-pressed={!call.camera}
                    aria-label={call.camera ? "Turn the camera off" : "Turn the camera on"}
                    title={call.camera ? "Turn the camera off" : "Your camera is off. Click to turn it on."}
                    onClick={voice.toggleCamera}
                  >
                    <VideoIcon off={!call.camera} />
                  </button>
                  {tiles && (
                    <button
                      type="button"
                      className="voice-call-button"
                      aria-pressed={large}
                      aria-label={large ? "Make the call smaller" : "Make the call bigger"}
                      title={large ? "Make the call smaller" : "Make the call bigger"}
                      onClick={() => setLarge(!large)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d={large ? "M9 4v5H4M15 20v-5h5M20 9h-5V4M4 15h5v5" : "M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5"} />
                      </svg>
                    </button>
                  )}
                </>
              )}
              {call.phase === "ended" ? (
                <button type="button" className="voice-call-button" aria-label="Close" title="Close" onClick={voice.hangUp}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              ) : (
                <button
                  type="button"
                  className="voice-call-button hang-up"
                  aria-label={ringing ? "Decline" : call.group ? "Leave the call" : "Hang up"}
                  title={ringing ? "Decline" : call.group ? "Leave the call" : "Hang up"}
                  onClick={voice.hangUp}
                >
                  <CallIcon />
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
