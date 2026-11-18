// Emoji for the chats' picker. Nothing is downloaded and no pictures ship with the app: the emoji
// are drawn by the emoji font that comes with Windows, and the list of them (names and search words,
// written by scripts/build-emoji.mjs) is read from the app itself the first time the picker opens.

export type Emoji = {
  emoji: string
  name: string
  /** The name and other search words, lower-case, each word after a space. */
  search: string
  /** Whether a skin tone can be applied. */
  tones: boolean
}

export type EmojiGroup = { title: string; emojis: Emoji[] }

type RawGroup = { title: string; emojis: Array<[emoji: string, name: string, words: string, tones: number]> }

/** No tone, then light to dark. */
export const SKIN_TONES = ["", "\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"]

/** The emoji with a skin tone: the tone goes after the first character, in place of its variation mark. */
export function withTone(emoji: string, tone: string) {
  if (!tone) return emoji
  const [first, ...rest] = [...emoji]
  if (rest[0] === "\uFE0F") rest.shift()
  return first + tone + rest.join("")
}

/**
 * A test for whether this computer's emoji font can draw an emoji. Every emoji the font has is the
 * same width; one it lacks (a newer emoji, or a country flag on Windows) falls back to something
 * narrower or wider. Null when that can't be measured, and then everything is shown.
 */
function supportTest() {
  try {
    const context = document.createElement("canvas").getContext("2d")
    if (!context) return null
    context.font = '32px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'
    const expected = context.measureText("\u{1F600}").width
    if (!expected) return null
    // The flags of England, Scotland and Wales are a black flag plus hidden tag characters. Windows
    // draws just the black flag, at the usual width, so those are left out by what they are made of.
    return (emoji: string) =>
      !/[\u{E0020}-\u{E007F}]/u.test(emoji) && Math.abs(context.measureText(emoji).width - expected) < expected * 0.02
  } catch {
    return null
  }
}

let loading: Promise<EmojiGroup[]> | null = null

/** The emoji this computer can show, in groups. Read once, from the app itself. */
export function loadEmoji() {
  loading ??= import("./emojiData.json").then((module) => {
    const supported = supportTest()
    return (module.default as unknown as RawGroup[])
      .map((group) => ({
        title: group.title,
        emojis: group.emojis
          .filter(([emoji]) => !supported || supported(emoji))
          .map(([emoji, name, words, tones]) => ({
            emoji,
            name,
            search: ` ${`${name} ${words}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")}`,
            tones: tones === 1,
          })),
      }))
      .filter((group) => group.emojis.length > 0)
  })
  return loading
}

/** Emoji whose name or search words have a word starting with each word of the query. */
export function searchEmoji(groups: EmojiGroup[], query: string) {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (words.length === 0) return []
  const found = groups.flatMap((group) => group.emojis.filter((item) => words.every((word) => item.search.includes(` ${word}`))))
  // Those whose name starts with the query come first, then those with it elsewhere in the name.
  const rank = (item: Emoji) => {
    const name = ` ${item.name.toLowerCase()}`
    return name.startsWith(` ${words[0]}`) ? 0 : words.every((word) => name.includes(` ${word}`)) ? 1 : 2
  }
  // The sort keeps the usual order among emoji that rank the same.
  return found.sort((a, b) => rank(a) - rank(b))
}

const RECENT_KEY = "novaroom.emoji.recent"
const TONE_KEY = "novaroom.emoji.tone"
const MOST_RECENT = 24

/** The emoji used lately, newest first. */
export function recentEmoji(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

export function rememberEmoji(emoji: string) {
  try {
    const next = [emoji, ...recentEmoji().filter((item) => item !== emoji)].slice(0, MOST_RECENT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Without storage, the picker just has no recent emoji.
  }
}

export function savedTone() {
  try {
    const tone = localStorage.getItem(TONE_KEY) ?? ""
    return SKIN_TONES.includes(tone) ? tone : ""
  } catch {
    return ""
  }
}

export function saveTone(tone: string) {
  try {
    localStorage.setItem(TONE_KEY, tone)
  } catch {
    // Kept for this session only.
  }
}

// One emoji: a flag's pair of letters, or a picture with any skin tone, variation mark, joined
// pictures (a family, a profession) and tag characters (the flags of England, Scotland and Wales).
const ONE = String.raw`(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F|\u200D\p{Extended_Pictographic}|[\u{E0020}-\u{E007F}])*)`
const ONLY_EMOJI = new RegExp(String.raw`^(?:\s*${ONE}){1,3}\s*$`, "u")

/** Whether a message is just one to three emoji, which are then shown larger. */
export function isEmojiOnly(text: string) {
  return ONLY_EMOJI.test(text)
}
