// Messages a person pinned in online chats. Like Local chat's pins they are kept on this computer
// only: nobody else sees them, and they do not follow the account to another computer.

const key = (userId: string) => `novaroom.chat-pins.${userId}`

function readAll(userId: string): Record<string, string[]> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key(userId)) ?? "{}")
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string[]>) : {}
  } catch {
    return {}
  }
}

/** The ids of the messages pinned in one chat, oldest pin first. */
export function loadPins(userId: string, chatId: string): string[] {
  const ids = readAll(userId)[chatId]
  return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []
}

export function savePins(userId: string, chatId: string, ids: string[]) {
  try {
    const all = readAll(userId)
    if (ids.length > 0) all[chatId] = ids
    else delete all[chatId]
    localStorage.setItem(key(userId), JSON.stringify(all))
  } catch {
    // Without storage, pins last until the app closes.
  }
}
