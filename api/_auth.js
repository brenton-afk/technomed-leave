import { redis } from './_redis.js'
import { STAFF } from '../src/staffConfig.js'

// Sessions replace the shared admin password. A token is minted when a staff
// member proves their PIN, and expires server-side via a Redis TTL so a leaked
// token cannot be replayed indefinitely.
//
// ── Why thirty days and not an hour ──
//
// It was an hour, and it made the app feel like it demanded a password every
// time somebody opened it — which it did, because the hour was not the half of
// it: the token lived in sessionStorage, which iOS throws away when the app is
// closed. Every single open was a fresh sign-in. Nobody checks a case list
// that asks for a PIN first, so people went back to reading the Google
// calendar, which is the thing this replaces.
//
// Google Calendar and Dropbox are not unauthenticated. They hold a long-lived
// credential and never ask again, and the phone's own lock is what protects
// it. That is what this now does: a month-long session on the device, with
// Face ID in front of it, so the door is still there and opening it is one
// touch.
//
// The window is longer, so what matters more is that it can be shut. A token
// is destroyed on sign-out, a PIN reset ends the sessions that used it, and
// the TTL still runs — a device that stops being used stops working within
// the month rather than forever.
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

export async function createSession(email) {
  const staff = STAFF.find(s => s.email === email)
  if (!staff) throw new Error('Staff member not found')
  const token = crypto.randomUUID()
  const session = {
    email: staff.email,
    name: staff.name,
    isAdmin: !!staff.isAdmin,
    createdAt: new Date().toISOString()
  }
  await redis('set', `session:${token}`, JSON.stringify(session), 'EX', String(SESSION_TTL_SECONDS))
  return { token, session }
}

export async function getSession(token) {
  if (!token) return null
  const data = await redis('get', `session:${token}`)
  if (!data) return null
  try {
    const session = JSON.parse(data)
    // Sliding, not fixed. A month of inactivity ends it; a month of daily use
    // does not. Without this the old hour expired mid-afternoon on somebody
    // halfway through a timesheet, and thirty days would only have moved that
    // to a worse surprise once a month.
    //
    // Deliberately not awaited: extending a session is housekeeping, and no
    // request should get slower because of it. A refresh that fails leaves the
    // original TTL, which is the safe direction.
    redis('expire', `session:${token}`, String(SESSION_TTL_SECONDS)).catch(() => {})
    return session
  } catch { return null }
}

export async function destroySession(token) {
  if (token) await redis('del', `session:${token}`)
}

function tokenFrom(req) {
  const header = req.headers?.authorization || ''
  if (header.startsWith('Bearer ')) return header.slice(7)
  return req.body?.token || req.query?.token || null
}

// Any signed-in staff member. Use this to guard routes that handle patient or
// case data — they must never be reachable without a session.
// Returns the session on success, or null after writing the error response.
export async function requireSession(req, res) {
  const session = await getSession(tokenFrom(req))
  if (!session) {
    res.status(401).json({ error: 'Not signed in, or your session has expired' })
    return null
  }
  if (!STAFF.some(s => s.email === session.email)) {
    res.status(403).json({ error: 'Not authorised' })
    return null
  }
  return session
}

// Returns the session on success, or null after writing the error response.
export async function requireAdmin(req, res) {
  const session = await getSession(tokenFrom(req))
  if (!session) {
    res.status(401).json({ error: 'Not signed in, or your session has expired' })
    return null
  }
  // isAdmin is re-read from staffConfig so revoking admin takes effect
  // immediately rather than when the session happens to expire.
  const staff = STAFF.find(s => s.email === session.email)
  if (!staff?.isAdmin) {
    res.status(403).json({ error: 'Not authorised' })
    return null
  }
  return session
}
