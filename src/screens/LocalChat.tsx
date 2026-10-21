import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { notifyIncoming, onNotificationClick, windowIsActive } from "../lib/desktop"
import {
  LOCAL_ROOM,
  localChatAvailable,
  localChats,
  localMessages,
  localPeers,
  onLocalChat,
  sendLocalMessage,
  startLocalChat,
  stopLocalChat,
  syncLocalDirectory,
  type LocalChatSummary,
  type LocalMessage,
  type LocalPeer,
} from "../lib/localChat"
import type { Session } from "../types"

// While online, how often to download the registered keys again, so people who set up Local chat
// since can be recognised on the network.
const DIRECTORY_EVERY_MS = 15 * 60 * 1000
const MAX_BODY = 4000

export type LocalChatState = ReturnType<typeof useLocalChat>

/**
 * Runs Local chat for the signed-in account while the app is open, online or not. `offline` says
 * the server cannot be reached, so the list of registered keys is not refreshed.
 */
export function useLocalChat(session: Session | null, name: string, offline: boolean) {
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
      void stopLocalChat().catch(() => {})
    }
    // The name is sent separately below, so renaming does not restart everything.
  }, [available, userId, reloadChats])

  // Others see the new name on their next connection.
  useEffect(() => {
    if (publicKey && userId) void startLocalChat(userId, name).catch(() => {})
  }, [publicKey, userId, name])

  // Register this computer and download everyone's keys whenever the server can be reached.
  useEffect(() => {
    if (!publicKey || !userId || offline) return
    const sync = () =>
      void syncLocalDirectory(userId, publicKey)
        .then(() => setSetupError(""))
        .catch((caught) =>
          setSetupError(caught instanceof Error ? caught.message : "Could not set up Local chat on the server."),
        )
    sync()
    const timer = window.setInterval(sync, DIRECTORY_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [publicKey, userId, offline])

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
          void notifyIncoming(`${message.senderName || "Someone"}${where}`, message.body, `local:${message.chat}`)
        })
      },
      delivered(id) {
        setMessages((current) => current.map((item) => (item.id === id ? { ...item, delivered: true } : item)))
      },
      peers: setPeers,
    })
  }, [publicKey, userId, reloadChats])

  const select = useCallback((chat: string) => {
    setSelected(chat)
    setMessages([])
    setUnread((current) => (current[chat] ? { ...current, [chat]: 0 } : current))
  }, [])

  async function send(body: string) {
    const sent = await sendLocalMessage(selected, body)
    setMessages((current) => [...current, sent])
    reloadChats()
  }

  /** The name to show for a chat: the room's, or the other person's. */
  function chatName(chat: string) {
    if (chat === LOCAL_ROOM) return "Everyone on this network"
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
    chatName,
  }
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase() || "?"
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value))
}

function formatDay(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value))
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
  const online = new Set(local.peers.map((peer) => peer.userId))
  const summaries = new Map(local.chats.map((chat) => [chat.chat, chat]))
  // People here now first, then earlier chats, newest first.
  const direct = [
    ...local.peers.map((peer) => peer.userId),
    ...local.chats.filter((chat) => chat.chat !== LOCAL_ROOM && !online.has(chat.chat)).map((chat) => chat.chat),
  ]
  const room = summaries.get(LOCAL_ROOM)

  const row = (chat: string, hint: string, here: boolean | null) => (
    <button
      key={chat}
      type="button"
      className={chat === local.selected ? "chat-row active" : "chat-row"}
      onClick={() => local.select(chat)}
    >
      <span className="avatar local-avatar">
        {chat === LOCAL_ROOM ? <NetworkIcon /> : <span>{initials(local.chatName(chat))}</span>}
        {here !== null && (
          <span className={`presence-dot local-presence ${here ? "online" : "offline"}`} title={here ? "On this network" : "Not on the network"} />
        )}
      </span>
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
        {direct.map((chat) => row(chat, summaries.get(chat)?.lastBody || "On this network", online.has(chat)))}
      </div>
    </>
  )
}

/** The open Local chat: its messages and the box to write one. */
export function LocalChatThread({ local, userId }: { local: LocalChatState; userId: string }) {
  const [body, setBody] = useState("")
  const [sendError, setSendError] = useState("")
  const logRef = useRef<HTMLDivElement>(null)
  const { setVisible, selected } = local

  useEffect(() => {
    setVisible(true)
    return () => setVisible(false)
  }, [setVisible])

  useEffect(() => {
    setBody("")
    setSendError("")
  }, [selected])

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [local.messages])

  const here = local.peers.some((peer) => peer.userId === selected)
  const isRoom = selected === LOCAL_ROOM

  async function onSend(event: FormEvent) {
    event.preventDefault()
    const text = body.trim()
    if (!text) return
    setSendError("")
    try {
      await local.send(text)
      setBody("")
    } catch (caught) {
      setSendError(caught instanceof Error ? caught.message : "Could not send that message.")
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

  return (
    <section className="thread">
      <header className="thread-bar">
        <div>
          <h1>{local.chatName(selected)}</h1>
          <p className="thread-email">
            {isRoom
              ? "Everyone with Novaroom open on this network. Only people here now receive new messages."
              : here
                ? "On this network now"
                : "Not on the network now. Your messages wait on this computer until they are."}
          </p>
        </div>
      </header>
      {(local.error || local.setupError) && (
        <p className="form-error local-error" role="alert">
          {local.error || `Local chat is not set up on the server yet: ${local.setupError}`}
        </p>
      )}
      <div className="message-log" ref={logRef}>
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
            const avatar = (
              <span className="avatar message-avatar" title={name}>
                <span>{initials(name)}</span>
              </span>
            )
            return (
              <Fragment key={message.id}>
                {newDay && <p className="message-system-note">{day}</p>}
                <div className={mine ? "message-row mine" : "message-row theirs"}>
                  {!mine && avatar}
                  <article className={mine ? "bubble mine" : "bubble theirs"}>
                    {isRoom && !mine && <p className="sender-name">{name}</p>}
                    <p>{message.body}</p>
                    <span className="bubble-meta">
                      <time dateTime={new Date(message.sentAt).toISOString()}>{formatTime(message.sentAt)}</time>
                      {mine &&
                        (message.delivered ? (
                          <svg className="bubble-status" viewBox="0 0 16 16" role="img" aria-label={isRoom ? "Sent" : "Delivered"}>
                            <path d="M3 8.5l3 3 7-7" />
                          </svg>
                        ) : (
                          <span
                            className="bubble-status sending"
                            role="img"
                            aria-label="Waiting for them to come on the network"
                            title="Waiting for them to come on the network"
                          />
                        ))}
                    </span>
                  </article>
                  {mine && avatar}
                </div>
              </Fragment>
            )
          })
        )}
      </div>
      <form className="composer" onSubmit={(event) => void onSend(event)}>
        {sendError && (
          <p className="form-error" role="alert">
            {sendError}
          </p>
        )}
        <div className="composer-row">
          <textarea
            value={body}
            maxLength={MAX_BODY}
            rows={1}
            placeholder={isRoom ? "Write to everyone on this network" : "Write a message"}
            aria-label="Message"
            disabled={!local.running}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <button type="submit" className="button send-button" aria-label="Send" disabled={!local.running || !body.trim()}>
            <SendIcon />
          </button>
        </div>
      </form>
    </section>
  )
}

/**
 * The whole app when it opened without internet: Local chat only, until the server is reached
 * again and the full app takes over.
 */
export function OfflineShell({ local, session, onSignOut }: { local: LocalChatState; session: Session; onSignOut: () => void }) {
  const { select } = local

  // Clicking a Local chat notification opens that chat.
  useEffect(
    () =>
      onNotificationClick((target) => {
        if (target.startsWith("local:")) select(target.slice("local:".length))
      }),
    [select],
  )

  return (
    <div className="offline-shell">
      <p className="offline-banner" role="status">
        <strong>No internet connection.</strong> Local chat works with people on this network. Everything else comes back
        once Novaroom reaches the server again.
        <button type="button" className="text-button" onClick={onSignOut}>
          Sign out
        </button>
      </p>
      <div className="shell offline-shell-body">
        <aside className="rail">
          <LocalChatRail local={local} />
        </aside>
        <LocalChatThread local={local} userId={session.userId} />
      </div>
    </div>
  )
}
