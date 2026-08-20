import { redis } from './_redis.js'
import { STAFF } from '../src/staffConfig.js'

// Sessions replace the shared admin password. A token is minted when a staff
// member proves their PIN, and expires server-side via a Redis TTL so a leaked
// token cannot be replayed indefinitely.
export const SESSION_TTL_SECONDS = 60 * 60

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
  try { return JSON.parse(data) } catch { return null }
}

export async function destroySession(token) {
  if (token) await redis('del', `session:${token}`)
}

function tokenFrom(req) {
  const header = req.headers?.authorization || ''
  if (header.startsWith('Bearer ')) return header.slice(7)
  return req.body?.token || req.query?.token || null
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
