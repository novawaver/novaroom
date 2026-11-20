import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react"
import { parseChatText, toggleStyle, type ChatPart, type ChatStyle } from "../lib/chatText"
import { openVaultShare } from "../lib/vaultShare"
import { MentionText } from "./Mentions"

function renderParts(parts: ChatPart[], names: string[], me: string): ReactNode[] {
  return parts.map((part, index) => {
    if (typeof part === "string") return <MentionText key={index} text={part} names={names} me={me} />
    if (part.style === "code") {
      return (
        <code key={index} className={part.block ? "chat-code block" : "chat-code"}>
          {part.text}
        </code>
      )
    }
    if (part.style === "share") {
      return (
        <button
          key={index}
          type="button"
          className="chat-share-link"
          title="Open the shared data in your Vault"
          onClick={() => openVaultShare(part.id)}
        >
          Open shared data
        </button>
      )
    }
    const Tag = part.style === "bold" ? "strong" : part.style === "italic" ? "em" : "s"
    return <Tag key={index}>{renderParts(part.parts, names, me)}</Tag>
  })
}

/** A message's text with its styling (bold, italic, struck through, code) and its mentions marked. */
export function ChatText({ text, names, me }: { text: string; names: string[]; me: string }) {
  const parts = useMemo(() => parseChatText(text), [text])
  return <>{renderParts(parts, names, me)}</>
}

const BUTTONS: Array<{ style: ChatStyle; label: string; keys: string; face: ReactNode }> = [
  { style: "bold", label: "Bold", keys: "Ctrl+B", face: <strong>B</strong> },
  { style: "italic", label: "Italic", keys: "Ctrl+I", face: <em>I</em> },
  { style: "strike", label: "Strikethrough", keys: "Ctrl+Shift+X", face: <s>S</s> },
  { style: "code", label: "Code", keys: "Ctrl+E", face: <code>{"</>"}</code> },
]

/**
 * Text styling for a message box: buttons that show above the box while some of its text is
 * selected, and the usual shortcuts (Ctrl+B, Ctrl+I, Ctrl+Shift+X, Ctrl+E).
 */
export function useTextStyling(boxRef: { current: HTMLTextAreaElement | null }) {
  // Whether some of the box's text is selected, so the buttons have something to style.
  const [selecting, setSelecting] = useState(false)

  useEffect(() => {
    function check() {
      const box = boxRef.current
      setSelecting(box !== null && document.activeElement === box && box.selectionStart !== box.selectionEnd)
    }
    document.addEventListener("selectionchange", check)
    document.addEventListener("focusin", check)
    document.addEventListener("focusout", check)
    return () => {
      document.removeEventListener("selectionchange", check)
      document.removeEventListener("focusin", check)
      document.removeEventListener("focusout", check)
    }
  }, [boxRef])

  function apply(style: ChatStyle) {
    const box = boxRef.current
    if (!box || box.disabled) return
    const change = toggleStyle(box.value, box.selectionStart, box.selectionEnd, style)
    const grows = change.text.length - (change.to - change.from)
    if (box.maxLength > 0 && box.value.length + grows > box.maxLength) return
    box.focus()
    box.setSelectionRange(change.from, change.to)
    // Written as if typed, so the box's own change handling runs and Ctrl+Z undoes it.
    const written = change.text
      ? document.execCommand("insertText", false, change.text)
      : document.execCommand("delete")
    if (written) box.setSelectionRange(change.selectFrom, change.selectTo)
  }

  return {
    /** Call first on key down; true means a styling shortcut used the key. */
    onKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey || event.altKey || event.metaKey) return false
      const key = event.key.toLowerCase()
      const style: ChatStyle | null = event.shiftKey
        ? key === "x"
          ? "strike"
          : null
        : key === "b"
          ? "bold"
          : key === "i"
            ? "italic"
            : key === "e"
              ? "code"
              : null
      if (!style) return false
      event.preventDefault()
      apply(style)
      return true
    },
    bar: selecting && (
      <div className="style-bar" role="toolbar" aria-label="Text styling">
        {BUTTONS.map((button) => (
          <button
            key={button.style}
            type="button"
            aria-label={button.label}
            title={`${button.label} (${button.keys})`}
            // Keeps the box focused and its text selected.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => apply(button.style)}
          >
            {button.face}
          </button>
        ))}
      </div>
    ),
  }
}
