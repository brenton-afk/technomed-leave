import { handleUpload } from '@vercel/blob/client'
import { put } from '@vercel/blob'
import { requireSession, getSession } from './_auth.js'
import {
  postMessage, readChannel, channelSizes, knownChannels, readMarkers, markRead,
  getMessages, updateMessage, setTyping, whoIsTyping, seenIn,
  lastMessages, chatIcons, setChatIcon
} from './_redis.js'
import { searchChat } from './_chatSearch.js'
import { firstNameFor, STAFF } from '../src/staffConfig.js'
import { notify, preview } from './_push.js'
import { FILE_TYPES } from '../src/chat/fileTypes.js'
import { newChatFile, chatFileKey, chatFilePath } from './_chatFiles.js'
import { uploadFile as dropboxUpload, temporaryLink, dropboxConfigured } from './_dropbox.js'

// ─── The internal channels ───────────────────────────────────────────────────
// What the WhatsApp group does, inside the app that already holds the bookings
// the group spends its day talking about.
//
// Nine people. That number decides most of the design: polling rather than
// sockets, a list per channel rather than an index, and no read receipts beyond
// a count. Anything built for a thousand users would be more machinery than
// this will ever need.

/** The standing channels. Case threads are created on demand alongside them. */
export const CHANNELS = [
  { id: 'general', name: 'General', detail: 'Anything that is not the others', icon: { emoji: '💬' } },
  { id: 'spine', name: 'Spine', detail: 'Cases, kit, surgeons', icon: { emoji: '🦴' } },
  { id: 'logistics', name: 'Logistics', detail: 'Sets, loans, deliveries', icon: { emoji: '📦' } },
  { id: 'theatre-lists', name: 'Theatre lists', detail: 'Running orders and changes', icon: { emoji: '📋' } },
  // Brent, 6 Nov 2026: feedback about the portal comes here instead of a
  // WhatsApp group exported by hand. The improvement agent reads it overnight.
  { id: 'portal-feedback', name: 'Portal feedback', detail: 'Changes and problems — picked up overnight and fixed', icon: { emoji: '🛠️' } }
]

/** Reactions anyone can add. A short list reads faster than an emoji keyboard. */
export const REACTIONS = ['👍', '❤️', '😂', '😮', '🙏', '✅']

const BLOB_URL = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i

/** What can be sent — one list, shared with the phone (src/chat/fileTypes.js). */
export { FILE_TYPES }

/** Files on a message: only ones this app's blob store issued, described plainly. */
export function readFiles(given) {
  const list = Array.isArray(given) ? given : []
  const side = n => (Number.isFinite(Number(n)) ? Math.round(Number(n)) : null)
  return list.slice(0, 10).map(f => {
    const url = String(f?.url || '').trim()
    if (!BLOB_URL.test(url) && !chatFileKey(url)) return null
    const type = FILE_TYPES.includes(String(f.type)) ? String(f.type) : 'application/octet-stream'
    return {
      url: url.slice(0, 500), type,
      name: String(f.name || 'file').replace(/[\u0000-\u001f]/g, '').slice(0, 120),
      size: Number.isFinite(Number(f.size)) ? Number(f.size) : null,
      width: side(f.width), height: side(f.height)
    }
  }).filter(Boolean)
}

/** A booking's own thread. Namespaced, so it cannot collide with a channel. */
export const caseChannel = eventId => `case:${String(eventId || '').trim()}`

/**
 * The photograph on a message, if the client sent one.
 *
 * Only a URL this app's own blob store issued is accepted. Without that check
 * the field would render any image from anywhere inside the channel, which is
 * both a way to smuggle a tracker into the team's chat and a way to make the
 * app show something nobody here uploaded.
 */
function readPhoto(given) {
  const url = String(given?.url || '').trim()
  if (!BLOB_URL.test(url)) return null
  const side = n => (Number.isFinite(Number(n)) ? Math.round(Number(n)) : null)
  return { url: url.slice(0, 500), width: side(given.width), height: side(given.height) }
}

function validChannel(id) {
  const channel = String(id || '').trim()
  if (CHANNELS.some(c => c.id === channel)) return channel
  // A case thread is any event id we are told about. The id came from the
  // calendar, and a thread for a booking that no longer exists is harmless —
  // it simply has nobody to open it.
  if (/^case:[A-Za-z0-9_@.-]{1,200}$/.test(channel)) return channel
  return null
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  // Ahead of requireSession, and the only thing here that is. @vercel/blob's
  // client builds its own request, so there is no header of ours on it — the
  // session rides in clientPayload and is checked inside, before a write token
  // is issued. Guarding it here would refuse every upload.
  if (req.query.action === 'blob-upload') return photoUpload(req, res)
  // A file kept in Dropbox, opened by an <img> or a link — no session header
  // can come with those, so the random id in the address is the protection.
  if (req.query.action === 'file') return openChatFile(req, res)

  const session = await requireSession(req, res)
  if (!session) return

  try {
    if (req.query.action === 'overview') return overview(req, res, session)
    if (req.query.action === 'search') return search(req, res)
    if (req.query.action === 'react') return react(req, res, session)
    if (req.query.action === 'delete') return remove(req, res, session)
    if (req.query.action === 'typing') return typing(req, res, session)
    if (req.query.action === 'icon') return setIcon(req, res)
    if (req.query.action === 'upload') return directUpload(req, res, session)
    if (req.method === 'POST') return send(req, res, session)
    return read(req, res, session)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}


// ─── Photographs ─────────────────────────────────────────────────────────────
// Most of what the WhatsApp group carries is a picture: the scanned booking
// form, a tray with a part number visible, a whiteboard with tomorrow's running
// order on it. A channel that cannot take one is not a replacement for it.
//
// ── What a photograph of paperwork contains ──
//
// A patient's full name, usually, and often a date of birth and a UR number.
// The app has spent a lot of effort keeping those out of the text — see
// src/chat/identifiers.js, which reads a message before it is sent — and a
// photograph walks straight past all of it.
//
// It cannot be read the way text can, so the answer is the same one the team
// already uses in theatre: say so, every time, before it is sent. The composer
// warns on the picture rather than after it, and the warning names what to do
// (crop the header off) rather than just disapproving.
//
// ── Where they are kept ──
//
// Vercel Blob, with a random suffix, and the URL is only ever handed to a
// signed-in member of staff reading the channel. That is the same posture the
// meeting recordings already have. It is worth being plain about the limit: a
// blob URL is unguessable, not access-controlled, so anybody who is given one
// can open it. For a cropped photograph of a tray that is the right trade; for
// a full booking form it is the reason the warning exists.
async function photoUpload(req, res) {
  try {
    const result = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let token = null
        try { token = JSON.parse(clientPayload || '{}').token } catch { token = null }
        const who = await getSession(token)
        if (!who) throw new Error('Not signed in, or your session has expired')
        return {
          // The kinds a chat carries (FILE_TYPES), not anything at all: this
          // endpoint mints a write token, and one that would accept any type
          // is a place to park anything.
          allowedContentTypes: FILE_TYPES,
          addRandomSuffix: true,
          maximumSizeInBytes: 100 * 1024 * 1024,
          tokenPayload: JSON.stringify({ by: who.email })
        }
      },
      onUploadCompleted: async () => {}
    })
    return res.status(200).json(result)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
}

// ─── The second way in (8 Nov 2026) ──────────────────────────────────────────
// "Portal feedback not uploading attachments." The first way is the browser
// straight to Blob storage, which a hospital network, an old phone or a
// blocked third-party request can stop. This is the fallback: the file comes
// through the portal's own function and the server puts it in the same store.
// Vercel caps a request body at 4.5 MB, so this carries files up to 3 MB —
// every photo (they are shrunk first), screenshot and most documents.
export const DIRECT_MAX_BYTES = 3 * 1024 * 1024

export function directUploadName(name) {
  return String(name || 'file').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100) || 'file'
}

async function directUpload(req, res, session) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const type = FILE_TYPES.includes(String(body.type)) ? String(body.type) : 'application/octet-stream'
  const buf = Buffer.from(String(body.data || ''), 'base64')
  if (!buf.length) return res.status(400).json({ error: 'The file arrived empty' })
  if (buf.length > DIRECT_MAX_BYTES) return res.status(413).json({ error: 'That file is too big for this route' })
  // Dropbox first: Blob storage has been hanging (9 Nov 2026), and a hang here
  // ran the function out of time and left the person with no reason.
  if (dropboxConfigured()) {
    try {
      const file = newChatFile(body.name)
      await withLimit(dropboxUpload(file.path, buf), 20000, 'Dropbox did not answer')
      console.log(`chat upload by ${session.email} to Dropbox: ${type}, ${buf.length} bytes`)
      return res.status(200).json({ ok: true, url: file.url })
    } catch (err) {
      console.error('chat upload to Dropbox failed:', err.message)
    }
  }
  try {
    const blob = await withLimit(put(`chat/${directUploadName(body.name)}`, buf, {
      access: 'public', contentType: type, addRandomSuffix: true
    }), 8000, 'file storage did not answer')
    console.log(`chat direct upload by ${session.email}: ${type}, ${buf.length} bytes`)
    return res.status(200).json({ ok: true, url: blob.url })
  } catch (err) {
    console.error('chat upload to Blob failed:', err.message)
    return res.status(502).json({ error: `the portal could not store it (${err.message})` })
  }
}

function withLimit(promise, ms, why) {
  let timer
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(why)), ms) })])
    .finally(() => clearTimeout(timer))
}

/** Redirects to a short-lived Dropbox link for one chat file. */
async function openChatFile(req, res) {
  const path = chatFilePath(String(req.query.f || ''))
  if (!path) return res.status(404).json({ error: 'Not found' })
  try {
    const { url } = await temporaryLink(path)
    res.setHeader('Cache-Control', 'private, max-age=3000')
    res.setHeader('Location', url)
    return res.status(302).end()
  } catch (err) {
    return res.status(404).json({ error: 'That file could not be opened' })
  }
}

/** The channel list with how much is unread in each. */
async function overview(req, res, session) {
  const known = await knownChannels()
  const standing = CHANNELS.map(c => c.id)
  const all = [...new Set([...standing, ...known])]
  const [sizes, marks, lasts, icons] = await Promise.all([
    channelSizes(all), readMarkers(session.email),
    lastMessages(standing).catch(() => ({})), chatIcons().catch(() => ({}))
  ])

  return res.status(200).json({
    ok: true,
    channels: CHANNELS.map(c => ({
      ...c,
      icon: icons[c.id] || c.icon,
      last: lastLine(lasts[c.id]),
      messages: sizes[c.id] || 0,
      unread: Math.max(0, (sizes[c.id] || 0) - (marks[c.id] || 0))
    })),
    // Case threads, so a booking can show a count without asking separately.
    cases: all.filter(id => id.startsWith('case:')).map(id => ({
      id,
      eventId: id.slice(5),
      messages: sizes[id] || 0,
      unread: Math.max(0, (sizes[id] || 0) - (marks[id] || 0))
    }))
  })
}

/** The preview a channel list shows: who, what (or what kind of file), when. */
export function lastLine(m) {
  if (!m) return null
  const files = [...(m.photo?.url ? [{ type: 'image/jpeg' }] : []), ...(m.files || [])]
  const kind = files.length
    ? (String(files[0].type).startsWith('image/') ? '📷 Photo' : String(files[0].type).startsWith('video/') ? '🎥 Video' : `📎 ${files[0].name || 'File'}`)
    : ''
  const said = m.deleted ? 'This message was deleted' : (String(m.text || '').replace(/\s+/g, ' ').trim() || kind)
  return { authorName: m.authorName || '', author: m.author || '', text: said.slice(0, 90), at: m.at || null }
}

// ─── A channel's icon (Brent, 7 Nov 2026) ────────────────────────────────────
// Anyone in the team may change it, as in a WhatsApp group. An emoji, or a
// photo already uploaded through this app's own Blob handshake — never a URL
// from elsewhere, which would put someone else's image (and their logging) in
// front of the team.
const EMOJI_MAX = 16
async function setIcon(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { channel, emoji, url } = req.body || {}
  if (!CHANNELS.some(c => c.id === channel)) return res.status(400).json({ error: 'No such channel' })
  let icon = null
  if (emoji) {
    const e = String(emoji).trim()
    if (!e || e.length > EMOJI_MAX || /[<>"'`]/.test(e)) return res.status(400).json({ error: 'That icon cannot be used' })
    icon = { emoji: e }
  } else if (url) {
    if (!BLOB_URL.test(String(url))) return res.status(400).json({ error: 'That picture cannot be used' })
    icon = { url: String(url) }
  }
  await setChatIcon(channel, icon)
  const fallback = CHANNELS.find(c => c.id === channel).icon
  return res.status(200).json({ ok: true, icon: icon || fallback })
}

async function read(req, res, session) {
  const channel = validChannel(req.query.channel)
  if (!channel) return res.status(400).json({ error: 'No such channel' })

  const [messages, total, typingNow, seen] = await Promise.all([
    readChannel(channel),
    channelSizes([channel]).then(s => s[channel] || 0),
    whoIsTyping(channel, session.email),
    seenIn(channel)
  ])
  // Opening a channel is reading it. Marked here rather than from the phone so
  // a badge cannot be cleared by a request that never showed anybody anything.
  await markRead(session.email, channel, total)

  // Who has read how far, by first name, so the sender sees "Seen by Mat, Toni".
  const seenBy = Object.fromEntries(Object.entries(seen)
    .filter(([email]) => email.toLowerCase() !== String(session.email).toLowerCase())
    .map(([email, n]) => [firstNameFor(email) || email, n]))

  return res.status(200).json({ ok: true, channel, messages, total, typing: typingNow, seenBy })
}

async function search(req, res) {
  const q = String(req.query.q || '').trim().slice(0, 80)
  const found = await searchChat(q, { channels: CHANNELS.map(c => c.id) })
  const name = id => CHANNELS.find(c => c.id === id)?.name || (id.startsWith('case:') ? 'Case thread' : id)
  return res.status(200).json({ ok: true, results: found.map(m => ({ ...m, channelName: name(m.channel) })) })
}

const bodyOf = req => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}))

async function react(req, res, session) {
  const { id, emoji } = bodyOf(req)
  if (!REACTIONS.includes(emoji)) return res.status(400).json({ error: 'Not a reaction this chat has' })
  const who = firstNameFor(session.email) || session.email
  const next = await updateMessage(String(id || ''), m => {
    const reactions = { ...(m.reactions || {}) }
    const people = new Set(reactions[emoji] || [])
    if (people.has(who)) people.delete(who); else people.add(who)
    if (people.size) reactions[emoji] = [...people]; else delete reactions[emoji]
    return { ...m, reactions }
  })
  if (!next) return res.status(404).json({ error: 'That message is gone' })
  return res.status(200).json({ ok: true, message: next })
}

/** Your own message, taken back. Kept as "deleted" so a reply to it still makes sense. */
async function remove(req, res, session) {
  const { id } = bodyOf(req)
  let refused = false
  const next = await updateMessage(String(id || ''), m => {
    if (String(m.author).toLowerCase() !== String(session.email).toLowerCase()) { refused = true; return m }
    return { ...m, deleted: true, text: '', files: [], photo: null, deletedAt: new Date().toISOString() }
  })
  if (refused) return res.status(403).json({ error: 'Only the person who sent it can delete it' })
  if (!next) return res.status(404).json({ error: 'That message is gone' })
  return res.status(200).json({ ok: true, message: next })
}

async function typing(req, res, session) {
  const channel = validChannel(bodyOf(req).channel)
  if (!channel) return res.status(400).json({ error: 'No such channel' })
  await setTyping(channel, session.email, firstNameFor(session.email) || session.email)
  return res.status(200).json({ ok: true })
}

/** "@Mat" (or "@all") in a message: whom it is for. */
export function mentionsIn(text) {
  const said = String(text || '')
  if (/@(all|everyone|team)\b/i.test(said)) return STAFF.map(p => p.email)
  return STAFF.filter(p => new RegExp(`@${p.firstName}\\b`, 'i').test(said)).map(p => p.email)
}

async function send(req, res, session) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const channel = validChannel(body.channel)
  if (!channel) return res.status(400).json({ error: 'No such channel' })

  const text = String(body.text || '').trim()
  // A photograph on its own is a message. "Here is the form" with nothing typed
  // is most of what the group sends.
  const photo = readPhoto(body.photo)
  const files = readFiles(body.files)
  if (!text && !photo && !files.length) return res.status(400).json({ error: 'Nothing to send' })

  // A reply carries a snapshot of what it answers, so it still reads right if
  // the original scrolls off or is deleted.
  let replyTo = null
  if (body.replyTo) {
    const [orig] = await getMessages([String(body.replyTo)])
    if (orig) {
      replyTo = {
        id: orig.id, authorName: orig.authorName,
        text: orig.deleted ? 'Deleted message' : String(orig.text || (orig.files?.[0]?.name) || (orig.photo ? 'Photo' : '')).slice(0, 140)
      }
    }
  }
  const mentions = mentionsIn(text)
  if (text.length > 4000) return res.status(400).json({ error: 'That message is too long' })

  // Stored as written. The app warns about patient identifiers before sending
  // and does not rewrite the message: changing what somebody said, without
  // telling them, is not a thing to do to a conversation. See
  // src/chat/identifiers.js.
  const saved = await postMessage(channel, {
    id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    channel,
    author: session.email,
    authorName: firstNameFor(session.email) || session.email,
    text,
    photo,
    files,
    replyTo,
    mentions,
    // Recorded when the sender was warned and sent anyway, so it is possible to
    // find out later how often that happens and whether the wording is working.
    warned: Boolean(body.warned)
  })

  // The part that makes the channels worth having. Everyone but the sender —
  // being notified about a message you just typed is how an app teaches people
  // to turn notifications off.
  //
  // After the message is saved and outside its success. A push service having a
  // bad morning must not lose somebody's message, so a failure here is silent
  // and the send still succeeded.
  const others = STAFF.map(person => person.email)
    .filter(email => email.toLowerCase() !== String(session.email).toLowerCase())

  const where = CHANNELS.find(c => c.id === channel)
  const fileWord = files.length ? (files[0].type.startsWith('image/') ? '📷 Photo' : `📎 ${files[0].name}`) : ''
  await notify(others, {
    // Who and where, so a lock screen says whether this is worth stopping for.
    // A mention says so first: "Mat mentioned you" is worth stopping for.
    title: `${saved.authorName}${where ? ` · ${where.name}` : ' · this case'}`,
    // The message itself. A notification you have to open the app to read is
    // half a notification, and the running order at four o'clock is exactly the
    // thing somebody needs off a lock screen. What is safe to put there is
    // whatever the channels already allow — no patient identifiers, which the
    // composer warns about before anything is sent. See src/chat/identifiers.js.
    body: preview(text || fileWord || 'Photo'),
    // One per channel, replaced rather than stacked: six messages in Spine is
    // one conversation, not six things to clear.
    tag: channel,
    url: '/'
  }).catch(() => {})

  return res.status(200).json({ ok: true, message: saved })
}
