import { getAllApplications } from '../_redis.js'
import { requireAdmin } from '../_auth.js'

export default async function handler(req, res) {
  const session = await requireAdmin(req, res)
  if (!session) return

  try {
    const applications = await getAllApplications()
    return res.status(200).json(applications)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
