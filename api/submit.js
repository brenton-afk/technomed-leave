import { saveApplication } from './_redis.js'
import { sendNotificationEmail } from './_email.js'
import { getStaffByName } from '../src/staffConfig.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { name, division, startDate, endDate, returnDate, leaveType, reason, email } = req.body

  if (!name || !division || !startDate || !endDate || !returnDate || !leaveType || !reason) {
    return res.status(400).json({ error: 'All fields are required' })
  }

  if (!['ANNUAL_LEAVE', 'SICK', 'TOIL'].includes(leaveType)) {
    return res.status(400).json({ error: 'Unknown leave type' })
  }

  if (endDate < startDate) {
    return res.status(400).json({ error: 'Last day must not be before the first day' })
  }
  if (returnDate <= endDate) {
    return res.status(400).json({ error: 'Return date must be after the last day of leave' })
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`

  const application = {
    id,
    name,
    // Persisted so approval and decline emails can reach the employee.
    email: email || getStaffByName(name)?.email || null,
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

  let emailError = null
  try {
    await sendNotificationEmail(application)
  } catch (err) {
    emailError = err.message
    console.error('Email error:', err.message)
  }

  return res.status(200).json({ success: true, id, emailError })
}
