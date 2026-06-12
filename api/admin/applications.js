import { getAllApplications } from '../_redis.js'

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Technoadmin2026'

export default async function handler(req, res) {
  const { password } = req.query
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' })
  }
  const applications = await getAllApplications()
  return res.status(200).json(applications)
}
