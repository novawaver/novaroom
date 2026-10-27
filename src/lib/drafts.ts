// Unsent message text per chat, kept while Novaroom is open so switching chats or pages does not lose it.
// Held in memory only: drafts can hold client details, so they are never written to disk.
const drafts = new Map<string, string>()

const keyFor = (userId: string, chatId: string) => `${userId}:${chatId}`

export function loadDraft(userId: string, chatId: string) {
  return drafts.get(keyFor(userId, chatId)) ?? ""
}

export function saveDraft(userId: string, chatId: string, text: string) {
  if (text) drafts.set(keyFor(userId, chatId), text)
  else drafts.delete(keyFor(userId, chatId))
}
