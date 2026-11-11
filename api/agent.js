// ─── A read-only door for Claude (Brent, 9 Nov 2026) ─────────────────────────
// "You need to be able to cross check with the portal." Claude, working in a
// cloud session, can reach this site but has no staff login — and should not
// have one: a login can do everything its owner can.
//
// This is a key, not a login, and it opens two things only:
//   GET  ?action=usage&from=YYYY-MM-DD&to=YYYY-MM-DD   usage cases in a window
//   POST ?action=sales-check  { file: <base64 .xlsx> }  the sales-report check
//   GET  ?action=bookings-find&q=…     emails in bookings@ and what the portal
//                                      made of each (no q: everything set aside)
//   GET  ?action=bookings-email&id=…   one bookings@ email: headers, text,
//                                      attachment names, its record and cards
//   GET  ?action=bookings-read&id=…    what the reader finds in it, as a dry
//                                      run — nothing queued, nothing marked
// (Brent, 11 Nov 2026: "you must be able to access the bookings email from
// here so we can work through a resolution".)
// All only read. No action here writes to Redis (except the log below), the
// calendar, Dropbox, Xero or anyone's inbox.
//
// The key is AGENT_READ_KEY in Vercel. Unset or short, this route does not
// exist (404), the same as any other wrong address. Every call is logged —
// refused ones included — under `agent:log`, readable by admins.

import { timingSafeEqual, createHash } from 'node:crypto'
import { redis } from './_redis.js'
import { usageCasesBetween, checkSalesReport } from './_salesCheck.js'
import { listBookingEmails } from './calendar/today.js'
import { readMessage, addressOf } from './_gmail.js'
import { bookingEmailRecord, getBookingQueue } from './_redis.js'
import { readBookingDocument } from './_readBookingDocument.js'
import { parseTheatreList } from '../src/clinicalPlan/parseTheatreList.js'
import { sourceOf } from '../src/clinicalPlan/bookingSources.js'

const MIN_KEY_LENGTH = 32
const MAX_WINDOW_DAYS = 400

function keyMatches(given, expected) {
  // Hashed first so the comparison is constant-time whatever the lengths.
  const a = createHash('sha256').update(String(given)).digest()
  const b = createHash('sha256').update(String(expected)).digest()
  return timingSafeEqual(a, b)
}

async function log(entry) {
  try {
    await redis('lpush', 'agent:log', JSON.stringify({ at: new Date().toISOString(), ...entry }))
    await redis('ltrim', 'agent:log', '0', '499')
  } catch { /* a log that cannot be written is no reason to fail the read */ }
}

const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const expected = process.env.AGENT_READ_KEY || ''
  if (expected.length < MIN_KEY_LENGTH) return res.status(404).json({ error: 'Not found' })

  const action = String(req.query.action || '')
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!given || !keyMatches(given, expected)) {
    await log({ action, ok: false, reason: 'bad key', ip })
    return res.status(401).json({ error: 'Not authorised' })
  }

  try {
    if (action === 'usage' && req.method === 'GET') {
      const from = String(req.query.from || '')
      const to = String(req.query.to || '')
      if (!isDay(from) || !isDay(to) || from > to) return res.status(400).json({ error: 'from and to must be YYYY-MM-DD, from first' })
      if ((Date.parse(to) - Date.parse(from)) / 86400000 > MAX_WINDOW_DAYS) return res.status(400).json({ error: `At most ${MAX_WINDOW_DAYS} days at a time` })
      const cases = await usageCasesBetween(from, to)
      await log({ action, ok: true, from, to, count: cases.length, ip })
      return res.status(200).json({ cases })
    }
    if (action === 'sales-check' && req.method === 'POST') {
      const file = String(req.body?.file || '')
      if (!file) return res.status(400).json({ error: 'POST { file: <base64 .xlsx> }' })
      const result = await checkSalesReport(Buffer.from(file, 'base64'))
      await log({ action, ok: true, invoices: result.totals?.invoices, ip })
      return res.status(200).json(result)
    }
    const id = String(req.query.id || '')
    const goodId = /^[A-Za-z0-9_-]{6,64}$/.test(id)
    if (action === 'bookings-find' && req.method === 'GET') {
      const result = await listBookingEmails({ q: String(req.query.q || '') })
      await log({ action, ok: true, count: result.emails.length, ip })
      return res.status(200).json(result)
    }
    if (action === 'bookings-email' && req.method === 'GET') {
      if (!goodId) return res.status(400).json({ error: 'id=<Gmail message id>' })
      const email = await readMessage(id, { withAttachments: false })
      const record = await bookingEmailRecord(id)
      const cards = (await getBookingQueue()).filter(c => c.messageId === id)
      await log({ action, ok: true, ip })
      return res.status(200).json({
        id, from: email.from, subject: email.subject, date: email.date, receivedAt: email.receivedAt,
        source: sourceOf(addressOf(email.from))?.id || null,
        text: String(email.text || '').slice(0, 20000),
        html: email.text ? '' : String(email.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 20000),
        attachments: (email.attachments || []).map(a => ({ filename: a.filename, mediaType: a.mediaType })),
        record, cards
      })
    }
    if (action === 'bookings-read' && req.method === 'GET') {
      if (!goodId) return res.status(400).json({ error: 'id=<Gmail message id>' })
      const email = await readMessage(id)
      let found = sourceOf(addressOf(email.from))?.id === 'rhh' ? parseTheatreList(email) : []
      if (!found.length) found = await readBookingDocument(email)
      await log({ action, ok: true, found: found.length, ip })
      return res.status(200).json({ id, found })
    }
    await log({ action, ok: false, reason: 'unknown action', ip })
    return res.status(400).json({ error: 'Unknown action. GET usage | bookings-find | bookings-email | bookings-read, or POST sales-check' })
  } catch (err) {
    await log({ action, ok: false, reason: 'failed', ip })
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'That could not be read just now.' })
  }
}
