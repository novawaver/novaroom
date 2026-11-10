// Mentions: "@Name" in a message, where Name is someone's display name. Capitals don't matter.

function escapeForPattern(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Matches "@Name" for any of the names, at the start of a word and not running on into a longer one.
// Longer names come first, so "@Ann Lee" is not read as "@Ann".
function patternFor(names: string[]) {
  const usable = [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort((a, b) => b.length - a.length)
  if (usable.length === 0) return null
  return new RegExp(`(^|[^\\p{L}\\p{N}_@])@(${usable.map(escapeForPattern).join("|")})(?![\\p{L}\\p{N}_])`, "giu")
}

/** Whether the text mentions this name. */
export function mentionsName(text: string, name: string) {
  return patternFor([name])?.test(text) ?? false
}

/** The text cut into plain runs and mentions of the given names, in order. */
export function splitMentions(text: string, names: string[]) {
  const pattern = patternFor(names)
  if (!pattern) return [{ text, mention: false }]
  const parts: Array<{ text: string; mention: boolean }> = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index + match[1].length
    const end = match.index + match[0].length
    if (start > last) parts.push({ text: text.slice(last, start), mention: false })
    parts.push({ text: text.slice(start, end), mention: true })
    last = end
  }
  if (last < text.length) parts.push({ text: text.slice(last), mention: false })
  return parts
}

/**
 * The mention being typed just before the caret: where its "@" is, and what follows it so far.
 * Null when the caret is not in one.
 */
export function mentionQuery(text: string, caret: number) {
  const before = text.slice(0, caret)
  const start = before.lastIndexOf("@")
  if (start < 0) return null
  if (start > 0 && !/\s/.test(before[start - 1])) return null
  const query = before.slice(start + 1)
  if (query.length > 40 || query.includes("\n")) return null
  return { start, query }
}
