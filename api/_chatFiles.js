import { randomUUID } from 'node:crypto'

// ─── Chat files kept in Dropbox (9 Nov 2026) ─────────────────────────────────
// Toni's test picture failed both ways on a desktop with a good connection:
// the browser's upload to Vercel Blob hung, and so did the server's. Both
// handlers answered at once, so the hang is in Blob storage itself. Rather
// than leave attachments resting on it, the portal's own route now keeps the
// file in Dropbox — which the portal already writes to every day — and serves
// it through /api/chat?action=file, which redirects to a short-lived Dropbox
// link.
//
// The address carries a random id, so it is as hard to guess as a Blob URL
// (which is public too). It is answered without a session because an <img> tag
// cannot send one. Only paths of exactly this shape are ever opened, so the
// endpoint cannot be walked to any other part of the Dropbox.

export const CHAT_FILES_ROOT = '/Admin/Chat Files'

const KEY = /^\d{4}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[\w.\- ]{1,100}$/

export function safeChatFileName(name) {
  return String(name || 'file').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100) || 'file'
}

/** Where a new file goes, and the address messages use for it. */
export function newChatFile(name, now = new Date()) {
  const key = `${now.toISOString().slice(0, 7)}/${randomUUID()}-${safeChatFileName(name)}`
  return { key, path: `${CHAT_FILES_ROOT}/${key}`, url: chatFileUrl(key) }
}

export const chatFileUrl = key => `/api/chat?action=file&f=${encodeURIComponent(key)}`

/** The Dropbox path for a key, or null if it is not one of ours. */
export function chatFilePath(key) {
  const k = String(key || '')
  return KEY.test(k) ? `${CHAT_FILES_ROOT}/${k}` : null
}

/** The key inside a message's file address, or null. */
export function chatFileKey(url) {
  const m = /^\/api\/chat\?action=file&f=([^&#]+)$/.exec(String(url || ''))
  if (!m) return null
  let key
  try { key = decodeURIComponent(m[1]) } catch { return null }
  return chatFilePath(key) ? key : null
}
