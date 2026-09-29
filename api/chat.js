import { requireSession } from './_auth.js'
import {
  postMessage, readChannel, channelSizes, knownChannels, readMarkers, markRead
} from './_redis.js'
import { firstNameFor } from '../src/staffConfig.js'

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
  const session = await requireSession(req, res)
  if (!session) return
  res.setHeader('Cache-Control', 'no-store')

  try {
    if (req.query.action === 'overview') return overview(req, res, session)
    if (req.method === 'POST') return send(req, res, session)
    return read(req, res, session)
  } catch (err) {
    return res.status(500).json({ error: err.message })
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
  if (!text) return res.status(400).json({ error: 'Nothing to send' })
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
    // Recorded when the sender was warned and sent anyway, so it is possible to
    // find out later how often that happens and whether the wording is working.
    warned: Boolean(body.warned)
  })

  return res.status(200).json({ ok: true, message: saved })
}
