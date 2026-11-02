import { redis, redisSetBody } from './_redis.js'
import { encrypt, decrypt } from './_treasuryCrypto.js'

// ─── Treasury storage ────────────────────────────────────────────────────────
// Redis is the only database this portal has, so the Treasury "tables" are
// keys under `treasury:`, every value encrypted (see _treasuryCrypto.js).
//
//   treasury:settings            base weekly buy, daily auto-buy, Amber cash, payroll
//   treasury:holdings            BTC by entity
//   treasury:dca                 DCA purchase log
//   treasury:ato                 ATO payment schedule
//   treasury:cashitems           one-off cash items for the 13-week view
//   treasury:trust               family trust ledger
//   treasury:snapshots           monthly headline numbers
//   treasury:onchain:{metric}    daily history per metric, [[date, value], ...]
//   treasury:onchain:meta        when each metric was fetched, and from where
//   treasury:onchain:budget      request timestamps, so the source is not hammered
//   treasury:price               last good BTC price
//   treasury:xero:tokens         Xero OAuth tokens and tenant
//   treasury:xero:cache:{name}   each Xero figure, with when it was fetched
//   treasury:audit               access log, newest first, capped
//   treasury:unlock:{hash}       a Face ID / PIN step-up, 15 minutes
//
// Values go in the request body, not the URL: an on-chain history is a few
// hundred kilobytes and Upstash's path form would truncate it.

export const PREFIX = 'treasury:'

export async function tget(name, fallback = null) {
  const raw = await redis('get', PREFIX + name)
  if (raw == null) return fallback
  return decrypt(raw)
}

export async function tset(name, value) {
  await redisSetBody(PREFIX + name, encrypt(value))
  return value
}

export async function tdel(name) {
  await redis('del', PREFIX + name)
}

// ─── Audit ───────────────────────────────────────────────────────────────────

export const AUDIT_CAP = 10000

/**
 * One line per request: who, when, what, and whether it was let through.
 * Refusals are recorded too — the point of the log is to see attempts, not
 * only successes. Never throws: a log that cannot be written must not take the
 * page down with it, and it must not turn a 404 into a 500 for a stranger.
 */
export async function audit({ email, action, page, ok, note }) {
  try {
    const entry = encrypt({
      at: new Date().toISOString(), email: email || null, action: action || null,
      page: page || null, ok: Boolean(ok), ...(note ? { note } : {})
    })
    await redis('lpush', PREFIX + 'audit', entry)
    await redis('ltrim', PREFIX + 'audit', '0', String(AUDIT_CAP - 1))
  } catch { /* see above */ }
}

export async function readAudit(limit = 200) {
  const raw = await redis('lrange', PREFIX + 'audit', '0', String(Math.max(0, limit - 1))) || []
  const out = []
  for (const r of raw) {
    try { out.push(decrypt(r)) } catch { /* written under another key */ }
  }
  return out
}
