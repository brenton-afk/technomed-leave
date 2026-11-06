import { channelIds, getMessages, knownChannels } from './_redis.js'

// ─── Searching the channels (Brent, 6 Nov 2026) ──────────────────────────────
// "You need the ability to search the chats really easily." Every word typed
// has to be in the message — its text, who wrote it, or a file's name — so
// "mat diplomat" is Mat talking about Diplomat. Newest first. Shared by the
// channel search and the portal-wide search glass.

const norm = v => String(v ?? '').toLowerCase()

export function messageMatches(message, words) {
  if (!message || message.deleted) return false
  const hay = norm([message.text, message.authorName,
    ...(message.files || []).map(f => f.name), message.photo ? 'photo' : ''].join(' '))
  return words.length > 0 && words.every(w => hay.includes(w))
}

export async function searchChat(q, { channels: standing = [], limit = 40 } = {}) {
  const words = norm(q).split(/\s+/).filter(Boolean)
  if (!words.length || words.join('').length < 2) return []
  const all = [...new Set([...standing, ...(await knownChannels())])]
  const found = []
  for (const channel of all) {
    const ids = await channelIds(channel)
    const messages = await getMessages(ids)
    for (const m of messages) if (messageMatches(m, words)) found.push({ ...m, channel })
  }
  return found.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit)
}
