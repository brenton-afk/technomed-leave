import { getApplication, updateApplicationStatus } from '../_redis.js'
import { requireAdmin } from '../_auth.js'
import { submitToXero } from '../_xeroClient.js'
import { addCalendarEvent } from '../_googleCalendar.js'
import { sendApprovalEmail, sendDeclineEmail } from '../_email.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const session = await requireAdmin(req, res)
  if (!session) return

  const { id, action, declineReason } = req.body

  const application = await getApplication(id)
  if (!application) {
    return res.status(404).json({ error: 'Application not found' })
  }
  if (application.status !== 'pending') {
    return res.status(409).json({ error: `Application has already been ${application.status}` })
  }

  if (action === 'decline') {
    if (!declineReason?.trim()) {
      return res.status(400).json({ error: 'A decline reason is required' })
    }
    const declined = await updateApplicationStatus(id, 'declined', declineReason)
    let emailError = null
    try {
      await sendDeclineEmail(declined, declineReason)
    } catch (err) {
      emailError = err.message
      console.error('Decline email:', err.message)
    }
    return res.status(200).json({ success: true, status: 'declined', emailError })
  }

  if (action !== 'approve') {
    return res.status(400).json({ error: 'Invalid action' })
  }

  const approved = await updateApplicationStatus(id, 'approved')

  // The three downstream integrations are independent: a failure in any one of
  // them must not roll back the approval or block the others. Errors come back
  // in the response so the admin sees them instead of only the server log.
  let xeroResult = null, xeroError = null
  let calendarResult = null, calendarError = null
  let emailError = null

  try {
    xeroResult = await submitToXero(approved)
  } catch (err) {
    xeroError = err.message
    console.error('Xero:', err.message)
  }

  try {
    calendarResult = await addCalendarEvent(approved)
  } catch (err) {
    calendarError = err.message
    console.error('Calendar:', err.message)
  }

  try {
    await sendApprovalEmail(approved)
  } catch (err) {
    emailError = err.message
    console.error('Email:', err.message)
  }

  return res.status(200).json({
    success: true,
    status: 'approved',
    xeroResult,
    xeroError,
    calendarResult,
    calendarError,
    emailError
  })
}
