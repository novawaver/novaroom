// Writes src/lib/emojiData.json, the list the emoji picker shows, from the emojibase-data package.
// Run with `npm run emoji` after updating emojibase-data. Only the generated file ships in the app:
// it holds names and search words, and the emoji themselves are drawn by the Windows emoji font.
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const read = (path) => JSON.parse(readFileSync(new URL(`../node_modules/emojibase-data/en/${path}`, import.meta.url), "utf8"))
const data = read("data.json")
const { groups } = read("messages.json")

const LIGHT = "\u{1F3FB}"
/** The emoji with a skin tone: the tone goes after the first character, in place of its variation mark. */
function toned(emoji, tone) {
  const [first, ...rest] = [...emoji]
  if (rest[0] === "️") rest.shift()
  return first + tone + rest.join("")
}

const titles = {
  "smileys-emotion": "Smileys",
  "people-body": "People",
  "animals-nature": "Animals and nature",
  "food-drink": "Food and drink",
  "travel-places": "Travel and places",
  activities: "Activities",
  objects: "Objects",
  symbols: "Symbols",
  flags: "Flags",
}

const out = []
for (const group of groups) {
  const title = titles[group.key]
  if (!title) continue // Components (skin tones, hair) are not emoji to pick.
  const emojis = data
    .filter((item) => item.group === group.order)
    .sort((a, b) => a.order - b.order)
    .map((item) => {
      const words = new Set(item.label.toLowerCase().split(/[^a-z0-9]+/))
      const tags = (item.tags ?? []).filter((tag) => !words.has(tag.toLowerCase()))
      // Whether the picker's skin tone applies: only where the simple rule above gives a real emoji.
      const tones = item.skins?.some((skin) => skin.emoji === toned(item.emoji, LIGHT)) ? 1 : 0
      // [emoji, name, more search words, takes a skin tone]
      return [item.emoji, item.label, tags.join(" "), tones]
    })
  out.push({ title, emojis })
}

const target = new URL("../src/lib/emojiData.json", import.meta.url)
writeFileSync(target, `${JSON.stringify(out)}\n`)
const count = out.reduce((sum, group) => sum + group.emojis.length, 0)
console.log(`${count} emoji in ${out.length} groups -> ${fileURLToPath(target)}`)
