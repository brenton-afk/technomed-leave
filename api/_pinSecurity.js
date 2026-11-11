import { scryptSync, randomBytes, timingSafeEqual, randomInt } from 'node:crypto'
import { redis } from './_redis.js'

// ─── PIN security (review, 6 Nov 2026) ───────────────────────────────────────
// Three holes, all closed here:
//
// 1. A four-digit PIN has 10,000 values and `verify` would answer as many
//    guesses as anyone cared to send. Now five wrong in a row locks that
//    person's PIN for fifteen minutes. Face ID still works meanwhile, and an
//    admin reset clears the lock.
// 2. PINs sat in Redis as plain text. They are now scrypt hashes. An old
//    plain one still signs in once and is re-stored hashed on the spot, so
//    nobody has to be reset for the change.
// 3. Anybody could pick a name with no PIN yet and choose one, becoming that
//    person. Setting a first PIN now needs a code emailed to the staff
//    address, so only whoever reads that inbox can claim the account.

export const MAX_PIN_FAILURES = 5
export const LOCK_SECONDS = 15 * 60
export const CODE_SECONDS = 15 * 60
export const CODE_RESEND_SECONDS = 60
export const MAX_CODE_FAILURES = 5

const PREFIX = 's1'

export function hashPin(pin, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(pin), salt, 32).toString('hex')
  return `${PREFIX}:${salt}:${hash}`
}

export function isHashed(stored) {
  return typeof stored === 'string' && stored.startsWith(`${PREFIX}:`)
}

/** Constant-time comparison of a typed PIN against what is stored, hashed or not. */
export function pinMatches(stored, pin) {
  if (!stored || pin == null) return false
  if (isHashed(stored)) {
    const [, salt, hash] = stored.split(':')
    const want = Buffer.from(hash || '', 'hex')
    const got = scryptSync(String(pin), salt || '', 32)
    return want.length === got.length && timingSafeEqual(want, got)
  }
  const a = Buffer.from(String(stored))
  const b = Buffer.from(String(pin))
  return a.length === b.length && timingSafeEqual(a, b)
}

const failKey = email => `pinfail:${email}`
const codeKey = email => `pincode:${email}`
const codeTriesKey = email => `pincode:tries:${email}`
const codeSentKey = email => `pincode:sent:${email}`

/** Seconds left on a lock, or 0 if this person may try. */
export async function lockedFor(email) {
  const n = Number(await redis('get', failKey(email))) || 0
  if (n < MAX_PIN_FAILURES) return 0
  const ttl = Number(await redis('ttl', failKey(email)))
  return ttl > 0 ? ttl : LOCK_SECONDS
}

/** Counts a wrong PIN; returns how many tries are left before the lock. */
export async function recordFailure(email) {
  const n = Number(await redis('incr', failKey(email))) || 1
  // The window starts at the first miss and is not pushed back by later ones,
  // except that reaching the limit starts the full lock from then.
  if (n === 1 || n === MAX_PIN_FAILURES) await redis('expire', failKey(email), String(LOCK_SECONDS))
  return Math.max(0, MAX_PIN_FAILURES - n)
}

export async function clearFailures(email) {
  await redis('del', failKey(email))
}

export function newCode() {
  return String(randomInt(0, 1000000)).padStart(6, '0')
}

/**
 * Makes and stores a sign-in code, unless one went out in the last minute.
 * Returns the code to email, or null when the last one is still fresh.
 */
export async function issueCode(email) {
  const claimed = await redis('set', codeSentKey(email), '1', 'NX', 'EX', String(CODE_RESEND_SECONDS))
  if (claimed !== 'OK') return null
  const code = newCode()
  await redis('set', codeKey(email), hashPin(code), 'EX', String(CODE_SECONDS))
  await redis('del', codeTriesKey(email))
  return code
}

/** 'ok', 'wrong', or 'expired' (none issued, timed out, or too many wrong tries). */
export async function checkCode(email, code) {
  const stored = await redis('get', codeKey(email))
  if (!stored) return 'expired'
  if (pinMatches(stored, String(code || '').trim())) {
    await redis('del', codeKey(email))
    await redis('del', codeTriesKey(email))
    return 'ok'
  }
  const tries = Number(await redis('incr', codeTriesKey(email))) || 1
  if (tries === 1) await redis('expire', codeTriesKey(email), String(CODE_SECONDS))
  if (tries >= MAX_CODE_FAILURES) {
    await redis('del', codeKey(email))
    return 'expired'
  }
  return 'wrong'
}

/** "br•••••@technomed.com.au" — enough to recognise, not to harvest. */
export function maskEmail(email) {
  const [user, domain] = String(email).split('@')
  if (!domain) return ''
  return `${user.slice(0, 2)}${'•'.repeat(Math.max(1, user.length - 2))}@${domain}`
}

// ─── Every session a person holds, so a reset can end them all ──────────────

const sessionsKey = email => `sessions:${email}`

// No TTL on the set: sessions slide, so any expiry on the index could run out
// while a session it names is still live, and the reset would miss it. A dead
// token left in the set costs one harmless DEL.
export async function trackSession(email, token) {
  await redis('sadd', sessionsKey(email), token)
}

export async function endAllSessions(email) {
  const tokens = (await redis('smembers', sessionsKey(email))) || []
  for (const t of tokens) await redis('del', `session:${t}`)
  // And out of this instance's memory at once (see getSession in _auth.js).
  try { const { forgetSessions } = await import('./_auth.js'); tokens.forEach(t => forgetSessions(t)) } catch { /* the minute runs out */ }
  await redis('del', sessionsKey(email))
  return tokens.length
}
