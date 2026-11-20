// Text styling in chat messages. A message stays plain text, with marks around the styled parts:
//   **bold**   _italic_ or *italic*   ~~struck through~~   `code`   ``` a block of code ```
// so it reads sensibly anywhere it is shown as it was written, such as in an older version of the app.

export type ChatStyle = "bold" | "italic" | "strike" | "code"

export type ChatPart =
  | string
  | { style: "bold" | "italic" | "strike"; parts: ChatPart[] }
  | { style: "code"; text: string; block: boolean }
  // A link to data shared from someone's Vault, which opens the shared data page.
  | { style: "share"; id: string }

/** The address of the page that shows data shared from a Vault, as written in a message. */
export const VAULT_SHARE_ADDRESS = "novaroom://vault-share/"
const SHARE_ADDRESS = /^novaroom:\/\/vault-share\/([\w-]{1,80})$/

// In order of preference: a block of code, code, a web address (left as it is, so the underscores
// in one are not read as italic), bold, struck through, *italic*, _italic_. Apart from a block of
// code, a style does not run past the end of a line, and italic marks only count around whole words.
// A block of code takes the line break after it, since it is shown on lines of its own.
const STYLED =
  /```\n?([\s\S]+?)\n?```\n?|`([^`\n]+)`|((?:https?:\/\/|novaroom:\/\/vault-share\/)\S+)|\*\*(?=\S)([^\n]*?\S)\*\*|~~(?=\S)([^\n]*?\S)~~|(?<![\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])|(?<!\w)_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g

/** A message's text cut into plain runs and styled parts, which can hold more of the same. */
export function parseChatText(text: string): ChatPart[] {
  const parts: ChatPart[] = []
  let last = 0
  for (const match of text.matchAll(STYLED)) {
    const [whole, block, code, address, bold, strike, starItalic, underscoreItalic] = match
    if (match.index > last) parts.push(text.slice(last, match.index))
    if (block !== undefined) parts.push({ style: "code", text: block, block: true })
    else if (code !== undefined) parts.push({ style: "code", text: code, block: false })
    else if (address !== undefined) {
      const share = SHARE_ADDRESS.exec(address)
      parts.push(share ? { style: "share", id: share[1] } : address)
    }
    else if (bold !== undefined) parts.push({ style: "bold", parts: parseChatText(bold) })
    else if (strike !== undefined) parts.push({ style: "strike", parts: parseChatText(strike) })
    else parts.push({ style: "italic", parts: parseChatText(starItalic ?? underscoreItalic) })
    last = match.index + whole.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function plain(parts: ChatPart[]): string {
  return parts
    .map((part) =>
      typeof part === "string"
        ? part
        : part.style === "code"
          ? part.text
          : part.style === "share"
            ? "Open shared data"
            : plain(part.parts),
    )
    .join("")
}

/** A message's text without its styling marks, for a notification or a one-line preview. */
export function plainChatText(text: string) {
  return plain(parseChatText(text))
}

const MARKS: Record<ChatStyle, string> = { bold: "**", italic: "_", strike: "~~", code: "`" }

/** What to write in place of the selection, and what is selected afterwards. */
export type StyleChange = { from: number; to: number; text: string; selectFrom: number; selectTo: number }

/**
 * Puts a style on the selected text, or takes it off if the selection already has it. With nothing
 * selected, writes the marks with the caret between them, ready for typing.
 */
export function toggleStyle(text: string, start: number, end: number, style: ChatStyle): StyleChange {
  const mark = MARKS[style]
  const chosen = text.slice(start, end)

  // Already styled, with the marks just outside the selection: take them off.
  if (text.slice(start - mark.length, start) === mark && text.slice(end, end + mark.length) === mark) {
    return { from: start - mark.length, to: end + mark.length, text: chosen, selectFrom: start - mark.length, selectTo: end - mark.length }
  }
  // Or with the marks at the ends of the selection.
  if (chosen.length > mark.length * 2 && chosen.startsWith(mark) && chosen.endsWith(mark)) {
    const inner = chosen.slice(mark.length, -mark.length)
    return { from: start, to: end, text: inner, selectFrom: start, selectTo: start + inner.length }
  }

  if (!chosen) {
    return { from: start, to: end, text: mark + mark, selectFrom: start + mark.length, selectTo: start + mark.length }
  }

  // Several lines of code become one block.
  if (style === "code" && chosen.includes("\n")) {
    const block = `\`\`\`\n${chosen.replace(/^\n+|\n+$/g, "")}\n\`\`\``
    return { from: start, to: end, text: block, selectFrom: start, selectTo: start + block.length }
  }

  // The marks go right against the words, on each line by itself: spaces at the ends stay outside,
  // and a style does not run from one line to the next.
  const styled = chosen
    .split("\n")
    .map((line) => line.replace(/^(\s*)(.*?)(\s*)$/, (_, before: string, words: string, after: string) => (words ? `${before}${mark}${words}${mark}${after}` : line)))
    .join("\n")
  return { from: start, to: end, text: styled, selectFrom: start, selectTo: start + styled.length }
}
