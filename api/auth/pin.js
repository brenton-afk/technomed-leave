import { STAFF } from '../../src/staffConfig.js'

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

async function redis(command, ...args) {
  const res = await fetch(`${REDIS_URL}/${command}/${args.map(a => encodeURIComponent(a)).join('/')}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  })
  const data = await res.json()
  return data.result
}

export default async function handler(req, res) {
  const body = req.method === 'POST' ? req.body : req.query
  const { action, email, pin, newPin } = body

  if (action === 'verify') {
    if (!email || !pin) return res.status(400).json({ error: 'Email and PIN required' })
    const stored = await redis('get', `pin:${email}`)
    if (!stored) return res.status(200).json({ valid: false, needsSetup: true })
    if (stored !== pin) return res.status(200).json({ valid: false })
    const staff = STAFF.find(s => s.email === email)
    return res.status(200).json({ valid: true, isAdmin: staff?.isAdmin || false, name: staff?.name, staff })
  }

  if (action === 'set') {
    if (!email || !newPin) return res.status(400).json({ error: 'Email and PIN required' })
    if (!/^\d{4}$/.test(newPin)) return res.status(400).json({ error: 'PIN must be 4 digits' })
    const staff = STAFF.find(s => s.email === email)
    if (!staff) return res.status(404).json({ error: 'Staff member not found' })
    await redis('set', `pin:${email}`, newPin)
    return res.status(200).json({ success: true, name: staff.name, isAdmin: staff.isAdmin })
  }

  if (action === 'check') {
    if (!email) return res.status(400).json({ error: 'Email required' })
    const stored = await redis('get', `pin:${email}`)
    return res.status(200).json({ hasPin: !!stored })
  }

  if (action === 'reset') {
    const { adminEmail, adminPin, targetEmail } = body
    const storedAdmin = await redis('get', `pin:${adminEmail}`)
    if (storedAdmin !== adminPin) return res.status(401).json({ error: 'Invalid admin credentials' })
    const adminStaff = STAFF.find(s => s.email === adminEmail)
    if (!adminStaff?.isAdmin) return res.status(403).json({ error: 'Not authorised' })
    await redis('del', `pin:${targetEmail}`)
    return res.status(200).json({ success: true })
  }

  return res.status(400).json({ error: 'Invalid action' })
}
