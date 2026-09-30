import { handleUpload } from '@vercel/blob/client'
import { requireSession, getSession } from './_auth.js'
import {
  postMessage, readChannel, channelSizes, knownChannels, readMarkers, markRead
} from './_redis.js'
import { firstNameFor, STAFF } from '../src/staffConfig.js'
import { notify, preview } from './_push.js'

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
  { id: 'general', name: 'General', detail: 'Anything that is not the others' },
  { id: 'spine', name: 'Spine', detail: 'Cases, kit, surgeons' },
  { id: 'logistics', name: 'Logistics', detail: 'Sets, loans, deliveries' },
  { id: 'theatre-lists', name: 'Theatre lists', detail: 'Running orders and changes' }
]

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
  if (!/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(url)) return null
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

  const session = await requireSession(req, res)
  if (!session) return

  try {
    if (req.query.action === 'overview') return overview(req, res, session)
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
          // Images only. This endpoint mints a write token, and one that would
          // accept anything is a place to park anything.
          allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
          addRandomSuffix: true,
          maximumSizeInBytes: 8 * 1024 * 1024,
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

/** The channel list with how much is unread in each. */
async function overview(req, res, session) {
  const known = await knownChannels()
  const standing = CHANNELS.map(c => c.id)
  const all = [...new Set([...standing, ...known])]
  const [sizes, marks] = await Promise.all([channelSizes(all), readMarkers(session.email)])

  return res.status(200).json({
    ok: true,
    channels: CHANNELS.map(c => ({
      ...c,
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

async function read(req, res, session) {
  const channel = validChannel(req.query.channel)
  if (!channel) return res.status(400).json({ error: 'No such channel' })

  const messages = await readChannel(channel)
  // Opening a channel is reading it. Marked here rather than from the phone so
  // a badge cannot be cleared by a request that never showed anybody anything.
  await markRead(session.email, channel, messages.length)

  return res.status(200).json({ ok: true, channel, messages })
}

async function send(req, res, session) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const channel = validChannel(body.channel)
  if (!channel) return res.status(400).json({ error: 'No such channel' })

  const text = String(body.text || '').trim()
  // A photograph on its own is a message. "Here is the form" with nothing typed
  // is most of what the group sends.
  const photo = readPhoto(body.photo)
  if (!text && !photo) return res.status(400).json({ error: 'Nothing to send' })
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
  await notify(others, {
    // Who and where, so a lock screen says whether this is worth stopping for.
    title: where ? `${saved.authorName} · ${where.name}` : `${saved.authorName} · this case`,
    // The message itself. A notification you have to open the app to read is
    // half a notification, and the running order at four o'clock is exactly the
    // thing somebody needs off a lock screen. What is safe to put there is
    // whatever the channels already allow — no patient identifiers, which the
    // composer warns about before anything is sent. See src/chat/identifiers.js.
    body: preview(text),
    // One per channel, replaced rather than stacked: six messages in Spine is
    // one conversation, not six things to clear.
    tag: channel,
    url: '/'
  }).catch(() => {})

  return res.status(200).json({ ok: true, message: saved })
}
