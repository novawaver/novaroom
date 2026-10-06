export const PREVIEW_CODE = "000000"
export const PREVIEW_SESSION_KEY = "novaroom.preview.session"
export const PREVIEW_PROFILES_KEY = "novaroom.preview.profiles"
export const PREVIEW_CHATS_KEY = "novaroom.preview.chats"

export function previewUserId(email: string) {
  let hash = 5381
  for (const char of email.toLowerCase()) {
    hash = ((hash << 5) + hash) ^ char.charCodeAt(0)
  }
  return `preview-${(hash >>> 0).toString(16)}`
}

export function normalizeEmail(email: string) {
  const normalized = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Enter a valid email address.")
  }
  return normalized
}
