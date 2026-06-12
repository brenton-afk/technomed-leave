import { saveApplication } from './_redis.js'
import { sendNotificationEmail } from './_email.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { name, division, startDate, endDate, returnDate, leaveType, reason } = req.body

  if (!name || !division || !startDate || !endDate || !returnDate || !leaveType || !reason) {
    return res.status(400).json({ error: 'All fields are required' })
  }

  const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

  const application = {
    id,
    name,
    division,
    startDate,
    endDate,
    returnDate,
    leaveType,
    reason,
    status: 'pending',
    submittedAt: new Date().toISOString()
  }

  await saveApplication(id, application)

  try {
    await sendNotificationEmail(application, { pendingApproval: true })
  } catch (err) {
    console.error('Email error:', err.message)
  }

  return res.status(200).json({ success: true, id })
}
