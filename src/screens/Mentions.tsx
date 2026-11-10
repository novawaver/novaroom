import { useState, type KeyboardEvent } from "react"
import { mentionQuery, splitMentions } from "../lib/mentions"

const MOST_SHOWN = 6

/**
 * Mentions for a message box: typing "@" lists the people in the chat, and choosing one writes
 * their name. `names` are the people who can be mentioned.
 */
export function useMentions(
  names: string[],
  body: string,
  setBody: (text: string) => void,
  boxRef: { current: HTMLTextAreaElement | null },
) {
  // Where the caret is, while the list may show; null once it is closed.
  const [caret, setCaret] = useState<number | null>(null)
  const [index, setIndex] = useState(0)

  const found = caret === null ? null : mentionQuery(body, caret)
  const query = found?.query.toLowerCase() ?? ""
  const matches = found
    ? [...new Set(names.filter(Boolean))]
        .filter((name) => {
          const lower = name.toLowerCase()
          return lower.startsWith(query) || lower.split(/\s+/).some((word) => word.startsWith(query))
        })
        .slice(0, MOST_SHOWN)
    : []
  const at = Math.min(index, matches.length - 1)

  function pick(name: string) {
    if (!found || caret === null) return
    const next = `${body.slice(0, found.start)}@${name} ${body.slice(caret)}`
    const end = found.start + name.length + 2
    setBody(next)
    setCaret(null)
    requestAnimationFrame(() => {
      boxRef.current?.focus()
      boxRef.current?.setSelectionRange(end, end)
    })
  }

  return {
    /** Call when the text changes (typed) or the caret moves (a click, an arrow key). */
    track(box: HTMLTextAreaElement, typed: boolean) {
      setCaret(box.selectionStart)
      if (typed) setIndex(0)
    },
    close: () => setCaret(null),
    /** Call first on key down; true means the list used the key. */
    onKeyDown(event: KeyboardEvent) {
      if (matches.length === 0) return false
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const step = event.key === "ArrowDown" ? 1 : -1
        setIndex((at + step + matches.length) % matches.length)
        return true
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        pick(matches[at])
        return true
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setCaret(null)
        return true
      }
      return false
    },
    list: matches.length > 0 && (
      <div className="mention-list" role="listbox" aria-label="Mention someone">
        {matches.map((name, position) => (
          <button
            key={name}
            type="button"
            role="option"
            aria-selected={position === at}
            // Keeps the message box focused, so typing carries on after choosing.
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setIndex(position)}
            onClick={() => pick(name)}
          >
            @{name}
          </button>
        ))}
      </div>
    ),
  }
}

/** A message's text with its mentions marked; mentions of `me` stand out more. */
export function MentionText({ text, names, me }: { text: string; names: string[]; me: string }) {
  const mine = `@${me}`.toLowerCase()
  return (
    <>
      {splitMentions(text, names).map((part, index) =>
        part.mention ? (
          <span key={index} className={part.text.toLowerCase() === mine ? "mention me" : "mention"}>
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  )
}
