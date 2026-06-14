import { getApplication, updateApplicationStatus } from '../_redis.js'
import { submitToXero } from '../_xeroClient.js'
import { addCalendarEvent } from '../_googleCalendar.js'
import { sendApprovalEmail, sendDeclineEmail } from '../_email.js'

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Technoadmin2026'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { id, action, password, declineReason } = req.body

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' })
  }

  const application = await getApplication(id)
  if (!application) {
    return res.status(404).json({ error: 'Application not found' })
  }

  if (action === 'decline') {
    await updateApplicationStatus(id, 'declined', declineReason)
    try { await sendDeclineEmail(application, declineReason) } catch (err) { console.error(err) }
    return res.status(200).json({ success: true, status: 'declined' })
  }

  await updateApplicationStatus(id, 'approved')

  let xeroResult = null; let xeroError = null; try { xeroResult = await submitToXero(application) } catch (err) { xeroError = err.message }
  try { await addCalendarEvent(application) } catch (err) { console.error('Calendar:', err.message) }
  try { await sendApprovalEmail(application) } catch (err) { console.error('Email:', err.message) }

  return res.status(200).json({ success: true, status: 'approved', xeroResult, xeroError })
}
