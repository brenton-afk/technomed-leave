import { STAFF } from '../../src/staffConfig.js'
import { redis } from '../_redis.js'
import { createSession, destroySession, SESSION_TTL_SECONDS } from '../_auth.js'

export default async function handler(req, res) {
  const body = req.method === 'POST' ? req.body : req.query
  const { action, email, pin, newPin } = body

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

  if (action === 'reset') {
    const { adminEmail, adminPin, targetEmail } = body
    if (!adminEmail || !adminPin || !targetEmail) {
      return res.status(400).json({ error: 'adminEmail, adminPin and targetEmail required' })
    }
    const storedAdmin = await redis('get', `pin:${adminEmail}`)
    if (!storedAdmin || storedAdmin !== adminPin) {
      return res.status(401).json({ error: 'Invalid admin credentials' })
    }
    const adminStaff = STAFF.find(s => s.email === adminEmail)
    if (!adminStaff?.isAdmin) return res.status(403).json({ error: 'Not authorised' })
    await redis('del', `pin:${targetEmail}`)
    return res.status(200).json({ success: true })
  }

  if (action === 'logout') {
    await destroySession(body.token)
    return res.status(200).json({ success: true })
  }

  return res.status(400).json({ error: 'Invalid action' })
}
