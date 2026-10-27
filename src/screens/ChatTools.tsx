import { useEffect, useRef, useState, type KeyboardEvent } from "react"

// Tools shared by online chats and Local chat: the chat's options menu, choosing messages to
// delete, and the dialogs that confirm clearing or deleting.

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

/** The chat's options in its header: choose messages to delete, or clear the whole chat. */
export function ThreadMenu({
  onSelect,
  onClear,
  disabled,
}: {
  onSelect: () => void
  onClear: () => void
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

  const items = [
    { label: "Select messages", danger: false, onSelect },
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

/** Takes the place of the message box while choosing messages. */
export function SelectionBar({ count, onCancel, onDelete }: { count: number; onCancel: () => void; onDelete: () => void }) {
  return (
    <div className="selection-bar">
      <p className="selection-count" aria-live="polite">
        {count === 0 ? "Select messages to delete" : count === 1 ? "1 message selected" : `${count} messages selected`}
      </p>
      <button type="button" className="button secondary" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className="button danger" disabled={count === 0} onClick={onDelete}>
        Delete
      </button>
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
