import { saveApplication } from './_redis.js'
import { sendNotificationEmail } from './_email.js'
import { getStaffByEmail } from '../src/staffConfig.js'
import { requireSession } from './_auth.js'

// ─── Filing a leave application ──────────────────────────────────────────────
// This had no session check at all. Anyone who knew the URL could post one, and
// the name came out of the request body — so a leave application could be filed
// in a staff member's name by somebody who had never signed in, and it would
// arrive looking exactly like the real thing.
//
// Two changes, and the second matters more than the first. Requiring a session
// stops a stranger. Taking the employee from that session rather than from the
// body stops everybody else: the form never let anyone type a name anyway — it
// shows the person who is signed in — so nothing is lost by refusing to believe
// the body, and a signed-in colleague can no longer book someone else's leave.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const session = await requireSession(req, res)
  if (!session) return

  const { division, startDate, endDate, returnDate, leaveType, reason } = req.body || {}

  // Whose leave this is, decided here and not by the caller.
  const staff = getStaffByEmail(session.email)
  const name = staff?.name
  const email = staff?.email || session.email
  if (!name) return res.status(403).json({ error: 'Not authorised' })

  if (!division || !startDate || !endDate || !returnDate || !leaveType || !reason) {
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
    // Persisted so approval and decline emails can reach the employee. From the
    // session, so the address a decision is sent to cannot be chosen by whoever
    // filed the application.
    email,
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
