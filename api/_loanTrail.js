// ─── A loan set's email trail ─────────────────────────────────────────────────
// "Click on a booking … that has a distributor loan set booked and it
// automatically shows you the information pertaining to the loan set that has
// been arranged including extracted data from the email trail that requested
// it … a basic summary of the correspondence to show that the loan set has been
// booked and if tray lists were attached … access to those attachments."
//  — Brent, 3 Nov 2026.
//
// Where it looks, as Brent decided: the bookings inbox and every team member's
// mailbox, under the domain-wide grant the bookings inbox already uses. How it
// looks is what keeps that proportionate: one Gmail search per mailbox, and the
// search is always all three of
//
//   · from, to or cc the distributor's own domain,
//   · the patient's surname,
//   · within sixty days before the surgery and a fortnight after it.
//
// Nothing else in anybody's mailbox is listed, opened or read. The same email
// copied to several of us is shown once (by its Message-ID).
//
// Attachments are not downloaded here. Each gets a token, held for an hour,
// that names exactly one attachment in one message in one mailbox — so the
// screen can open a tray list without the server ever accepting a mailbox or
// message id from the browser.

import { randomUUID, createHash } from 'node:crypto'
import { redis, redisSetBody } from './_redis.js'
import { searchMailboxOf, readMessageHeadline, readAttachment, addressOf } from './_gmail.js'
import { askClaude, AiUnavailable } from './_anthropic.js'
import { STAFF } from '../src/staffConfig.js'
import { addCivilDays, parseDateStr, toDateStr } from '../src/clinicalPlan/week.js'

export const DISTRIBUTOR_DOMAINS = {
  device: ['device.com.au'],
  e4: ['e4surgical.com'],
  globus: ['globusmedical.com', 'nuvasive.com'],
  kt: ['ktmedical.com.au'],
  signus: ['signus.com.au']
}
export const DISTRIBUTOR_LABELS = {
  device: 'Device Technologies', e4: 'E4 Surgical', globus: 'Globus / NuVasive', kt: 'KT Medical', signus: 'Signus'
}

const BOOKINGS = process.env.BOOKINGS_MAILBOX || 'bookings@technomed.com.au'
const MODEL = process.env.LOAN_TRAIL_MODEL || 'claude-sonnet-5-5'
const FALLBACK_MODEL = 'claude-opus-5'
const TOKEN_TTL_S = 3600
const MAX_EMAILS = 12

/** The mailboxes searched: the bookings inbox, then each of the team. */
export function mailboxesToSearch() {
  return [...new Set([BOOKINGS, ...STAFF.map(s => s.email)].map(a => a.toLowerCase()))]
}

const gmailDate = iso => iso.replace(/-/g, '/')

/** The Gmail search for one distributor's correspondence about one case. */
export function trailQuery({ distributor, surname, date }) {
  const domains = DISTRIBUTOR_DOMAINS[distributor] || []
  if (!domains.length || !surname || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null
  const who = domains.flatMap(d => [`from:${d}`, `to:${d}`, `cc:${d}`]).join(' OR ')
  const after = toDateStr(addCivilDays(parseDateStr(date), -60))
  const before = toDateStr(addCivilDays(parseDateStr(date), 15))
  const name = String(surname).replace(/["\\]/g, '').trim()
  return `(${who}) "${name}" after:${gmailDate(after)} before:${gmailDate(before)}`
}

/** Quoted replies off the bottom of an email: the trail already has them. */
export function freshText(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const cut = lines.findIndex(l => /^\s*>/.test(l) || /^On .+wrote:\s*$/.test(l.trim())
    || /^-{2,}\s*Original Message/i.test(l) || /^From:\s.+/.test(l.trim()))
  return (cut > 0 ? lines.slice(0, cut) : lines).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

async function searchAll(query) {
  const found = []
  await Promise.all(mailboxesToSearch().map(async mailbox => {
    try {
      const ids = await searchMailboxOf(mailbox, query, { max: 10 })
      for (const id of ids) found.push({ mailbox, id })
    } catch {
      // A mailbox the grant cannot reach (a departed address, a typo in the
      // roster) is skipped, not fatal: the others still answer.
    }
  }))
  return found
}

/** The emails for one distributor's loan set on one booking, oldest first, each once. */
export async function emailsFor({ distributor, surname, date }) {
  const query = trailQuery({ distributor, surname, date })
  if (!query) return []
  const hits = await searchAll(query)
  const read = await Promise.all(hits.slice(0, 40).map(h =>
    readMessageHeadline(h.mailbox, h.id).catch(() => null)))
  const seen = new Set()
  const out = []
  // The bookings inbox first, so where the same email sits in several
  // mailboxes the shared copy is the one kept.
  const ordered = read.filter(Boolean).sort((a, b) => (a.mailbox === BOOKINGS ? -1 : 0) - (b.mailbox === BOOKINGS ? -1 : 0))
  for (const m of ordered) {
    const key = m.messageId || `${m.from}|${m.subject}|${m.receivedAt}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(m)
  }
  return out.sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt))).slice(-MAX_EMAILS)
}

/** Holds one attachment's whereabouts for an hour, and returns the token for it. */
async function attachmentToken(mailbox, messageId, att) {
  const token = randomUUID()
  await redis('set', `loanatt:${token}`, JSON.stringify({
    mailbox, messageId, attachmentId: att.attachmentId, filename: att.filename, mediaType: att.mediaType
  }), 'EX', String(TOKEN_TTL_S))
  return token
}

/** Fetches the attachment a token names. Null when the token is unknown or expired. */
export async function attachmentFor(token) {
  if (!/^[0-9a-f-]{36}$/i.test(String(token || ''))) return null
  const raw = await redis('get', `loanatt:${token}`)
  if (!raw) return null
  const held = JSON.parse(raw)
  const { data, mediaType } = await readAttachment(held.mailbox, held.messageId, held.attachmentId)
  return { data, mediaType: mediaType || held.mediaType || 'application/octet-stream', filename: held.filename }
}

// ─── Calendar invitations ─────────────────────────────────────────────────────
// Device's booking system answers a loan request with a calendar invitation
// ("BKG ANKUSH GUPTA, MIS POSTERIOR PEDICLE SCREWS", invite.ics). A phone
// cannot show that file — the link opened a blank page — and it is the most
// useful thing in the trail: the supplier's own booking. So it is read here
// and shown as facts, and it settles the set as confirmed on its own.

const isInvite = a => /\.ics$/i.test(a.filename || '') || /text\/calendar/i.test(a.mediaType || '')

/** SUMMARY, DTSTART, DTEND and LOCATION out of an iCalendar file's first event. */
export function parseInvite(ics) {
  const unfolded = String(ics || '').replace(/\r?\n[ \t]/g, '')
  const event = (/BEGIN:VEVENT([\s\S]*?)END:VEVENT/.exec(unfolded) || [])[1] || unfolded
  const field = name => {
    const m = new RegExp(`^${name}(?:;[^:\\n]*)?:(.*)$`, 'mi').exec(event)
    return m ? m[1].replace(/\\n/g, ' ').replace(/\\([,;\\])/g, '$1').trim() : ''
  }
  const when = raw => {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(raw || '')
    if (!m) return null
    if (!m[4]) return { date: `${m[1]}-${m[2]}-${m[3]}`, allDay: true }
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? 'Z' : ''}`
    return { iso, allDay: false, utc: Boolean(m[7]) }
  }
  const summary = field('SUMMARY')
  if (!summary && !field('DTSTART')) return null
  return { summary, start: when(field('DTSTART')), end: when(field('DTEND')), location: field('LOCATION') }
}

/** "Thu 12 Nov, 7:00 am" in Hobart, or the date alone for an all-day entry. */
export function inviteWhen(start) {
  if (!start) return ''
  if (start.allDay) {
    const d = new Date(`${start.date}T12:00:00Z`)
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  }
  // A time without Z is the sender's local time; for a Melbourne or Hobart
  // supplier that is our time, which is the best reading available.
  const d = new Date(start.utc ? start.iso : `${start.iso}+11:00`)
  return d.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Hobart' })
}

async function readInvites(email) {
  const invites = []
  for (const a of email.attachments.filter(isInvite)) {
    if (a.size && a.size > 300000) continue
    try {
      const { data } = await readAttachment(email.mailbox, email.id, a.attachmentId)
      const parsed = parseInvite(Buffer.from(data, 'base64').toString('utf8'))
      if (parsed) invites.push(parsed)
    } catch { /* an unreadable invitation is just not shown */ }
  }
  return invites
}

// ─── Kept for a quarter of an hour ────────────────────────────────────────────
// "It does take a little while to load." Ten mailboxes searched and a summary
// written each time a booking opens; reopening the same booking within fifteen
// minutes now shows the same answer at once. Keyed on what the trail depends
// on, so changing the kit or the patient looks again.
const CACHE_S = 900
const cacheKey = (eventId, booking) => `loantrail:${eventId}:${createHash('sha256')
  .update(JSON.stringify([booking?.loans || {}, booking?.patient || '', booking?.date || ''])).digest('hex').slice(0, 16)}`

export async function cachedLoanTrail(eventId, booking, loanLog, { fresh = false } = {}) {
  const key = cacheKey(eventId, booking)
  if (!fresh) {
    try {
      const held = await redis('get', key)
      if (held) return { ...JSON.parse(held), cached: true }
    } catch { /* look again */ }
  }
  const sets = await loanTrail(booking, loanLog)
  const result = { sets, at: new Date().toISOString() }
  try {
    await redisSetBody(key, JSON.stringify(result))
    await redis('expire', key, String(CACHE_S))
  } catch { /* shown anyway, just not kept */ }
  return result
}

const PROMPT = `These are the emails between TechnoMed (a surgical device distributor's agent in Hobart) and a supplier about a loan set for one surgical case. Summarise where the loan set stands, for a rep reading it on a phone.

Reply with JSON only:
{
  "status": "confirmed" | "requested" | "changed" | "cancelled" | "unclear",
  "summary": "two or three short sentences: who asked for what and when, and what the supplier said",
  "facts": [ { "label": "Set", "value": "…" }, … ]
}

Facts are only what the emails actually say, each short: the set(s), the delivery or arrival date and time, where it is going, a con note or tracking number, a pick-up or return arrangement, anything still outstanding. Leave out anything not stated. Never guess. Do not repeat the patient's name.`

/** A summary of the trail, or null when the summariser is unavailable. */
async function summarise(emails, { distributor }) {
  if (!emails.length) return null
  const transcript = emails.map(m => [
    `From: ${m.from}`, `Date: ${m.receivedAt}`, `Subject: ${m.subject}`,
    m.attachments.length ? `Attached: ${m.attachments.map(a => a.filename).join(', ')}` : '',
    '', freshText(m.text).slice(0, 1800)
  ].filter(Boolean).join('\n')).join('\n\n---\n\n').slice(0, 16000)

  const ask = model => askClaude({
    feature: 'loan-trail',
    whenUnavailable: 'The emails are below; a summary is not available right now.',
    request: {
      model,
      max_tokens: 900,
      messages: [{ role: 'user', content: `Supplier: ${DISTRIBUTOR_LABELS[distributor] || distributor}\n\n${transcript}\n\n${PROMPT}` }]
    }
  })
  let reply
  try {
    reply = await ask(MODEL)
  } catch (err) {
    if (!(err instanceof AiUnavailable) || !/model/i.test(String(err.detail || '')) || MODEL === FALLBACK_MODEL) return null
    try { reply = await ask(FALLBACK_MODEL) } catch { return null }
  }
  const text = reply.content.filter(b => b.type === 'text').map(b => b.text).join('')
  const json = /\{[\s\S]*\}/.exec(text)
  if (!json) return null
  try {
    const parsed = JSON.parse(json[0])
    const status = ['confirmed', 'requested', 'changed', 'cancelled', 'unclear'].includes(parsed.status) ? parsed.status : 'unclear'
    return {
      status,
      summary: String(parsed.summary || '').slice(0, 600),
      facts: (parsed.facts || []).filter(f => f?.label && f?.value).slice(0, 8)
        .map(f => ({ label: String(f.label).slice(0, 40), value: String(f.value).slice(0, 200) }))
    }
  } catch {
    return null
  }
}

/** Who a message is from, as the team knows them. */
function whoIs(from) {
  const address = addressOf(from)
  const staff = STAFF.find(s => s.email.toLowerCase() === address)
  if (staff) return staff.firstName
  if (address === BOOKINGS) return 'Bookings'
  return String(from || '').replace(/<[^>]+>/, '').replace(/"/g, '').trim() || address
}

/**
 * Everything the booking's loan sets have to show.
 *
 * @param {{ loans: Object<string,string[]>, patient: string, date: string }} booking from describeBooking
 * @param {Array} [loanLog] what the portal itself sent, from loanLogFor
 */
export async function loanTrail(booking, loanLog = []) {
  const loans = Object.entries(booking?.loans || {}).filter(([d, systems]) => DISTRIBUTOR_DOMAINS[d] && systems?.length)
  const surname = String(booking?.patient || '').trim()
  return Promise.all(loans.map(async ([distributor, systems]) => {
    const emails = surname ? await emailsFor({ distributor, surname, date: booking.date }) : []
    const invitesBy = await Promise.all(emails.map(readInvites))
    const invites = invitesBy.flat()
    let summary = await summarise(emails, { distributor })
    const fromSupplier = emails.some((m, i) => invitesBy[i].length && !/@technomed\.com\.au>?$/i.test(addressOf(m.from)))
    const inviteFacts = invites.slice(0, 2).flatMap(inv => [
      { label: 'Supplier booking', value: inv.summary },
      ...(inv.start ? [{ label: 'Booked for', value: inviteWhen(inv.start) }] : []),
      ...(inv.location ? [{ label: 'Location', value: inv.location }] : [])
    ]).filter(f => f.value)
    if (!summary && emails.length) {
      summary = fromSupplier
        ? { status: 'confirmed', summary: `${DISTRIBUTOR_LABELS[distributor] || 'The supplier'}'s booking system has booked it.`, facts: [] }
        : { status: 'unclear', summary: '', facts: [] }
    } else if (summary && fromSupplier && summary.status === 'unclear') {
      summary = { ...summary, status: 'confirmed' }
    }
    if (summary) {
      const seen = new Set(summary.facts.map(f => f.value.toLowerCase()))
      summary = { ...summary, facts: [...inviteFacts.filter(f => !seen.has(f.value.toLowerCase())), ...summary.facts].slice(0, 8) }
    }
    const shown = await Promise.all(emails.map(async m => ({
      from: whoIs(m.from),
      outgoing: /@technomed\.com\.au>?$/i.test(addressOf(m.from)),
      subject: m.subject,
      at: m.receivedAt,
      text: freshText(m.text).slice(0, 1500),
      // Invitations are read above and shown as facts; as a link they opened
      // a blank page, since a phone cannot display one.
      attachments: await Promise.all(m.attachments.filter(a => !isInvite(a)).map(async a => ({
        filename: a.filename,
        mediaType: a.mediaType,
        size: a.size,
        token: await attachmentToken(m.mailbox, m.id, a).catch(() => null)
      })))
    })))
    return {
      distributor,
      name: DISTRIBUTOR_LABELS[distributor] || distributor,
      systems,
      sentFromPortal: loanLog.filter(l => !l.hospital && l.to && (DISTRIBUTOR_LABELS[distributor] || '').startsWith(l.to.split(' ')[0])),
      summary,
      emails: shown,
      searched: Boolean(surname)
    }
  }))
}
