import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { createPortal } from "react-dom"

// Tools shared by online chats and Local chat: the chat's options menu, choosing messages to
// delete, and the dialogs that confirm clearing or deleting, or say something can't be done.

// Things on screen that take Escape for themselves: dialogs, menus, pickers and viewers. The call
// card is a dialog that Escape does not close, so it does not count.
const TAKES_ESCAPE =
  '.desk-backdrop, .image-viewer, .mention-list, [role="menu"], [role="listbox"], [role="dialog"]:not(.voice-call)'

/**
 * Whether this key press is an Escape that should close the chat shown in `thread`: nothing else
 * is waiting for it, and the keyboard is in that chat or nowhere in particular (not in another
 * field, and not in a page pinned beside this one).
 */
export function escapeClosesThread(event: globalThis.KeyboardEvent, thread: HTMLElement | null) {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || !thread) return false
  if (document.querySelector(TAKES_ESCAPE)) return false
  const target = event.target instanceof Element ? event.target : null
  if (!target || thread.contains(target)) return true
  if (thread.closest(".side-page") || target.closest(".side-page")) return false
  return !target.closest("input, textarea, select, [contenteditable]")
}

/** Which messages are chosen while choosing messages to delete. Ends when the chat changes. */
export function useMessageSelection(chatKey: string | null) {
  const [selecting, setSelecting] = useState(false)
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    setSelecting(false)
    setChosen(new Set())
  }, [chatKey])

  useEffect(() => {
    if (!selecting) return
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setSelecting(false)
        setChosen(new Set())
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [selecting])

  return {
    selecting,
    chosen,
    start() {
      setChosen(new Set())
      setSelecting(true)
    },
    stop() {
      setSelecting(false)
      setChosen(new Set())
    },
    toggle(id: string) {
      setChosen((current) => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },
  }
}

export type MessageSelection = ReturnType<typeof useMessageSelection>

/**
 * Props for a message row while choosing messages: the whole row toggles, by click or by Space or
 * Enter. Empty when not choosing, or for messages that can't be chosen.
 */
export function selectableRow(selection: MessageSelection, id: string, canChoose = true) {
  if (!selection.selecting || !canChoose) return {}
  const checked = selection.chosen.has(id)
  return {
    role: "checkbox",
    tabIndex: 0,
    "aria-checked": checked,
    onClick: () => selection.toggle(id),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault()
        selection.toggle(id)
      }
    },
  } as const
}

/** The round check at the start of a message row while choosing messages. */
export function SelectCheck({ checked }: { checked: boolean }) {
  return (
    <span className={checked ? "select-check checked" : "select-check"} aria-hidden="true">
      <svg viewBox="0 0 16 16">
        <path d="M3.5 8.5l3 3 6-6.5" />
      </svg>
    </span>
  )
}

/** Marks a chat whose notifications are off. */
export function QuietIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 5.2A5.5 5.5 0 0 1 17.5 10v3.5M18.5 18H5l1.5-1.5V10c0-.6.1-1.2.3-1.8" />
      <path d="M10 20.5a2 2 0 0 0 4 0M4 4l16 16" />
    </svg>
  )
}

/**
 * The chat's options in its header: its own extras (such as turning notifications off), choosing
 * messages to delete, or clearing the whole chat. While messages are being chosen, Cancel and Delete
 * take its place.
 */
export function ThreadMenu({
  selection,
  onDelete,
  onClear,
  extra = [],
  disabled,
}: {
  selection: MessageSelection
  // Deletes the chosen messages.
  onDelete: () => void
  onClear: () => void
  extra?: Array<{ label: string; onSelect: () => void }>
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  if (selection.selecting) {
    const count = selection.chosen.size
    return (
      <div className="selection-actions" role="group" aria-label="Selected messages">
        <button type="button" className="button secondary" onClick={selection.stop}>
          Cancel
        </button>
        <button
          type="button"
          className="button danger"
          disabled={count === 0}
          title={count === 0 ? "Select messages to delete" : undefined}
          aria-live="polite"
          onClick={onDelete}
        >
          {count === 0 ? "Delete" : `Delete (${count})`}
        </button>
      </div>
    )
  }

  const items = [
    ...extra.map((item) => ({ ...item, danger: false })),
    { label: "Select messages", danger: false, onSelect: selection.start },
    { label: "Clear chat", danger: true, onSelect: onClear },
  ]

  return (
    <div className="thread-menu" ref={ref}>
      <button
        type="button"
        className="thread-menu-button"
        aria-label="Chat options"
        title="Chat options"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {open && (
        <div className="bar-menu" role="menu">
          {items.map(({ label, danger, onSelect: select }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              className={danger ? "danger" : undefined}
              onClick={() => {
                setOpen(false)
                select()
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export type ConfirmAction = { label: string; danger?: boolean; onSelect: () => Promise<void> }

/** Asks before clearing a chat or deleting messages. Shows what went wrong if an action fails. */
export function ConfirmDialog({
  title,
  text,
  actions,
  onClose,
}: {
  title: string
  text: string
  actions: ConfirmAction[]
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    // Caught first and stopped, so Escape only closes the dialog and not the choosing behind it.
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return
      event.stopPropagation()
      if (!busy) onClose()
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [busy, onClose])

  async function run(action: ConfirmAction) {
    setBusy(true)
    setError("")
    try {
      await action.onSelect()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work. Try again.")
      setBusy(false)
    }
  }

  return (
    <div className="desk-backdrop" onPointerDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div className="desk-modal chat-confirm" role="alertdialog" aria-labelledby="chat-confirm-title" aria-describedby="chat-confirm-text">
        <h2 id="chat-confirm-title">{title}</h2>
        <p className="hint" id="chat-confirm-text">
          {text}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={action.danger ? "button danger" : "button secondary"}
              disabled={busy}
              onClick={() => void run(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Tells the person something they need to know, such as why a button did nothing. */
export function AlertDialog({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [onClose])

  return (
    <div className="desk-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="desk-modal chat-confirm" role="alertdialog" aria-labelledby="chat-alert-title" aria-describedby="chat-alert-text">
        <h2 id="chat-alert-title">{title}</h2>
        <p className="hint" id="chat-alert-text">
          {text}
        </p>
        <div className="form-actions">
          <button type="button" className="button" autoFocus onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The mark on one of this person's messages in a chat with several people: one check when sent, two
 * once someone has read it, coloured when everyone has. Hovering names who has read it; clicking
 * lists them, with whoever has not yet.
 */
export function ReadMark({
  readers,
  waiting,
  sentLabel = "Sent",
}: {
  // Names of the people who have read the message, and of those who have not (if that is known).
  readers: string[]
  waiting?: string[]
  sentLabel?: string
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    // Caught first and stopped, so Escape only closes the list and not the chat behind it.
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [open])

  if (readers.length === 0) {
    return (
      <svg className="bubble-status" viewBox="0 0 16 16" role="img" aria-label={sentLabel}>
        <title>{sentLabel}</title>
        <path d="M3 8.5l3 3 7-7" />
      </svg>
    )
  }
  const everyone = waiting !== undefined && waiting.length === 0
  const summary = `Read by ${readers.join(", ")}`
  return (
    <>
      <button
        type="button"
        className="read-mark"
        aria-label={`${summary}. Show the list.`}
        title={summary}
        onClick={(event) => {
          // Not also a click on the message, which chooses it while choosing messages.
          event.stopPropagation()
          setOpen(true)
        }}
      >
        <svg className={everyone ? "bubble-status double read" : "bubble-status double"} viewBox="0 0 20 16" aria-hidden="true">
          <path d="M1.5 8.5l3 3 7-7" />
          <path d="M8.5 11.5l7-7" />
        </svg>
        {!everyone && <span className="read-mark-count">{readers.length}</span>}
      </button>
      {open &&
        createPortal(
          <div className="desk-backdrop" onPointerDown={(event) => event.target === event.currentTarget && setOpen(false)}>
            <div className="desk-modal chat-confirm read-list" role="dialog" aria-label="Who has read this message">
              <h2>Read by {readers.length}</h2>
              <ul>
                {readers.map((name, index) => (
                  <li key={`${name}-${index}`}>{name}</li>
                ))}
              </ul>
              {waiting !== undefined && waiting.length > 0 && (
                <>
                  <h3>Not yet</h3>
                  <ul className="read-list-waiting">
                    {waiting.map((name, index) => (
                      <li key={`${name}-${index}`}>{name}</li>
                    ))}
                  </ul>
                </>
              )}
              <div className="form-actions">
                <button type="button" className="button secondary" onClick={() => setOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
/** One person in the list a chat's Members button opens. */
export type ShownMember = {
  id: string
  name: string
  avatarUrl: string | null
  // "online", "idle" or "offline", for the dot; left out when it is not known.
  presence?: string
  // Shown after the name: "You", "Away" and the like.
  note?: string
}

function memberInitials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

/**
 * The button in a chat's header that lists who is in it. `load` is asked each time the list is
 * opened, so it shows the members as they are then.
 */
export function MembersButton({
  title,
  hint = "Show members",
  empty = "Nobody is in this chat.",
  load,
}: {
  title: string
  hint?: string
  empty?: string
  load: () => Promise<ShownMember[]>
}) {
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<ShownMember[] | null>(null)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    if (!open) return
    let current = true
    setMembers(null)
    setError("")
    setQuery("")
    loadRef.current().then(
      (found) => current && setMembers(found),
      (caught) => current && setError(caught instanceof Error ? caught.message : "Could not load the members."),
    )
    // Caught first and stopped, so Escape only closes the list and not the chat behind it.
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener("keydown", onKey, true)
    return () => {
      current = false
      document.removeEventListener("keydown", onKey, true)
    }
  }, [open])

  const wanted = query.trim().toLowerCase()
  const shown = members && wanted ? members.filter((member) => member.name.toLowerCase().includes(wanted)) : members
  return (
    <>
      <button
        type="button"
        className="icon-button thread-call"
        aria-label={hint}
        title={hint}
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="9" cy="8.5" r="3.2" />
          <path d="M3 19c.6-3.2 3-5 6-5s5.400 1.800 6 5M15.500 5.600a3.200 3.200 0 010 5.800M17.500 14.500c1.900.700 3.100 2.200 3.500 4.500" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div className="desk-backdrop" onPointerDown={(event) => event.target === event.currentTarget && setOpen(false)}>
            <div className="desk-modal chat-confirm read-list member-list" role="dialog" aria-label={title}>
              <h2>
                {title}
                {members ? ` (${members.length})` : ""}
              </h2>
              {members && members.length > 8 && (
                <input
                  className="search"
                  value={query}
                  placeholder="Search members"
                  aria-label="Search members"
                  autoFocus
                  onChange={(event) => setQuery(event.target.value)}
                />
              )}
              {error ? (
                <p className="form-error">{error}</p>
              ) : !shown ? (
                <p className="hint">Loading...</p>
              ) : shown.length === 0 ? (
                <p className="hint">{wanted ? "No member has that name." : empty}</p>
              ) : (
                <ul>
                  {shown.map((member) => (
                    <li key={member.id}>
                      <span className="member-list-photo">
                        <span className="avatar">
                          {member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : <span>{memberInitials(member.name)}</span>}
                        </span>
                        {member.presence && <span className={`presence-dot member-list-dot ${member.presence}`} />}
                      </span>
                      <span className="member-list-name">{member.name}</span>
                      {member.note && <span className="member-list-note">{member.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="form-actions">
                <button type="button" className="button secondary" onClick={() => setOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}