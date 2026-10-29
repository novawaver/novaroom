const ACCENTS = ["violet", "green", "indigo", "blue", "amber", "red"]

/** A person's accent colour, the same everywhere they appear: pair with the `accent-*` classes. */
export function accentFor(userId: string) {
  let hash = 0
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return ACCENTS[hash % ACCENTS.length]
}
