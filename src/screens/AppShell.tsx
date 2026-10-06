import { useEffect, useRef, useState, type FormEvent } from "react"
import { useAuth } from "../auth"
import { notifyIncoming, setTaskbarBadge, windowIsActive } from "../lib/desktop"
import { readUnread, unreadTotal, writeUnread } from "../lib/unread"
import {
  blockUser,
  deleteOwnMessage,
  listBlocked,
  messagingLock,
  messagingLockMessage,
  reportMessage,
  unblockUser,
  type MessagingLock,
  type ReportReason,
} from "../lib/safety"
import {
  listChats,
  loadMessages,
  messageLabel,
  sendMessage,
  startDirectChat,
  startGroupChat,
  subscribeToMessages,
  type ChatMessage,
  type ChatSummary,
} from "../lib/chats"
import { Settings } from "./Settings"
import {
  addRoomResource,
  deleteRoomResource,
  joinRoom,
  leaveRoom,
  listRoomResources,
  listRooms,
  type RoomInfo,
  type RoomResource,
} from "../lib/rooms"

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function isImage(mime: string | null) {
  return Boolean(mime?.startsWith("image/") && mime !== "image/svg+xml")
}

export function AppShell() {
  const { session, profile } = useAuth()
  const [view, setView] = useState<"chats" | "settings">("chats")
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [email, setEmail] = useState("")
  const [groupTitle, setGroupTitle] = useState("")
  const [groupEmails, setGroupEmails] = useState("")
  const [body, setBody] = useState("")
  const [attachment, setAttachment] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState("")
  const [startError, setStartError] = useState("")
  const [sendError, setSendError] = useState("")
  const [busy, setBusy] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [blockedIds, setBlockedIds] = useState<string[]>([])
  const [lock, setLock] = useState<MessagingLock>("open")
  const [reportId, setReportId] = useState<string | null>(null)
  const [reportReason, setReportReason] = useState<ReportReason>("harassment")
  const [reportNote, setReportNote] = useState("")
  const [reportSaved, setReportSaved] = useState(false)
  const [rooms, setRooms] = useState<RoomInfo[]>([])
  const [resources, setResources] = useState<RoomResource[]>([])
  const [pinTitle, setPinTitle] = useState("")
  const [pinUrl, setPinUrl] = useState("")
  const [pinError, setPinError] = useState("")
  const selectedRef = useRef<string | null>(null)
  const blockedRef = useRef<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)
  selectedRef.current = selectedId
  blockedRef.current = blockedIds

  useEffect(() => {
    if (!session) return
    let active = true
    void listRooms(session)
      .then((next) => {
        if (active) setRooms(next)
      })
      .catch((caught) => {
        if (active) setStartError(caught instanceof Error ? caught.message : "Could not load rooms.")
      })
    return () => {
      active = false
    }
  }, [session])

  useEffect(() => {
    if (!session || !selectedId) {
      setResources([])
      return
    }
    const open = chats.find((chat) => chat.id === selectedId)
    if (open && open.kind !== "room") {
      setResources([])
      return
    }
    let active = true
    void listRoomResources(session, selectedId)
      .then((next) => {
        if (active) setResources(next)
      })
      .catch(() => {
        if (active) setResources([])
      })
    return () => {
      active = false
    }
  }, [session, selectedId, chats])

  useEffect(() => {
    if (!session) return
    let active = true
    listChats(session)
      .then((next) => {
        if (active) setChats(next)
      })
      .catch((caught) => {
        if (active) {
          setStartError(caught instanceof Error ? caught.message : "Could not load chats.")
        }
      })
    return () => {
      active = false
    }
  }, [session])

  useEffect(() => {
    setSelectedId(null)
    setMessages([])
    if (!session) {
      setUnread({})
      void setTaskbarBadge(0)
      return
    }
    const counts = readUnread(session.userId)
    setUnread(counts)
    void setTaskbarBadge(unreadTotal(counts))
  }, [session?.userId])

  useEffect(() => {
    if (!selectedId) {
      setMessages([])
      setLoadingMessages(false)
      return
    }
    let active = true
    setLoadingMessages(true)
    loadMessages(selectedId)
      .then((next) => {
        if (active) setMessages(next)
      })
      .catch((caught) => {
        if (active) {
          setSendError(caught instanceof Error ? caught.message : "Could not load messages.")
        }
      })
      .finally(() => {
        if (active) setLoadingMessages(false)
      })
    return () => {
      active = false
    }
  }, [selectedId])

  useEffect(() => {
    if (!session) return
    let active = true
    const load = () => {
      void listBlocked(session)
        .then((people) => {
          if (!active) return
          setBlockedIds(people.map((person) => person.userId))
          void listChats(session).then((next) => {
            if (active) setChats(next)
          })
          const openId = selectedRef.current
          if (!openId) return
          void loadMessages(openId).then((next) => {
            if (active && selectedRef.current === openId) setMessages(next)
          })
        })
        .catch(() => undefined)
    }
    load()
    window.addEventListener("novaroom-safety", load)
    return () => {
      active = false
      window.removeEventListener("novaroom-safety", load)
    }
  }, [session])

  useEffect(() => {
    if (!session || !selectedId) {
      setLock("open")
      return
    }
    let active = true
    void messagingLock(session, selectedId)
      .then((next) => {
        if (active) setLock(next)
      })
      .catch(() => {
        if (active) setLock("open")
      })
    return () => {
      active = false
    }
  }, [session, selectedId, blockedIds])

  useEffect(() => {
    if (!session) return
    const remember = (message: ChatMessage) => {
      setChats((current) => {
        const found = current.some((chat) => chat.id === message.conversationId)
        if (!found) {
          void listChats(session).then(setChats).catch(() => undefined)
          return current
        }
        return current
          .map((chat) => {
            if (chat.id !== message.conversationId) return chat
            if (chat.lastAt && message.createdAt < chat.lastAt) return chat
            return { ...chat, lastBody: messageLabel(message), lastAt: message.createdAt }
          })
          .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""))
      })
    }
    return subscribeToMessages({
      onInsert(message) {
        if (message.senderId !== session.userId && blockedRef.current.includes(message.senderId)) return
        remember(message)
        if (message.senderId !== session.userId) {
          void windowIsActive().then((active) => {
            const viewing = active && message.conversationId === selectedRef.current
            if (viewing) return
            setUnread((current) => {
              const next = {
                ...current,
                [message.conversationId]: (current[message.conversationId] ?? 0) + 1,
              }
              writeUnread(session.userId, next)
              void setTaskbarBadge(unreadTotal(next))
              return next
            })
            void notifyIncoming(message.senderName || "Novaroom", messageLabel(message))
          })
        }
        setMessages((current) => {
          if (message.conversationId !== selectedRef.current) return current
          if (current.some((item) => item.id === message.id)) return current
          return [...current, message]
        })
      },
      onUpdate(message) {
        remember(message)
        setMessages((current) => current.map((item) => (item.id === message.id ? { ...item, ...message } : item)))
      },
      onRefresh() {
        void listChats(session).then(setChats).catch(() => undefined)
        const openId = selectedRef.current
        if (!openId) return
        void loadMessages(openId).then(setMessages).catch(() => undefined)
      },
    })
  }, [session])

  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, selectedId])

  if (!session || !profile) return null

  const selected = chats.find((chat) => chat.id === selectedId) ?? null
  const readable = messages.filter(
    (message) => message.senderId === session.userId || !blockedIds.includes(message.senderId),
  )
  const query = search.trim().toLowerCase()
  const visible = query
    ? readable.filter((message) => {
        const haystack = message.deleted
          ? "message deleted"
          : `${message.body} ${message.attachmentName ?? ""}`
        return haystack.toLowerCase().includes(query)
      })
    : readable
  const closed = lock !== "open"
  const reporting = visible.find((message) => message.id === reportId) ?? null

  function replaceMessage(message: ChatMessage) {
    setMessages((current) => current.map((item) => (item.id === message.id ? { ...item, ...message } : item)))
    setChats((current) =>
      current.map((chat) => {
        if (chat.id !== message.conversationId) return chat
        if (chat.lastAt && message.createdAt < chat.lastAt) return chat
        return { ...chat, lastBody: messageLabel(message), lastAt: message.createdAt }
      }),
    )
  }

  async function onBlock(userId: string, block: boolean) {
    setSendError("")
    try {
      if (block) await blockUser(session!, userId)
      else await unblockUser(session!, userId)
    } catch (caught) {
      setSendError(caught instanceof Error ? caught.message : "Could not update that block.")
    }
  }

  async function onDelete(message: ChatMessage) {
    if (!window.confirm("Delete this message? People in the chat will see that it was removed.")) return
    setSendError("")
    try {
      await deleteOwnMessage(session!, message.id)
      replaceMessage({
        ...message,
        deleted: true,
        body: "",
        attachmentUrl: null,
        attachmentName: null,
        attachmentMime: null,
        attachmentSize: null,
      })
    } catch (caught) {
      setSendError(caught instanceof Error ? caught.message : "Could not delete that message.")
    }
  }

  async function onReport() {
    if (!reporting) return
    setSendError("")
    setReportSaved(false)
    try {
      await reportMessage(session!, reporting, reportReason, reportNote)
      setReportSaved(true)
      setReportId(null)
      setReportNote("")
    } catch (caught) {
      setSendError(caught instanceof Error ? caught.message : "Could not send that report.")
    }
  }

  async function onJoin(roomId: string) {
    setStartError("")
    setBusy(true)
    try {
      await joinRoom(session!, roomId)
      const [nextChats, nextRooms] = await Promise.all([listChats(session!), listRooms(session!)])
      setChats(nextChats)
      setRooms(nextRooms)
      setLoadingMessages(true)
      setMessages([])
      setSelectedId(roomId)
      setView("chats")
      setSearch("")
    } catch (caught) {
      setStartError(caught instanceof Error ? caught.message : "Could not join that room.")
    } finally {
      setBusy(false)
    }
  }

  async function onLeave(roomId: string) {
    setSendError("")
    try {
      await leaveRoom(session!, roomId)
      if (selectedId === roomId) {
        setSelectedId(null)
        setMessages([])
        setResources([])
      }
      const [nextChats, nextRooms] = await Promise.all([listChats(session!), listRooms(session!)])
      setChats(nextChats)
      setRooms(nextRooms)
    } catch (caught) {
      setSendError(caught instanceof Error ? caught.message : "Could not leave that room.")
    }
  }

  async function onAddPin(event: FormEvent) {
    event.preventDefault()
    if (!selectedId) return
    setPinError("")
    try {
      await addRoomResource(session!, selectedId, pinTitle, pinUrl)
      setPinTitle("")
      setPinUrl("")
      setResources(await listRoomResources(session!, selectedId))
    } catch (caught) {
      setPinError(caught instanceof Error ? caught.message : "Could not add that link.")
    }
  }

  async function onRemovePin(resourceId: string) {
    if (!selectedId) return
    setPinError("")
    try {
      await deleteRoomResource(session!, resourceId)
      setResources(await listRoomResources(session!, selectedId))
    } catch (caught) {
      setPinError(caught instanceof Error ? caught.message : "Could not remove that link.")
    }
  }

  async function onStart(event: FormEvent) {
    event.preventDefault()
    setStartError("")
    setBusy(true)
    try {
      const id = await startDirectChat(session!, email)
      setChats(await listChats(session!))
      setLoadingMessages(true)
      setMessages([])
      setSelectedId(id)
      setView("chats")
      setEmail("")
      setSearch("")
    } catch (caught) {
      setStartError(caught instanceof Error ? caught.message : "Could not start that chat.")
    } finally {
      setBusy(false)
    }
  }

  async function onGroup(event: FormEvent) {
    event.preventDefault()
    setStartError("")
    setBusy(true)
    try {
      const id = await startGroupChat(session!, groupTitle, groupEmails)
      setChats(await listChats(session!))
      setLoadingMessages(true)
      setMessages([])
      setSelectedId(id)
      setView("chats")
      setGroupTitle("")
      setGroupEmails("")
      setSearch("")
    } catch (caught) {
      setStartError(caught instanceof Error ? caught.message : "Could not create that group.")
    } finally {
      setBusy(false)
    }
  }

  async function onSend(event: FormEvent) {
    event.preventDefault()
    if (!selectedId || lock !== "open") return
    const text = body
    const pending = attachment
    setBody("")
    setAttachment(null)
    setSendError("")
    try {
      const message = await sendMessage(session!, selectedId, text, pending)
      setMessages((current) =>
        current.some((item) => item.id === message.id) ? current : [...current, message],
      )
      setChats((current) =>
        current
          .map((chat) =>
            chat.id === message.conversationId
              ? { ...chat, lastBody: messageLabel(message), lastAt: message.createdAt }
              : chat,
          )
          .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? "")),
      )
    } catch (caught) {
      setBody(text)
      setAttachment(pending)
      setSendError(caught instanceof Error ? caught.message : "Could not send that message.")
    }
  }

  const conversations = chats.filter((chat) => chat.kind !== "room")

  function openChat(chatId: string) {
    setLoadingMessages(true)
    setMessages([])
    setSelectedId(chatId)
    setView("chats")
    setSearch("")
    setUnread((current) => {
      if (!current[chatId]) return current
      const next = { ...current, [chatId]: 0 }
      writeUnread(session!.userId, next)
      void setTaskbarBadge(unreadTotal(next))
      return next
    })
  }

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <p className="eyebrow light">Novaroom</p>
          <p className="brand-sub">AI trainers</p>
        </div>
        <form className="new-chat" onSubmit={onStart}>
          <label>
            New chat
            <input
              type="email"
              value={email}
              placeholder="Their email"
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <button type="submit" className="button" disabled={busy}>
            {busy ? "Starting…" : "Start chat"}
          </button>
        </form>
        <form className="new-chat" onSubmit={onGroup}>
          <label>
            New group
            <input
              value={groupTitle}
              maxLength={80}
              placeholder="Group name"
              onChange={(event) => setGroupTitle(event.target.value)}
              required
            />
          </label>
          <label>
            People
            <textarea
              value={groupEmails}
              rows={2}
              placeholder="Emails, separated by commas"
              onChange={(event) => setGroupEmails(event.target.value)}
              required
            />
          </label>
          <button type="submit" className="button" disabled={busy}>
            {busy ? "Starting…" : "Create group"}
          </button>
          {startError && (
            <p className="form-error" role="alert">
              {startError}
            </p>
          )}
        </form>
        <div className="chat-list">
          <p className="list-label">Chats</p>
          {conversations.length === 0 ? (
            <p className="empty-list">No chats yet. Start a direct chat or a group.</p>
          ) : (
            conversations.map((chat) => (
              <button
                key={chat.id}
                type="button"
                className={chat.id === selectedId ? "chat-row active" : "chat-row"}
                onClick={() => openChat(chat.id)}
              >
                <span className="avatar">
                  {chat.avatarUrl ? (
                    <img src={chat.avatarUrl} alt="" />
                  ) : (
                    <span>{initials(chat.title)}</span>
                  )}
                </span>
                <span className="profile-chip-text">
                  <strong>{chat.title}</strong>
                  <span>{chat.lastBody || "No messages yet"}</span>
                </span>
                {unread[chat.id] > 0 && (
                  <span className="unread-count">{unread[chat.id] > 9 ? "9+" : unread[chat.id]}</span>
                )}
              </button>
            ))
          )}
          <p className="list-label">Rooms</p>
          {rooms.length === 0 ? (
            <p className="empty-list">Topic rooms appear after the rooms SQL script is run.</p>
          ) : (
            rooms.map((room) => {
              const chat = chats.find((item) => item.id === room.id)
              if (room.joined && chat) {
                return (
                  <button
                    key={room.id}
                    type="button"
                    className={room.id === selectedId ? "chat-row active" : "chat-row"}
                    onClick={() => openChat(room.id)}
                  >
                    <span className="avatar">
                      <span>{initials(room.title)}</span>
                    </span>
                    <span className="profile-chip-text">
                      <strong>{room.title}</strong>
                      <span>{chat.lastBody || room.description}</span>
                    </span>
                    {unread[room.id] > 0 && (
                      <span className="unread-count">{unread[room.id] > 9 ? "9+" : unread[room.id]}</span>
                    )}
                  </button>
                )
              }
              return (
                <div className="room-row" key={room.id}>
                  <span className="profile-chip-text">
                    <strong>{room.title}</strong>
                    <span>{room.description}</span>
                  </span>
                  <button type="button" className="button" disabled={busy} onClick={() => void onJoin(room.id)}>
                    Join
                  </button>
                </div>
              )
            })
          )}
        </div>
        <button type="button" className="profile-chip" onClick={() => setView("settings")}>
          <span className="avatar">
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" />
            ) : (
              <span>{initials(profile.displayName || session.email)}</span>
            )}
          </span>
          <span className="profile-chip-text">
            <strong>{profile.displayName || "Your profile"}</strong>
            <span>{profile.status || session.email}</span>
          </span>
        </button>
      </aside>
      {view === "settings" ? (
        <Settings onBack={() => setView("chats")} />
      ) : (
        <section className="thread">
          <header className="thread-bar">
            <div>
              <h1>{selected ? selected.title : "Messages"}</h1>
              {selected?.detail && <p className="thread-email">{selected.detail}</p>}
            </div>
            {selected && (
              <div className="thread-actions">
                {selected.kind === "direct" && selected.otherUserId && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      void onBlock(selected.otherUserId!, !blockedIds.includes(selected.otherUserId!))
                    }}
                  >
                    {blockedIds.includes(selected.otherUserId) ? "Unblock" : "Block"}
                  </button>
                )}
                {selected.kind === "room" && (
                  <button type="button" className="button secondary" onClick={() => void onLeave(selected.id)}>
                    Leave
                  </button>
                )}
                <input
                  className="search"
                  value={search}
                  placeholder="Search this chat"
                  aria-label="Search this chat"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            )}
          </header>
          {selected ? (
            <>
              {selected.kind === "room" && (
                <div className="pins">
                  <p className="list-label dark">Pinned links</p>
                  {resources.length === 0 ? (
                    <p className="thread-note">No links yet.</p>
                  ) : (
                    resources.map((resource) => (
                      <p className="pin" key={resource.id}>
                        <a href={resource.url} target="_blank" rel="noreferrer">
                          {resource.title}
                        </a>
                        {resource.mine && (
                          <button type="button" className="text-button" onClick={() => void onRemovePin(resource.id)}>
                            Remove
                          </button>
                        )}
                      </p>
                    ))
                  )}
                  <form className="pin-form" onSubmit={onAddPin}>
                    <input
                      value={pinTitle}
                      maxLength={80}
                      placeholder="Link name"
                      aria-label="Link name"
                      onChange={(event) => setPinTitle(event.target.value)}
                      required
                    />
                    <input
                      value={pinUrl}
                      placeholder="https://"
                      aria-label="Link address"
                      onChange={(event) => setPinUrl(event.target.value)}
                      required
                    />
                    <button type="submit" className="button secondary">
                      Add link
                    </button>
                  </form>
                  {pinError && (
                    <p className="form-error" role="alert">
                      {pinError}
                    </p>
                  )}
                </div>
              )}
              <div className="message-log" ref={logRef}>
                {loadingMessages ? (
                  <p className="thread-note">Loading messages…</p>
                ) : visible.length === 0 ? (
                  <p className="thread-note">
                    {query ? "No messages match that search." : "No messages yet. Say hello."}
                  </p>
                ) : (
                  visible.map((message) => (
                    <article
                      key={message.id}
                      className={message.senderId === session.userId ? "bubble mine" : "bubble theirs"}
                    >
                      {(selected.kind === "group" || selected.kind === "room") &&
                        message.senderId !== session.userId && <p className="sender-name">{message.senderName}</p>}
                      {message.attachmentUrl && isImage(message.attachmentMime) && (
                        <img
                          className="bubble-image"
                          src={message.attachmentUrl}
                          alt={message.attachmentName ?? "Image"}
                        />
                      )}
                      {message.attachmentUrl && !isImage(message.attachmentMime) && (
                        <a
                          className="file-link"
                          href={message.attachmentUrl}
                          download={message.attachmentName ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {message.attachmentName ?? "File"}
                          {message.attachmentSize != null ? ` (${formatBytes(message.attachmentSize)})` : ""}
                        </a>
                      )}
                      {message.body && <p>{message.body}</p>}
                      {message.deleted && <p className="deleted-note">Message deleted</p>}
                      <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
                      {!message.deleted && (
                        <div className="bubble-actions">
                          {message.senderId === session.userId ? (
                            <button type="button" className="text-button" onClick={() => void onDelete(message)}>
                              Delete
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => {
                                  setReportSaved(false)
                                  setReportId(message.id)
                                  setReportReason("harassment")
                                  setReportNote("")
                                }}
                              >
                                Report
                              </button>
                              {selected.kind === "group" && !blockedIds.includes(message.senderId) && (
                                <button
                                  type="button"
                                  className="text-button"
                                  onClick={() => void onBlock(message.senderId, true)}
                                >
                                  Block
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
              <form className="composer" onSubmit={onSend}>
                <p className="nda">
                  Never share confidential client tasks or data. Most trainers are under an NDA.
                </p>
                {closed && (
                  <p className="notice" role="status">
                    {messagingLockMessage(lock)}
                  </p>
                )}
                {reportSaved && <p className="form-ok">Report sent. Thank you.</p>}
                {reporting && (
                  <div className="report-box">
                    <label>
                      Report this message
                      <select
                        value={reportReason}
                        onChange={(event) => setReportReason(event.target.value as ReportReason)}
                      >
                        <option value="harassment">Harassment</option>
                        <option value="spam">Spam</option>
                        <option value="leak">Confidential client information</option>
                        <option value="other">Something else</option>
                      </select>
                    </label>
                    <label>
                      Note, optional
                      <textarea
                        value={reportNote}
                        maxLength={1000}
                        rows={2}
                        onChange={(event) => setReportNote(event.target.value)}
                      />
                    </label>
                    <div className="form-actions">
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => {
                          setReportId(null)
                          setReportNote("")
                        }}
                      >
                        Cancel
                      </button>
                      <button type="button" className="button" onClick={() => void onReport()}>
                        Send report
                      </button>
                    </div>
                  </div>
                )}
                {sendError && (
                  <p className="form-error" role="alert">
                    {sendError}
                  </p>
                )}
                {attachment && (
                  <p className="pending-file">
                    {attachment.name} ({formatBytes(attachment.size)})
                    <button type="button" className="text-button" onClick={() => setAttachment(null)}>
                      Remove
                    </button>
                  </p>
                )}
                <div className="composer-row">
                  <textarea
                    value={body}
                    maxLength={4000}
                    rows={2}
                    placeholder="Write a message"
                    aria-label="Message"
                    disabled={closed}
                    onChange={(event) => setBody(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault()
                        event.currentTarget.form?.requestSubmit()
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="button secondary"
                    disabled={closed}
                    onClick={() => fileRef.current?.click()}
                  >
                    Attach
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ""
                      if (!file) return
                      if (file.size > 25 * 1024 * 1024) {
                        setSendError("Files must be 25 MB or smaller.")
                        return
                      }
                      setSendError("")
                      setAttachment(file)
                    }}
                  />
                  <button type="submit" className="button" disabled={closed || (!body.trim() && !attachment)}>
                    Send
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="thread-empty">
              <h2>No conversation selected</h2>
              <p>Start a direct chat or a group, or pick one from the list.</p>
              <p className="nda">
                Never share confidential client tasks or data. Most trainers are under an NDA.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
