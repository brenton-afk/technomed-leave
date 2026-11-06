import { getApplication, updateApplicationStatus, redisSetBody, redis } from '../_redis.js'
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

  // ── Send an approved application to Xero again ──
  // An approval goes through even when Xero refuses it (the calendar and the
  // email still happen), and until now the only way on was to key it into
  // Xero by hand. Once the cause is fixed in Xero, this sends it again. The
  // duplicate check in submitToXero still runs first, so it cannot be lodged
  // twice — leave already in Xero for those dates is reported, not added.
  if (action === 'xero-retry') {
    if (application.status !== 'approved') {
      return res.status(409).json({ error: 'Only approved leave goes to Xero' })
    }
    let xeroResult = null, xeroError = null
    try {
      xeroResult = await submitToXero(application)
    } catch (err) {
      xeroError = err.message
      console.error('Xero retry:', err.message)
    }
    await recordXero(application, xeroResult, xeroError, session)
    return res.status(200).json({ success: !xeroError, xeroResult, xeroError })
  }

  if (application.status !== 'pending') {
    return res.status(409).json({ error: `Application has already been ${application.status}` })
  }

  // Two admins (or one double tap) acting together both read "pending" before
  // either wrote, and the leave went to Xero and the calendar twice. Whoever
  // claims it first acts; the claim is let go if that fails before the status
  // changes, so it can be tried again.
  const claim = `leave:acting:${id}`
  if (await redis('set', claim, session.email, 'NX', 'EX', '120') !== 'OK') {
    return res.status(409).json({ error: 'Someone is already approving or declining this application.' })
  }
  try {
    return await decide()
  } catch (err) {
    await redis('del', claim).catch(() => {})
    throw err
  }

  async function decide() {

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
  // Kept on the record, so the Approved list can say which went to Xero and
  // offer to send the rest again.
  await recordXero(approved, xeroResult, xeroError, session).catch(() => {})

  try {
    calendarResult = await addCalendarEvent(approved)
    // Said out loud rather than silently. Falling back means the service
    // account cannot write to the Staff Leave calendar, and the consequence is
    // the duplicate entries this was changed to stop — the portal reads both
    // calendars, so leave written to the bookings one shows up twice. No names
    // in the line: it is a configuration fault, not a person's business.
    if (calendarResult?.fellBack) {
      console.warn('Calendar: leave fell back to the bookings calendar — '
        + 'it could not write to Staff Leave as bookings@. Add the scope '
        + 'https://www.googleapis.com/auth/calendar.events to the service '
        + 'account\'s domain-wide delegation to stop duplicate entries.')
    }
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
}

/** What Xero said about this application, stored on it. */
async function recordXero(application, result, error, session) {
  const xero = error
    ? { ok: false, error: String(error).slice(0, 500), at: new Date().toISOString(), by: session?.email || null }
    : { ok: true, id: result?.leaveApplicationID || null, at: new Date().toISOString(), by: session?.email || null }
  const fresh = (await getApplication(application.id)) || application
  await redisSetBody(`leave:${application.id}`, JSON.stringify({ ...fresh, xero }))
}
