import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { notifyIncoming, windowIsActive } from "../lib/desktop"
import { loadDraft, saveDraft } from "../lib/drafts"
import { useIdle } from "../lib/presence"
import { typingText } from "../lib/typing"
import {
  LOCAL_FILE_LIMIT,
  LOCAL_ROOM,
  clearLocalChat,
  deleteLocalMessages,
  localAvatars,
  localChatAvailable,
  localFileUrl,
  localChats,
  localMessageLabel,
  localMessages,
  localPeers,
  markLocalRead,
  onLocalChat,
  saveLocalFile,
  sendLocalMessage,
  sendLocalTyping,
  setLocalIdle,
  startLocalChat,
  stopLocalChat,
  syncLocalDirectory,
  type LocalChatSummary,
  type LocalMessage,
  type LocalPeer,
} from "../lib/localChat"
import type { Session } from "../types"
import { DownloadIcon, ImageViewer } from "./ImageViewer"
import { ConfirmDialog, SelectCheck, SelectionBar, ThreadMenu, selectableRow, useMessageSelection, type ConfirmAction } from "./ChatTools"

// While online, how often to download the registered keys again, so people who set up Local chat
// since can be recognised on the network.
const DIRECTORY_EVERY_MS = 15 * 60 * 1000
const MAX_BODY = 4000
// As in the other chats: how often "still typing" is sent, and how long it lasts without one.
const TYPING_EVERY_MS = 2500
const TYPING_LASTS_MS = 6000

export type LocalChatState = ReturnType<typeof useLocalChat>

/**
 * Runs Local chat for the signed-in account while the app is open, online or not. `offline` says
 * the server cannot be reached, so the list of registered keys is not refreshed.
 */
export function useLocalChat(session: Session | null, name: string, offline: boolean, avatarUrl: string | null) {
  const available = localChatAvailable()
  const userId = session?.userId ?? null
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [setupError, setSetupError] = useState("")
  const [peers, setPeers] = useState<LocalPeer[]>([])
  const [chats, setChats] = useState<LocalChatSummary[]>([])
  const [selected, setSelected] = useState(LOCAL_ROOM)
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [unread, setUnread] = useState<Record<string, number>>({})
  // Whether the Local chat page is on screen; set by the page that shows it.
  const [visible, setVisible] = useState(false)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  // Who is typing where: chat, then person, then when it runs out.
  const [typing, setTyping] = useState<Record<string, Record<string, number>>>({})
  // Profile pictures from the directory, by account id.
  const [avatars, setAvatars] = useState<Record<string, string>>({})
  const avatarsRef = useRef(avatars)
  avatarsRef.current = avatars
  const reloadAvatars = useCallback(() => {
    void localAvatars()
      .then(setAvatars)
      .catch(() => {})
  }, [])
  const lastTypingRef = useRef<{ chat: string; at: number } | null>(null)

  const reloadChats = useCallback(() => {
    void localChats()
      .then(setChats)
      .catch(() => {})
  }, [])

  // Start for this account; stop on signing out or switching accounts.
  useEffect(() => {
    if (!available || !userId) return
    let active = true
    setError("")
    void startLocalChat(userId, name)
      .then((key) => {
        if (!active) return
        setPublicKey(key)
        void localPeers().then(setPeers).catch(() => {})
        reloadChats()
        reloadAvatars()
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Local chat could not start.")
      })
    return () => {
      active = false
      setPublicKey(null)
      setPeers([])
      setChats([])
      setMessages([])
      setUnread({})
      setAvatars({})
      void stopLocalChat().catch(() => {})
    }
    // The name is sent separately below, so renaming does not restart everything.
  }, [available, userId, reloadChats, reloadAvatars])

  // Others see the new name on their next connection.
  useEffect(() => {
    if (publicKey && userId) void startLocalChat(userId, name).catch(() => {})
  }, [publicKey, userId, name])

  // Share whether this person is idle, again whenever Local chat (re)starts.
  const idle = useIdle(available && userId !== null) === "idle"
  useEffect(() => {
    if (publicKey) void setLocalIdle(idle).catch(() => {})
  }, [publicKey, idle])

  // Register this computer and download everyone's keys whenever the server can be reached.
  useEffect(() => {
    if (!publicKey || !userId || offline) return
    const sync = () =>
      void syncLocalDirectory(userId, publicKey)
        .then(() => {
          setSetupError("")
          reloadAvatars()
        })
        .catch((caught) =>
          setSetupError(caught instanceof Error ? caught.message : "Could not set up Local chat on the server."),
        )
    sync()
    const timer = window.setInterval(sync, DIRECTORY_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [publicKey, userId, offline, reloadAvatars])

  const loadMessages = useCallback((chat: string) => {
    void localMessages(chat)
      .then((loaded) => {
        if (selectedRef.current === chat) setMessages(loaded)
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load messages."))
  }, [])

  useEffect(() => {
    if (publicKey) loadMessages(selected)
  }, [publicKey, selected, loadMessages])

  // Clear the open chat's count whenever it is on screen.
  useEffect(() => {
    if (visible) setUnread((current) => (current[selected] ? { ...current, [selected]: 0 } : current))
  }, [visible, selected])

  useEffect(() => {
    if (!publicKey) return
    return onLocalChat({
      message(message) {
        if (message.chat === selectedRef.current) {
          setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]))
        }
        reloadChats()
        if (message.senderId === userId) return
        void windowIsActive().then((active) => {
          if (active && visibleRef.current && message.chat === selectedRef.current) return
          setUnread((current) => ({ ...current, [message.chat]: (current[message.chat] ?? 0) + 1 }))
          const where = message.chat === LOCAL_ROOM ? " (local network)" : " (local)"
          void notifyIncoming(`${message.senderName || "Someone"}${where}`, localMessageLabel(message), `local:${message.chat}`, {
            name: message.senderName || "Someone",
            avatarUrl: avatarsRef.current[message.senderId] ?? null,
          })
        })
      },
      delivered(id) {
        setMessages((current) => current.map((item) => (item.id === id ? { ...item, delivered: true } : item)))
      },
      peers: setPeers,
      typing({ chat, userId: typist, typing: on }) {
        setTyping((current) => {
          const people = { ...current[chat] }
          if (on) people[typist] = Date.now() + TYPING_LASTS_MS
          else delete people[typist]
          return { ...current, [chat]: people }
        })
      },
      read({ chat, upTo }) {
        if (chat !== selectedRef.current) return
        setMessages((current) =>
          current.map((item) =>
            item.senderId === userId && item.sentAt <= upTo ? { ...item, delivered: true, read: true } : item,
          ),
        )
      },
      file({ id, state }) {
        setMessages((current) =>
          current.map((item) => (item.id === id && item.file ? { ...item, file: { ...item.file, state } } : item)),
        )
      },
    })
  }, [publicKey, userId, reloadChats])

  // A message from someone ends their typing, as does time without a "still typing".
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      setTyping((current) => {
        let changed = false
        const next: typeof current = {}
        for (const [chat, people] of Object.entries(current)) {
          next[chat] = Object.fromEntries(Object.entries(people).filter(([, until]) => until > now))
          changed ||= Object.keys(next[chat]).length !== Object.keys(people).length
        }
        return changed ? next : current
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last) return
    setTyping((current) => {
      if (!current[last.chat]?.[last.senderId]) return current
      const people = { ...current[last.chat] }
      delete people[last.senderId]
      return { ...current, [last.chat]: people }
    })
  }, [messages])

  // While a direct chat is on screen in the focused window, tell the other person it has been read.
  const newestTheirs = [...messages].reverse().find((item) => item.senderId !== userId)?.sentAt
  useEffect(() => {
    if (!publicKey || !visible || selected === LOCAL_ROOM || newestTheirs === undefined) return
    const mark = () => {
      if (document.hasFocus()) void markLocalRead(selected).catch(() => {})
    }
    mark()
    window.addEventListener("focus", mark)
    return () => window.removeEventListener("focus", mark)
  }, [publicKey, visible, selected, newestTheirs])

  const select = useCallback(
    (chat: string) => {
      setUnread((current) => (current[chat] ? { ...current, [chat]: 0 } : current))
      if (chat === selectedRef.current) {
        // Already selected (say, from a notification), so the load above won't run again. Reload
        // rather than clear, in case anything changed while the page was closed.
        if (publicKey) loadMessages(chat)
        return
      }
      setSelected(chat)
      setMessages([])
    },
    [publicKey, loadMessages],
  )

  async function send(body: string, replyTo: string | null, file: File | null) {
    const sent = await sendLocalMessage(selected, body, replyTo, file)
    onType(false)
    setMessages((current) => [...current, sent])
    reloadChats()
  }

  /** Deletes messages of the open chat from this computer. */
  async function deleteMessages(ids: string[]) {
    await deleteLocalMessages(ids)
    const gone = new Set(ids)
    setMessages((current) => current.filter((item) => !gone.has(item.id)))
    reloadChats()
  }

  /** Deletes every message of the open chat from this computer. */
  async function clear() {
    const chat = selected
    await clearLocalChat(chat)
    if (selectedRef.current === chat) setMessages([])
    reloadChats()
  }

  /** Call on every change to the message box; hasText is false once it is empty or sent. */
  function onType(hasText: boolean) {
    if (!publicKey) return
    const last = lastTypingRef.current
    if (!hasText || (last && last.chat !== selected)) {
      if (last) void sendLocalTyping(last.chat, false).catch(() => {})
      lastTypingRef.current = null
      if (!hasText) return
    }
    const now = Date.now()
    if (lastTypingRef.current && now - lastTypingRef.current.at < TYPING_EVERY_MS) return
    lastTypingRef.current = { chat: selected, at: now }
    void sendLocalTyping(selected, true).catch(() => {})
  }

  // Names of others typing in the open chat.
  const typists = Object.keys(typing[selected] ?? {})
    .filter((id) => id !== userId)
    .map((id) => peers.find((peer) => peer.userId === id)?.name || "Someone")

  /** Someone's profile picture address, if known. */
  function avatarOf(id: string) {
    return id === userId ? avatarUrl : (avatars[id] ?? null)
  }

  /** The name to show for a chat: the room's, or the other person's. */
  function chatName(chat: string) {
    if (chat === LOCAL_ROOM) return "Broadcast"
    return (
      peers.find((peer) => peer.userId === chat)?.name ||
      chats.find((item) => item.chat === chat)?.name ||
      "Someone"
    )
  }

  return {
    available,
    running: publicKey !== null,
    error,
    setupError,
    peers,
    chats,
    selected,
    messages,
    unread,
    unreadTotal: Object.values(unread).reduce((sum, count) => sum + count, 0),
    setVisible,
    select,
    send,
    deleteMessages,
    clear,
    onType,
    typists,
    chatName,
    avatarOf,
  }
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase() || "?"
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(
    new Date(value),
  )
}

function formatDay(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value))
}

/**
 * A round profile picture, or initials when there is none or it can't load (Local chat works
 * offline, where pictures from the server don't load).
 */
function LocalAvatar({ name, url, className, children }: { name: string; url: string | null; className: string; children?: ReactNode }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])
  return (
    <span className={`avatar ${className}`} title={name}>
      {url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} /> : <span>{initials(name)}</span>}
      {children}
    </span>
  )
}

function NetworkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3.5" width="6" height="5" rx="1.2" />
      <rect x="3" y="15.5" width="6" height="5" rx="1.2" />
      <rect x="15" y="15.5" width="6" height="5" rx="1.2" />
      <path d="M12 8.5v3.5M6 15.5V12h12v3.5" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12l16-8-6 16-2.5-6.5L4 12z" />
      <path d="M11.5 13.5L20 4" />
    </svg>
  )
}

/** The sidebar: the room, then everyone on the network and earlier direct chats. */
export function LocalChatRail({ local }: { local: LocalChatState }) {
  const online = new Map(local.peers.map((peer) => [peer.userId, peer]))
  const summaries = new Map(local.chats.map((chat) => [chat.chat, chat]))
  // People here now first, then earlier chats, newest first.
  const direct = [
    ...local.peers.map((peer) => peer.userId),
    ...local.chats.filter((chat) => chat.chat !== LOCAL_ROOM && !online.has(chat.chat)).map((chat) => chat.chat),
  ]
  const room = summaries.get(LOCAL_ROOM)

  // here: null for the room, else whether they are on the network and whether they are idle.
  const row = (chat: string, hint: string, here: { idle: boolean } | false | null) => (
    <button
      key={chat}
      type="button"
      className={chat === local.selected ? "chat-row active" : "chat-row"}
      onClick={() => local.select(chat)}
    >
      {chat === LOCAL_ROOM ? (
        <span className="avatar local-avatar">
          <NetworkIcon />
        </span>
      ) : (
        <LocalAvatar name={local.chatName(chat)} url={local.avatarOf(chat)} className="local-avatar">
          {here !== null && (
            <span
              className={`presence-dot local-presence ${!here ? "offline" : here.idle ? "idle" : "online"}`}
              title={!here ? "Not on the network" : here.idle ? "Idle, on this network" : "On this network"}
            />
          )}
        </LocalAvatar>
      )}
      <span className="profile-chip-text">
        <strong>{local.chatName(chat)}</strong>
        <span>{hint}</span>
      </span>
      {local.unread[chat] > 0 && (
        <span className="unread-count">{local.unread[chat] > 9 ? "9+" : local.unread[chat]}</span>
      )}
    </button>
  )

  return (
    <>
      <div className="rail-head">
        <p className="list-label">Local network</p>
      </div>
      <p className="hint local-rail-note">Works without internet, with people on this office network.</p>
      <div className="chat-list local-chat-list">
        {row(
          LOCAL_ROOM,
          room?.lastBody ||
            (local.peers.length === 0 ? "No one else here yet" : local.peers.length === 1 ? "1 person here" : `${local.peers.length} people here`),
          null,
        )}
        {direct.length > 0 && <p className="list-label local-list-label">People</p>}
        {direct.map((chat) => row(chat, summaries.get(chat)?.lastBody || "On this network", online.get(chat) ?? false))}
      </div>
    </>
  )
}

function AttachIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.2-8.2a3.4 3.4 0 0 1 4.8 4.8l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" />
    </svg>
  )
}

function ReplyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.5 6.5L4 12l5.5 5.5" />
      <path d="M4.5 12H14a6 6 0 0 1 6 6v.5" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-10z" />
      <path d="M14 3.5v5h5" />
    </svg>
  )
}

function isImage(mime: string) {
  return mime.startsWith("image/") && mime !== "image/svg+xml"
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** One check when sent or delivered, two when the other person has seen it. */
function LocalStatus({ message, isRoom }: { message: LocalMessage; isRoom: boolean }) {
  if (!isRoom && !message.delivered) {
    return (
      <span
        className="bubble-status sending"
        role="img"
        aria-label="Waiting for them to come on the network"
        title="Waiting for them to come on the network"
      />
    )
  }
  if (!isRoom && message.read) {
    return (
      <svg className="bubble-status double read" viewBox="0 0 20 16" role="img" aria-label="Read">
        <title>Read</title>
        <path d="M1.5 8.5l3 3 7-7" />
        <path d="M8.5 11.5l7-7" />
      </svg>
    )
  }
  const label = isRoom ? "Sent" : "Delivered"
  return (
    <svg className="bubble-status" viewBox="0 0 16 16" role="img" aria-label={label}>
      <title>{label}</title>
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  )
}

/** Asks where to save a message's file, and reports why if it couldn't. */
async function saveFile(id: string, onError: (message: string) => void) {
  onError("")
  try {
    await saveLocalFile(id)
  } catch (caught) {
    onError(caught instanceof Error ? caught.message : "Could not save the file.")
  }
}

/** A message's image, read from this computer once it has arrived, with a save button on hover. */
function LocalImage({
  id,
  name,
  mime,
  onOpen,
  onSave,
}: {
  id: string
  name: string
  mime: string
  onOpen: (url: string) => void
  onSave: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    void localFileUrl(id, mime)
      .then((loaded) => {
        if (active) setUrl(loaded)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [id, mime])

  if (failed) return <p className="local-file-note">This image is no longer on this computer.</p>
  if (!url) return <span className="local-image-placeholder" aria-label="Loading image" />
  return (
    <span className="local-image-wrap">
      <button type="button" className="local-image" title="View larger" onClick={() => onOpen(url)}>
        <img className="bubble-image" src={url} alt={name} />
      </button>
      <button type="button" className="local-image-save" aria-label="Save image" title="Save image" onClick={onSave}>
        <DownloadIcon />
      </button>
    </span>
  )
}

/** A message's file: the image itself, or a card to save it, or a note while it is on its way. */
function LocalFileView({ message, onOpenImage }: { message: LocalMessage; onOpenImage: (url: string, name: string) => void }) {
  const [error, setError] = useState("")
  const file = message.file
  if (!file) return null
  if (file.state === "ready" && isImage(file.mime)) {
    return (
      <>
        <LocalImage
          id={message.id}
          name={file.name}
          mime={file.mime}
          onOpen={(url) => onOpenImage(url, file.name)}
          onSave={() => void saveFile(message.id, setError)}
        />
        {error && <p className="local-file-error">{error}</p>}
      </>
    )
  }
  return (
    <div className="local-file">
      <span className="local-file-icon">
        <FileIcon />
      </span>
      <span className="local-file-text">
        <strong>{file.name}</strong>
        <span>
          {formatBytes(file.size)}
          {file.state === "waiting" && " · Arriving when they are on the network"}
          {file.state === "missing" && " · No longer available"}
        </span>
        {error && <span className="local-file-error">{error}</span>}
      </span>
      {file.state === "ready" && (
        <button
          type="button"
          className="text-button"
          onClick={() => void saveFile(message.id, setError)}
        >
          Save
        </button>
      )}
    </div>
  )
}

/** The open Local chat: its messages and the box to write one. */
export function LocalChatThread({ local, userId }: { local: LocalChatState; userId: string }) {
  const [body, setBody] = useState("")
  const [sendError, setSendError] = useState("")
  const [sending, setSending] = useState(false)
  const [replyTo, setReplyTo] = useState<LocalMessage | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [filePreview, setFilePreview] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [viewing, setViewing] = useState<{ id: string; url: string; name: string } | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  // Whether the message log is at its bottom, so pictures that finish loading keep it there.
  const pinnedRef = useRef(true)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { setVisible, selected } = local
  const closeViewer = useCallback(() => setViewing(null), [])
  // Choosing messages to delete, and the dialog that confirms clearing or deleting.
  const selection = useMessageSelection(selected)
  const [confirm, setConfirm] = useState<{ title: string; text: string; actions: ConfirmAction[] } | null>(null)

  useEffect(() => {
    setVisible(true)
    return () => setVisible(false)
  }, [setVisible])

  // Keeps each chat's unsent text, so leaving the chat or the page does not lose it.
  function updateBody(text: string) {
    setBody(text)
    saveDraft(userId, selected, text)
  }

  useEffect(() => {
    setBody(loadDraft(userId, selected))
    setSendError("")
    setReplyTo(null)
    setFile(null)
    bodyRef.current?.focus()
  }, [selected, userId])

  useEffect(() => {
    const log = logRef.current
    if (!log) return
    log.scrollTop = log.scrollHeight
    pinnedRef.current = true
  }, [local.messages])

  // Grow the message box with its content, from one line up to six (the CSS max-height), then scroll.
  useEffect(() => {
    const box = bodyRef.current
    if (!box) return
    box.style.height = "auto"
    box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`
  }, [body, selected])

  // A small picture of an image about to be sent.
  useEffect(() => {
    if (!file || !isImage(file.type)) {
      setFilePreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setFilePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const peer = local.peers.find((item) => item.userId === selected)
  const here = peer !== undefined
  const isRoom = selected === LOCAL_ROOM
  // A short line under the chat's name; the longer explanation shows on hover.
  const others = local.peers.length
  const status = isRoom
    ? others === 0
      ? "No one else here"
      : others === 1
        ? "1 person here"
        : `${others} people here`
    : !peer
      ? "Not on the network"
      : peer.idle
        ? "Idle"
        : "On this network"
  const statusHint = isRoom
    ? "Everyone with Novaroom open on this network. Only people here now receive new messages."
    : here
      ? "On this network now"
      : "Not on the network now. Your messages wait on this computer until they are."
  const nameOf = (id: string, fallback: string) => (id === userId ? "You" : fallback || "Someone")

  function attach(next: File | undefined) {
    if (!next) return
    if (next.size > LOCAL_FILE_LIMIT) {
      setSendError("Files can be up to 25 MB.")
      return
    }
    setSendError("")
    setFile(next)
    bodyRef.current?.focus()
  }

  function showMessage(id: string) {
    const target = document.getElementById(`local-message-${id}`)
    if (!target) return
    target.scrollIntoView({ block: "center", behavior: "smooth" })
    target.classList.add("flash")
    window.setTimeout(() => target.classList.remove("flash"), 1200)
  }

  // Deleting here only removes messages from this computer; Local chat has no server to delete from.
  function onDeleteChosen() {
    const ids = local.messages.filter((message) => selection.chosen.has(message.id)).map((message) => message.id)
    if (ids.length === 0) return
    const these = ids.length === 1 ? "this message" : `these ${ids.length} messages`
    setConfirm({
      title: ids.length === 1 ? "Delete message?" : `Delete ${ids.length} messages?`,
      text: `This deletes ${these} from this computer. Others keep their copies.`,
      actions: [
        {
          label: "Delete",
          danger: true,
          onSelect: async () => {
            await local.deleteMessages(ids)
            selection.stop()
          },
        },
      ],
    })
  }

  function onClearChat() {
    setConfirm({
      title: "Clear this chat?",
      text: "This deletes every message in this chat from this computer. Others keep their copies.",
      actions: [
        {
          label: "Clear chat",
          danger: true,
          onSelect: async () => {
            await local.clear()
            selection.stop()
          },
        },
      ],
    })
  }

  async function onSend(event: FormEvent) {
    event.preventDefault()
    const text = body.trim()
    if ((!text && !file) || sending) return
    setSendError("")
    setSending(true)
    try {
      await local.send(text, replyTo?.id ?? null, file)
      updateBody("")
      setReplyTo(null)
      setFile(null)
    } catch (caught) {
      setSendError(caught instanceof Error ? caught.message : "Could not send that message.")
    } finally {
      setSending(false)
    }
  }

  if (!local.available) {
    return (
      <section className="thread">
        <div className="thread-empty">
          <h2>Local chat</h2>
          <p>Local chat is only in the Novaroom desktop app.</p>
        </div>
      </section>
    )
  }

  const typingNow = typingText(local.typists.map((name) => ({ userId: name, name })))

  return (
    <section
      className={dragging ? "thread local-thread dragging" : "thread local-thread"}
      onDragOver={(event) => {
        if (!local.running || !event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        setDragging(false)
        attach(event.dataTransfer.files[0])
      }}
    >
      <header className="thread-bar">
        {isRoom ? (
          <span className="avatar local-avatar thread-avatar">
            <NetworkIcon />
          </span>
        ) : (
          <LocalAvatar name={local.chatName(selected)} url={local.avatarOf(selected)} className="local-avatar thread-avatar">
            <span className={`presence-dot thread-presence ${!peer ? "offline" : peer.idle ? "idle" : "online"}`} />
          </LocalAvatar>
        )}
        <div className="thread-who">
          <h1>{local.chatName(selected)}</h1>
          <p className="thread-email" title={statusHint}>
            {status}
          </p>
        </div>
        <div className="thread-actions">
          <ThreadMenu onSelect={selection.start} onClear={onClearChat} disabled={!local.running} />
        </div>
      </header>
      {(local.error || local.setupError) && (
        <p className="form-error local-error" role="alert">
          {local.error || `Local chat is not set up on the server yet: ${local.setupError}`}
        </p>
      )}
      <div
        className={selection.selecting ? "message-log selecting" : "message-log"}
        ref={logRef}
        onScroll={(event) => {
          const log = event.currentTarget
          pinnedRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 80
        }}
        // A picture that loads after the scroll above makes the log taller; stay at the bottom.
        onLoadCapture={() => {
          const log = logRef.current
          if (log && pinnedRef.current) log.scrollTop = log.scrollHeight
        }}
      >
        {local.messages.length === 0 ? (
          <p className="thread-note thread-empty-note">
            {local.running ? "No messages yet. Say hello." : "Starting Local chat…"}
          </p>
        ) : (
          local.messages.map((message, index) => {
            const mine = message.senderId === userId
            const name = message.senderName || "Someone"
            const day = formatDay(message.sentAt)
            const newDay = index === 0 || formatDay(local.messages[index - 1].sentAt) !== day
            const avatar = <LocalAvatar name={name} url={local.avatarOf(message.senderId)} className="message-avatar" />
            const reply = message.replyTo
            const chosen = selection.selecting && selection.chosen.has(message.id)
            return (
              <Fragment key={message.id}>
                {newDay && <p className="message-system-note">{day}</p>}
                <div
                  id={`local-message-${message.id}`}
                  className={`message-row ${mine ? "mine" : "theirs"}${selection.selecting ? " selectable" : ""}${chosen ? " chosen" : ""}`}
                  {...selectableRow(selection, message.id)}
                >
                  {selection.selecting && <SelectCheck checked={chosen} />}
                  {!mine && avatar}
                  <article className={mine ? "bubble mine" : "bubble theirs"}>
                    {reply && (
                      <button type="button" className="bubble-quote" onClick={() => showMessage(reply.id)}>
                        <strong>{nameOf(reply.senderId, reply.senderName)}</strong>
                        <span>{reply.body || (reply.fileName ? `File: ${reply.fileName}` : "")}</span>
                      </button>
                    )}
                    <LocalFileView message={message} onOpenImage={(url, imageName) => setViewing({ id: message.id, url, name: imageName })} />
                    {message.body && <p>{message.body}</p>}
                    <span className="bubble-meta">
                      <time dateTime={new Date(message.sentAt).toISOString()}>{formatTime(message.sentAt)}</time>
                      {mine && <LocalStatus message={message} isRoom={isRoom} />}
                    </span>
                    <button
                      type="button"
                      className={mine ? "bubble-reply mine" : "bubble-reply theirs"}
                      aria-label="Reply"
                      title="Reply"
                      disabled={!local.running}
                      onClick={() => {
                        setReplyTo(message)
                        bodyRef.current?.focus()
                      }}
                    >
                      <ReplyIcon />
                    </button>
                  </article>
                  {mine && avatar}
                </div>
              </Fragment>
            )
          })
        )}
      </div>
      {/* Always there, so the composer does not jump when someone starts or stops typing. */}
      <p className="typing-status" aria-live="polite">
        {typingNow && (
          <>
            <span className="typing-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {typingNow}…
          </>
        )}
      </p>
      {selection.selecting ? (
        <div className="composer">
          <SelectionBar count={selection.chosen.size} onCancel={selection.stop} onDelete={onDeleteChosen} />
        </div>
      ) : (
        <form className="composer" onSubmit={(event) => void onSend(event)}>
          {sendError && (
            <p className="form-error" role="alert">
              {sendError}
            </p>
          )}
          {replyTo && (
            <div className="composer-extra">
              <span className="composer-extra-text">
                <strong>Replying to {nameOf(replyTo.senderId, replyTo.senderName)}</strong>
                <span>{localMessageLabel(replyTo)}</span>
              </span>
              <button type="button" className="composer-extra-close" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
                ×
              </button>
            </div>
          )}
          {file && (
            <div className="composer-extra">
              {filePreview ? (
                <img className="composer-extra-image" src={filePreview} alt="" />
              ) : (
                <span className="local-file-icon">
                  <FileIcon />
                </span>
              )}
              <span className="composer-extra-text">
                <strong>{file.name || "Pasted image"}</strong>
                <span>{formatBytes(file.size)}</span>
              </span>
              <button type="button" className="composer-extra-close" aria-label="Remove file" onClick={() => setFile(null)}>
                ×
              </button>
            </div>
          )}
          <div className="composer-row">
            <input
              ref={fileInputRef}
              type="file"
              hidden
              onChange={(event) => {
                attach(event.target.files?.[0])
                event.target.value = ""
              }}
            />
            <button
              type="button"
              className="attach-button"
              aria-label="Attach a file"
              title="Attach a file"
              disabled={!local.running}
              onClick={() => fileInputRef.current?.click()}
            >
              <AttachIcon />
            </button>
            <textarea
              ref={bodyRef}
              value={body}
              maxLength={MAX_BODY}
              rows={1}
              placeholder={isRoom ? "Write to everyone on this network" : "Write a message"}
              aria-label="Message"
              disabled={!local.running}
              onChange={(event) => {
                updateBody(event.target.value)
                local.onType(event.target.value.trim() !== "")
              }}
              onPaste={(event) => {
                const pasted = event.clipboardData.files[0]
                if (!pasted) return
                event.preventDefault()
                attach(pasted)
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
                if (event.key === "Escape" && replyTo) setReplyTo(null)
              }}
            />
            <button
              type="submit"
              className="button send-button"
              aria-label="Send"
              disabled={!local.running || sending || (!body.trim() && !file)}
            >
              <SendIcon />
            </button>
          </div>
        </form>
      )}
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          Drop a file to send it
        </div>
      )}
      {viewing && (
        <ImageViewer
          url={viewing.url}
          name={viewing.name}
          onSave={async () => {
            await saveLocalFile(viewing.id)
          }}
          onClose={closeViewer}
        />
      )}
      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </section>
  )
}
