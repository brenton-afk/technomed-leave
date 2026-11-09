// ─── A read-only door for Claude (Brent, 9 Nov 2026) ─────────────────────────
// "You need to be able to cross check with the portal." Claude, working in a
// cloud session, can reach this site but has no staff login — and should not
// have one: a login can do everything its owner can.
//
// This is a key, not a login, and it opens two things only:
//   GET  ?action=usage&from=YYYY-MM-DD&to=YYYY-MM-DD   usage cases in a window
//   POST ?action=sales-check  { file: <base64 .xlsx> }  the sales-report check
// Both only read. No action here writes to Redis (except the log below), the
// calendar, Dropbox, Xero or anyone's inbox.
//
// The key is AGENT_READ_KEY in Vercel. Unset or short, this route does not
// exist (404), the same as any other wrong address. Every call is logged —
// refused ones included — under `agent:log`, readable by admins.

import { timingSafeEqual, createHash } from 'node:crypto'
import { redis } from './_redis.js'
import { usageCasesBetween, checkSalesReport } from './_salesCheck.js'

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
    await log({ action, ok: false, reason: 'unknown action', ip })
    return res.status(400).json({ error: 'Unknown action. GET ?action=usage&from=&to= or POST ?action=sales-check' })
  } catch (err) {
    await log({ action, ok: false, reason: 'failed', ip })
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'That could not be read just now.' })
  }
}
