import { getAllApplications } from '../_redis.js'
import { requireAdmin } from '../_auth.js'
import { readEmailLog } from '../_emailLog.js'

export default async function handler(req, res) {
  const session = await requireAdmin(req, res)
  if (!session) return

  try {
    // A record of every email the portal has sent, successes and failures
    // alike. Routed here rather than in a function of its own: Vercel counts
    // functions, and this is already the admin read endpoint.
    if (req.query.action === 'email-log') {
      const entries = await readEmailLog({ limit: 200 })
      return res.status(200).json({ entries })
    }

    const applications = await getAllApplications()
    return res.status(200).json(applications)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
