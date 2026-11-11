import { getApplication, updateApplicationStatus, redisSetBody, redis } from '../_redis.js'
import { requireAdmin } from '../_auth.js'
import { submitToXero } from '../_xeroClient.js'
import { amendXeroLeave } from '../_xeroClient.js'
import { addCalendarEvent, updateLeaveEvent } from '../_googleCalendar.js'
import { sendApprovalEmail, sendDeclineEmail, sendLeaveAmendedEmail } from '../_email.js'
import { cleanLeaveHours, totalHours } from '../../src/leaveHours.js'
import { STAFF } from '../../src/staffConfig.js'

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

  // ── Amend: new dates or hours (Brent, 11 Nov 2026) ──
  if (action === 'amend') return amend(req, res, application, session)

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
    // Kept, so an amendment later moves this entry rather than adding another.
    if (calendarResult?.eventId) {
      const fresh = (await getApplication(id)) || approved
      await redisSetBody(`leave:${id}`, JSON.stringify({ ...fresh, calendar: { eventId: calendarResult.eventId, calendarId: calendarResult.calendarId } })).catch(() => {})
    }
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

// ─── Amending leave (Brent, 11 Nov 2026) ─────────────────────────────────────
// "Aimee wants to amend her annual leave application to 10.5 hours for this
// fortnight." An admin changes the dates, the hours for each day, or the type,
// on an application that is pending or approved. Always in hours, so Xero is
// told exactly what to pay. On approved leave the same Xero application is
// changed (not a second one), the calendar entry is moved, and the staff
// member is emailed what changed. The portal's record is what TOIL reads, so
// the fortnight's TOIL split follows by itself. Each part is tried on its own;
// what failed comes back to the screen, as with an approval.
const TYPES = ['ANNUAL_LEAVE', 'SICK', 'TOIL']
const DAY = /^\d{4}-\d{2}-\d{2}$/
const realDay = d => DAY.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d

async function amend(req, res, application, session) {
  if (!['pending', 'approved'].includes(application.status)) {
    return res.status(409).json({ error: `A ${application.status} application cannot be amended` })
  }
  const { startDate, endDate, returnDate, leaveType = application.leaveType, hours, note } = req.body || {}
  if (![startDate, endDate, returnDate].every(realDay)) return res.status(400).json({ error: 'Dates must be real days' })
  if (endDate < startDate) return res.status(400).json({ error: 'The last day cannot be before the first' })
  if (returnDate <= endDate) return res.status(400).json({ error: 'The return date must be after the last day' })
  if (!TYPES.includes(leaveType)) return res.status(400).json({ error: 'Unknown leave type' })
  let cleanHours
  try { cleanHours = cleanLeaveHours(hours, { startDate, endDate }) } catch (err) { return res.status(400).json({ error: err.message }) }

  const claim = `leave:acting:${application.id}`
  if (await redis('set', claim, session.email, 'NX', 'EX', '120') !== 'OK') {
    return res.status(409).json({ error: 'Someone is already changing this application.' })
  }
  try {
    const by = STAFF.find(s => s.email === session.email)?.firstName || session.email
    const was = { startDate: application.startDate, endDate: application.endDate, returnDate: application.returnDate,
      leaveType: application.leaveType, totalHours: application.totalHours || null }
    const fresh = (await getApplication(application.id)) || application
    const next = {
      ...fresh, startDate, endDate, returnDate, leaveType,
      hours: cleanHours, totalHours: totalHours(cleanHours),
      amendments: [...(fresh.amendments || []), { at: new Date().toISOString(), by, was, note: String(note || '').slice(0, 300) }]
    }
    await redisSetBody(`leave:${application.id}`, JSON.stringify(next))

    const fmt = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    const change = [
      (was.startDate !== startDate || was.endDate !== endDate) && `dates ${fmt(was.startDate)}–${fmt(was.endDate)} → ${fmt(startDate)}–${fmt(endDate)}`,
      `${was.totalHours ? `${was.totalHours}h` : 'full days'} → ${next.totalHours}h`,
      was.leaveType !== leaveType && `type changed`,
      `by ${by}`
    ].filter(Boolean).join('; ')

    let xeroError = null, xeroResult = null, calendarError = null, calendarResult = null, emailError = null
    if (application.status === 'approved') {
      if (fresh.xero?.ok && fresh.xero.id) {
        try {
          xeroResult = await amendXeroLeave({ leaveApplicationID: fresh.xero.id, name: next.name, leaveType, reason: next.reason, hours: cleanHours })
        } catch (err) { xeroError = err.message }
      } else {
        xeroError = 'This leave is not in Xero from the portal — use "Send to Xero again", which now sends the amended hours.'
      }
      try {
        calendarResult = await updateLeaveEvent(fresh, next)
        if (calendarResult.updated) {
          const latest = (await getApplication(application.id)) || next
          await redisSetBody(`leave:${application.id}`, JSON.stringify({ ...latest, calendar: { eventId: calendarResult.eventId, calendarId: calendarResult.calendarId } }))
        } else calendarError = 'The calendar entry could not be found — change it in Google Calendar by hand.'
      } catch (err) { calendarError = err.message }
    }
    try { await sendLeaveAmendedEmail(next, change) } catch (err) { emailError = err.message }
    return res.status(200).json({ success: true, application: next, change, xeroResult, xeroError, calendarResult, calendarError, emailError })
  } finally {
    await redis('del', claim).catch(() => {})
  }
}
