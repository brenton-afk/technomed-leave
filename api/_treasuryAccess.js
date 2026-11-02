import { redis } from './_redis.js'
import { getSession, destroySession } from './_auth.js'
import { tokenHash } from './_treasuryCrypto.js'
import { audit } from './_treasuryStore.js'

// ─── Who may see the Treasury ────────────────────────────────────────────────
// TREASURY_USERS, comma- or space-separated emails. Unset means nobody: the
// section fails closed rather than open, because an env var that went missing
// in a redeploy must not hand the company's finances to every admin.
//
// Everyone else — signed out, other staff, other admins — is answered with a
// 404 whose body is the same as a route that does not exist. Not a 401 and not
// a 403: either of those confirms there is something here to be refused from.
//
// On top of the list there is a step-up. Opening the section asks for Face ID
// (or the PIN), and the server holds that as `treasury:unlock:{hash}` against
// the session for 15 minutes, refreshed while in use. The check is the server's,
// not the phone's: a stolen session token on its own opens nothing here.

export const UNLOCK_SECONDS = 15 * 60
/** A sign-in this recent counts as having just proved it is you. */
export const FRESH_SIGN_IN_MS = 2 * 60 * 1000

export function allowedUsers(env = process.env) {
  return String(env.TREASURY_USERS || '')
    .split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
}

export function isAllowed(email, env = process.env) {
  if (!email) return false
  return allowedUsers(env).includes(String(email).toLowerCase())
}

export function tokenFrom(req) {
  const header = req.headers?.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : null
}

/** Exactly what Vercel says about a path that is not there. */
export function notFound(res) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  return res.status(404).send('The page could not be found\n\nNOT_FOUND\n')
}

/**
 * The signed-in, allowed session — or null after answering 404.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.needUnlock=true]  false for the two calls that come
 *   before the step-up: asking whether to show the card, and the unlock itself.
 */
export async function treasuryGate(req, res, { action, page, needUnlock = true } = {}) {
  const token = tokenFrom(req)
  const session = token ? await getSession(token) : null
  if (!session || !isAllowed(session.email)) {
    await audit({ email: session?.email, action, page, ok: false })
    notFound(res)
    return null
  }
  if (needUnlock) {
    const key = `treasury:unlock:${tokenHash(token)}`
    const unlocked = await redis('get', key)
    if (!unlocked) {
      await audit({ email: session.email, action, page, ok: false, note: 'locked' })
      res.status(403).json({ locked: true })
      return null
    }
    // Sliding: fifteen minutes of inactivity, not fifteen minutes in total.
    redis('expire', key, String(UNLOCK_SECONDS)).catch(() => {})
  }
  await audit({ email: session.email, action, page, ok: true })
  return { ...session, token }
}

/**
 * Turns a fresh sign-in into a Treasury unlock for the main session.
 *
 * The phone runs Face ID (or the PIN) against the existing sign-in endpoint,
 * which mints a brand new session. That new token arrives here as the bearer;
 * the session the app is actually using comes in the body. If the new one is
 * minutes old and both belong to the same allowed person, the main session is
 * unlocked and the throwaway one is destroyed, so step-ups do not leave a
 * trail of month-long sessions behind them.
 */
export async function unlockTreasury(req, res) {
  const proofToken = tokenFrom(req)
  const mainToken = req.body?.mainToken
  const proof = proofToken ? await getSession(proofToken) : null
  const main = mainToken ? await getSession(mainToken) : null
  const fresh = proof && Date.now() - Date.parse(proof.createdAt) < FRESH_SIGN_IN_MS
  if (!proof || !main || !fresh || proof.email !== main.email || !isAllowed(main.email)) {
    await audit({ email: main?.email || proof?.email, action: 'unlock', ok: false })
    notFound(res)
    return null
  }
  if (proofToken !== mainToken) await destroySession(proofToken)
  await redis('set', `treasury:unlock:${tokenHash(mainToken)}`, '1', 'EX', String(UNLOCK_SECONDS))
  await audit({ email: main.email, action: 'unlock', ok: true })
  return main
}

export async function lockTreasury(token) {
  if (token) await redis('del', `treasury:unlock:${tokenHash(token)}`)
}
