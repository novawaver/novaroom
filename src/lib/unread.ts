const keyFor = (userId: string) => `novaroom.unread.${userId}`

export function readUnread(userId: string): Record<string, number> {
  const raw = localStorage.getItem(keyFor(userId))
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, number>
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

export function writeUnread(userId: string, counts: Record<string, number>) {
  localStorage.setItem(keyFor(userId), JSON.stringify(counts))
}

export function unreadTotal(counts: Record<string, number>) {
  return Object.values(counts).reduce((sum, count) => sum + (count > 0 ? count : 0), 0)
}
