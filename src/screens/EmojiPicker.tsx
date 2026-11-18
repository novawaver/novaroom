import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  SKIN_TONES,
  loadEmoji,
  recentEmoji,
  rememberEmoji,
  saveTone,
  savedTone,
  searchEmoji,
  withTone,
  type Emoji,
  type EmojiGroup,
} from "../lib/emoji"

// The emoji that stands for each group in the row of shortcuts.
const GROUP_ICONS: Record<string, string> = {
  Recent: "🕒",
  Smileys: "😀",
  People: "👋",
  "Animals and nature": "🐻",
  "Food and drink": "🍔",
  "Travel and places": "🚗",
  Activities: "⚽",
  Objects: "💡",
  Symbols: "🔣",
  Flags: "🏁",
}

const TONE_NAMES = ["No skin tone", "Light", "Medium-light", "Medium", "Medium-dark", "Dark"]

function SmileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14a4.2 4.2 0 0 0 7 0M9 9.8v.4M15 9.8v.4" />
    </svg>
  )
}

/** The emoji themselves. Kept apart so typing in the message box does not draw them all again. */
const EmojiGrid = memo(function EmojiGrid({
  groups,
  tone,
  onPick,
}: {
  groups: EmojiGroup[]
  tone: string
  onPick: (item: Emoji) => void
}) {
  return (
    <>
      {groups.map((group) => (
        <section key={group.title} className="emoji-group" data-group={group.title} aria-label={group.title}>
          {/* With one group (search results) its title adds nothing. */}
          {groups.length > 1 && <h3>{group.title}</h3>}
          <div className="emoji-grid">
            {group.emojis.map((item) => (
              <button
                key={item.emoji}
                type="button"
                title={item.name}
                aria-label={item.name}
                // Keeps the focus where it is, so typing carries on after choosing.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(item)}
              >
                {item.tones ? withTone(item.emoji, tone) : item.emoji}
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  )
})

/**
 * A button for a message box that opens the emoji to choose from. The chosen emoji is written where
 * the caret is. Goes inside the composer's row, which the list opens above.
 */
export function EmojiPicker({
  body,
  setBody,
  boxRef,
  maxLength,
  disabled,
}: {
  body: string
  /** Called with the text after an emoji is written into it. */
  setBody: (text: string) => void
  boxRef: { current: HTMLTextAreaElement | null }
  maxLength: number
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState<EmojiGroup[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState("")
  const [tone, setTone] = useState(savedTone)
  const [choosingTone, setChoosingTone] = useState(false)
  // The recent emoji as they were when the list opened, so it does not move under the pointer.
  const [recent, setRecent] = useState<string[]>([])
  const [current, setCurrent] = useState("")
  const wrapRef = useRef<HTMLSpanElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setRecent(recentEmoji())
    setQuery("")
    setChoosingTone(false)
    if (!groups) {
      setFailed(false)
      loadEmoji().then(setGroups, () => setFailed(true))
    }
    function onPointer(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    // Caught first and stopped, so Escape only closes the list and not whatever is behind it.
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      event.stopPropagation()
      setOpen(false)
      boxRef.current?.focus()
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey, true)
    }
    // Only when it opens or closes.
  }, [open])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  // What the list shows: the search's results, or the recent emoji and then every group.
  const shown = useMemo(() => {
    if (!groups) return []
    if (query.trim()) {
      const found = searchEmoji(groups, query)
      return found.length > 0 ? [{ title: "Results", emojis: found }] : []
    }
    const byEmoji = new Map(groups.flatMap((group) => group.emojis.map((item) => [item.emoji, item] as const)))
    const lately = recent.flatMap((emoji) => byEmoji.get(emoji) ?? [])
    return lately.length > 0 ? [{ title: "Recent", emojis: lately }, ...groups] : groups
  }, [groups, query, recent])

  // Back to the top for each search.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [query])

  // Where the caret goes once the box shows the text with the emoji in it. Until then the box still
  // has the old text, so a second emoji chosen straight away is written after the first.
  const caretRef = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (caretRef.current === null) return
    boxRef.current?.setSelectionRange(caretRef.current, caretRef.current)
    caretRef.current = null
  }, [body])

  // Always the newest, so the grid's own copy need not change as the message is typed.
  const pickRef = useRef<(item: Emoji) => void>(() => {})
  pickRef.current = (item) => {
    const box = boxRef.current
    const text = item.tones ? withTone(item.emoji, tone) : item.emoji
    const start = box?.selectionStart ?? body.length
    const end = box?.selectionEnd ?? body.length
    if (body.length - (end - start) + text.length > maxLength) return
    setBody(body.slice(0, start) + text + body.slice(end))
    rememberEmoji(item.emoji)
    caretRef.current = start + text.length
  }
  const onPick = useRef((item: Emoji) => pickRef.current(item)).current

  const searching = query.trim() !== ""
  const active = current || shown[0]?.title

  function showGroup(title: string) {
    const scroll = scrollRef.current
    const target = scroll?.querySelector<HTMLElement>(`[data-group="${title}"]`)
    if (scroll && target) scroll.scrollTop = target.offsetTop
  }

  return (
    <span className="emoji-picker" ref={wrapRef}>
      <button
        type="button"
        className="attach-button emoji-button"
        aria-label="Emoji"
        title="Emoji"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <SmileIcon />
      </button>
      {open && (
        <div className="emoji-panel" role="dialog" aria-label="Emoji">
          <div className="emoji-head">
            <input
              type="search"
              value={query}
              placeholder="Search emoji"
              aria-label="Search emoji"
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                // Enter here chooses the first result; it must not send the message.
                event.preventDefault()
                if (searching && shown[0]) onPick(shown[0].emojis[0])
              }}
            />
            <button
              type="button"
              className="emoji-tone-button"
              aria-label="Skin tone"
              title="Skin tone"
              aria-expanded={choosingTone}
              onClick={() => setChoosingTone((value) => !value)}
            >
              {withTone("✋", tone)}
            </button>
          </div>
          {choosingTone && (
            <div className="emoji-tones" role="radiogroup" aria-label="Skin tone">
              {SKIN_TONES.map((item, index) => (
                <button
                  key={item}
                  type="button"
                  role="radio"
                  aria-checked={item === tone}
                  aria-label={TONE_NAMES[index]}
                  title={TONE_NAMES[index]}
                  onClick={() => {
                    setTone(item)
                    saveTone(item)
                    setChoosingTone(false)
                  }}
                >
                  {withTone("✋", item)}
                </button>
              ))}
            </div>
          )}
          {!searching && shown.length > 0 && (
            <div className="emoji-tabs" role="group" aria-label="Emoji groups">
              {shown.map((group) => (
                <button
                  key={group.title}
                  type="button"
                  className={group.title === active ? "active" : undefined}
                  aria-label={group.title}
                  title={group.title}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => showGroup(group.title)}
                >
                  {GROUP_ICONS[group.title] ?? group.emojis[0].emoji}
                </button>
              ))}
            </div>
          )}
          <div
            className="emoji-scroll"
            ref={scrollRef}
            onScroll={(event) => {
              // The group at the top of the list is the one marked in the shortcuts.
              const top = event.currentTarget.scrollTop + 8
              let title = ""
              for (const section of event.currentTarget.querySelectorAll<HTMLElement>("[data-group]")) {
                if (section.offsetTop > top) break
                title = section.dataset.group ?? ""
              }
              setCurrent(title)
            }}
          >
            {failed ? (
              <p className="emoji-note">Could not load the emoji. Close this and try again.</p>
            ) : !groups ? (
              <p className="emoji-note">Loading…</p>
            ) : shown.length === 0 ? (
              <p className="emoji-note">No emoji found.</p>
            ) : (
              <EmojiGrid groups={shown} tone={tone} onPick={onPick} />
            )}
          </div>
        </div>
      )}
    </span>
  )
}
