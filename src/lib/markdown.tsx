// A small Markdown renderer for room pages. It builds React elements and never inserts HTML, so
// page text can't run script or add styles. Supported:
//   # Heading, ## Smaller, ### Smallest   paragraphs (a single line break stays a line break)
//   - bullets or * bullets, 1. numbered   > quotes   ``` code blocks ```   --- a rule
//   **bold**, *italic* or _italic_, `code`, [name](https://link) and bare https:// links
// Only http, https and mailto links become links; anything else stays plain text.
// The admin site keeps a copy in src/markdown.tsx so its preview matches; change both together.

import { useMemo, type ReactNode } from "react"

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; lines: string[] }
  | { type: "code"; text: string }
  | { type: "rule" }

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const FENCE = /^\s*```/

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n")
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }
    if (FENCE.test(line)) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !FENCE.test(lines[index])) {
        code.push(lines[index])
        index += 1
      }
      index += 1
      blocks.push({ type: "code", text: code.join("\n") })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] })
      index += 1
      continue
    }
    if (RULE.test(line)) {
      blocks.push({ type: "rule" })
      index += 1
      continue
    }
    const ordered = NUMBERED.test(line)
    if (ordered || BULLET.test(line)) {
      const pattern = ordered ? NUMBERED : BULLET
      const items: string[] = []
      while (index < lines.length) {
        const item = pattern.exec(lines[index])
        if (item) {
          items.push(item[1])
        } else if (items.length && /^\s{2,}\S/.test(lines[index])) {
          // An indented line carries on the item above it.
          items[items.length - 1] += " " + lines[index].trim()
        } else {
          break
        }
        index += 1
      }
      blocks.push({ type: "list", ordered, items })
      continue
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = []
      while (index < lines.length && QUOTE.test(lines[index])) {
        quoted.push(QUOTE.exec(lines[index])![1])
        index += 1
      }
      blocks.push({ type: "quote", lines: quoted })
      continue
    }
    const paragraph: string[] = []
    while (
      index < lines.length &&
      lines[index].trim() &&
      !FENCE.test(lines[index]) &&
      !HEADING.test(lines[index]) &&
      !RULE.test(lines[index]) &&
      !BULLET.test(lines[index]) &&
      !NUMBERED.test(lines[index]) &&
      !QUOTE.test(lines[index])
    ) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push({ type: "paragraph", lines: paragraph })
  }
  return blocks
}

export function safeLink(url: string) {
  const clean = url.trim()
  return /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(clean) ? clean : null
}

// `code`, **bold**, [name](url), a bare link, *italic*, _italic_ — in that order of preference.
const INLINE =
  /(`[^`\n]+`)|(\*\*(?=\S)[^\n]*?\S\*\*)|(\[([^\]\n]+)\]\(([^)\s]+)\))|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])|(\*(?=[^\s*])[^*\n]*?[^\s*]\*|\*[^\s*]\*)|((?<![\w])_(?=\S)[^_\n]*?\S_(?![\w]))/g

type LinkHandler = ((url: string) => void) | undefined

function link(url: string, label: ReactNode, key: string, onOpenLink: LinkHandler) {
  return (
    <a
      key={key}
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(event) => {
        if (!onOpenLink) return
        event.preventDefault()
        onOpenLink(url)
      }}
    >
      {label}
    </a>
  )
}

export function renderInline(text: string, onOpenLink?: LinkHandler, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let count = 0
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0
    if (start > last) out.push(text.slice(last, start))
    const key = `${keyPrefix}-${count++}`
    const [whole, code, bold, linked, label, href, bare, starItalic, underscoreItalic] = match
    if (code) {
      out.push(<code key={key}>{code.slice(1, -1)}</code>)
    } else if (bold) {
      out.push(<strong key={key}>{renderInline(bold.slice(2, -2), onOpenLink, key)}</strong>)
    } else if (linked) {
      const url = safeLink(href)
      const inner = renderInline(label, undefined, key)
      out.push(url ? link(url, inner, key, onOpenLink) : <span key={key}>{inner}</span>)
    } else if (bare) {
      out.push(link(bare, bare, key, onOpenLink))
    } else if (starItalic || underscoreItalic) {
      out.push(<em key={key}>{renderInline(whole.slice(1, -1), onOpenLink, key)}</em>)
    } else {
      out.push(whole)
    }
    last = start + whole.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function withBreaks(lines: string[], onOpenLink: LinkHandler, key: string) {
  return lines.flatMap((line, index) => [
    ...(index ? [<br key={`${key}-br-${index}`} />] : []),
    ...renderInline(line, onOpenLink, `${key}-${index}`),
  ])
}

export function Markdown({
  text,
  className = "markdown",
  onOpenLink,
}: {
  text: string
  className?: string
  onOpenLink?: (url: string) => void
}) {
  const blocks = useMemo(() => parseBlocks(text), [text])
  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const key = `b${index}`
        switch (block.type) {
          case "heading": {
            // The page title is the h1, so # is a section heading.
            const Tag = block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4"
            return <Tag key={key}>{renderInline(block.text, onOpenLink, key)}</Tag>
          }
          case "paragraph":
            return <p key={key}>{withBreaks(block.lines, onOpenLink, key)}</p>
          case "list": {
            const Tag = block.ordered ? "ol" : "ul"
            return (
              <Tag key={key}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item, onOpenLink, `${key}-${itemIndex}`)}</li>
                ))}
              </Tag>
            )
          }
          case "quote":
            return <blockquote key={key}>{withBreaks(block.lines, onOpenLink, key)}</blockquote>
          case "code":
            return (
              <pre key={key}>
                <code>{block.text}</code>
              </pre>
            )
          case "rule":
            return <hr key={key} />
        }
      })}
    </div>
  )
}
