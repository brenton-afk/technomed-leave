import { STAFF } from '../../src/staffConfig.js'
import { redis } from '../_redis.js'
import { createSession, destroySession, requireAdmin, requireSession, SESSION_TTL_SECONDS } from '../_auth.js'
import {
  beginRegistration, finishRegistration, beginAuthentication, finishAuthentication,
  listPasskeys, hasPasskeys, removePasskey, removeAllPasskeys
} from '../_passkeys.js'
import { sendPinResetRequestEmail } from '../_email.js'

export default async function handler(req, res) {
  const body = req.method === 'POST' ? req.body : req.query
  const { action, email, pin, newPin } = body

  try {
    return await route(req, res, body, { action, email, pin, newPin })
  } catch (err) {
    console.error(`auth/pin ${action} failed:`, err.message)
    return res.status(err.status || 400).json({ error: err.message })
  }
}

async function route(req, res, body, { action, email, pin, newPin }) {

  if (action === 'verify') {
    if (!email || !pin) return res.status(400).json({ error: 'Email and PIN required' })
    const stored = await redis('get', `pin:${email}`)
    if (!stored) return res.status(200).json({ valid: false, needsSetup: true })
    if (stored !== pin) return res.status(200).json({ valid: false })
    const { token, session } = await createSession(email)
    const staff = STAFF.find(s => s.email === email)
    return res.status(200).json({
      valid: true,
      token,
      expiresIn: SESSION_TTL_SECONDS,
      isAdmin: session.isAdmin,
      name: session.name,
      staff
    })
  }

  if (action === 'set') {
    if (!email || !newPin) return res.status(400).json({ error: 'Email and PIN required' })
    if (!/^\d{4}$/.test(newPin)) return res.status(400).json({ error: 'PIN must be 4 digits' })
    const staff = STAFF.find(s => s.email === email)
    if (!staff) return res.status(404).json({ error: 'Staff member not found' })
    // Only allow self-service setup when no PIN exists; changing an existing
    // PIN has to go through an admin reset.
    const existing = await redis('get', `pin:${email}`)
    if (existing) return res.status(409).json({ error: 'A PIN is already set. Ask an admin to reset it.' })
    await redis('set', `pin:${email}`, newPin)
    const { token, session } = await createSession(email)
    return res.status(200).json({
      success: true,
      token,
      expiresIn: SESSION_TTL_SECONDS,
      name: session.name,
      isAdmin: session.isAdmin,
      staff
    })
  }

  if (action === 'check') {
    if (!email) return res.status(400).json({ error: 'Email required' })
    const stored = await redis('get', `pin:${email}`)
    return res.status(200).json({ hasPin: !!stored })
  }

  // Who has signed in before. Lets an admin see which staff have never set a
  // PIN, and is what backs the reset panel in the Admin portal.
  if (action === 'roster') {
    const admin = await requireAdmin(req, res)
    if (!admin) return
    const roster = await Promise.all(STAFF.map(async s => ({
      name: s.name,
      email: s.email,
      isAdmin: !!s.isAdmin,
      hasTimesheets: !!s.hasTimesheets,
      hasPin: Boolean(await redis('get', `pin:${s.email}`))
    })))
    return res.status(200).json({ roster })
  }

  // Clearing a PIN sends that person back through first-time setup on their
  // next sign-in. Authenticated by admin session rather than by posting an
  // admin's own PIN in the request body.
  if (action === 'reset') {
    const admin = await requireAdmin(req, res)
    if (!admin) return
    const targetEmail = body.targetEmail
    if (!targetEmail) return res.status(400).json({ error: 'targetEmail required' })
    if (!STAFF.some(s => s.email === targetEmail)) {
      return res.status(404).json({ error: 'Staff member not found' })
    }
    await redis('del', `pin:${targetEmail}`)
    return res.status(200).json({ success: true, targetEmail })
  }

  // A locked-out staff member asking an admin to clear their PIN. Deliberately
  // grants nothing — it only sends an email — so it is safe to leave
  // unauthenticated, which it has to be: the person cannot sign in.
  if (action === 'request-reset') {
    if (!email) return res.status(400).json({ error: 'Email required' })
    const staff = STAFF.find(s => s.email === email)
    if (!staff) return res.status(404).json({ error: 'Staff member not found' })

    // One request per staff member per 10 minutes, so the button cannot be
    // used to spam the approvers.
    const cooldownKey = `pinreset:sent:${email}`
    if (await redis('get', cooldownKey)) {
      return res.status(200).json({ sent: true, alreadyRequested: true })
    }

    await sendPinResetRequestEmail(staff)
    await redis('set', cooldownKey, String(Date.now()), 'EX', '600')
    return res.status(200).json({ sent: true })
  }

  // ─── Passkeys: Face ID / Touch ID / device passcode ───────
  // Enrolment requires an existing session, so a passkey can only ever be
  // added by someone who already proved they know the PIN.

  if (action === 'passkey-available') {
    if (!email) return res.status(400).json({ error: 'Email required' })
    return res.status(200).json({ available: await hasPasskeys(email) })
  }

  if (action === 'passkey-register-options') {
    const session = await requireSession(req, res)
    if (!session) return
    const staff = STAFF.find(s => s.email === session.email)
    return res.status(200).json({ options: await beginRegistration(req, staff) })
  }

  if (action === 'passkey-register') {
    const session = await requireSession(req, res)
    if (!session) return
    const staff = STAFF.find(s => s.email === session.email)
    const saved = await finishRegistration(req, staff, body.response, body.label)
    return res.status(200).json({ success: true, passkey: saved })
  }

  if (action === 'passkey-list') {
    const session = await requireSession(req, res)
    if (!session) return
    return res.status(200).json({ passkeys: await listPasskeys(session.email) })
  }

  if (action === 'passkey-remove') {
    const session = await requireSession(req, res)
    if (!session) return
    if (body.credentialId) await removePasskey(session.email, body.credentialId)
    else await removeAllPasskeys(session.email)
    return res.status(200).json({ success: true, passkeys: await listPasskeys(session.email) })
  }

  if (action === 'passkey-login-options') {
    if (!email) return res.status(400).json({ error: 'Email required' })
    if (!STAFF.some(s => s.email === email)) return res.status(404).json({ error: 'Staff member not found' })
    return res.status(200).json({ options: await beginAuthentication(req, email) })
  }

  if (action === 'passkey-login') {
    if (!email) return res.status(400).json({ error: 'Email required' })
    const staff = STAFF.find(s => s.email === email)
    if (!staff) return res.status(404).json({ error: 'Staff member not found' })

    // A passkey proves the device and the person; it does not depend on the PIN
    // still being set, so it stands on its own as an authentication factor.
    await finishAuthentication(req, email, body.response)
    const { token, session } = await createSession(email)
    return res.status(200).json({
      valid: true, token, expiresIn: SESSION_TTL_SECONDS,
      name: session.name, isAdmin: session.isAdmin, staff
    })
  }

  if (action === 'logout') {
    await destroySession(body.token)
    return res.status(200).json({ success: true })
  }

  return res.status(400).json({ error: 'Invalid action' })
}
