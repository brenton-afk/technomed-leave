import { submitToXero } from './_xeroClient.js'
import { addCalendarEvent } from './_googleCalendar.js'
import { sendNotificationEmail } from './_email.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { name, division, startDate, endDate, returnDate, leaveType, reason } = req.body

  // Validate required fields
  if (!name || !division || !startDate || !endDate || !returnDate || !leaveType || !reason) {
    return res.status(400).json({ error: 'All fields are required' })
  }

  const errors = []
  const results = {}

  // 1. Submit to Xero
  try {
    const xeroResult = await submitToXero({ name, startDate, endDate, leaveType, reason })
    results.xero = xeroResult
  } catch (err) {
    console.error('Xero error:', err.message)
    errors.push(`Xero: ${err.message}`)
  }

  // 2. Add Google Calendar event
  try {
    const calResult = await addCalendarEvent({ name, division, startDate, endDate, returnDate, leaveType, reason })
    results.calendar = calResult
  } catch (err) {
    console.error('Calendar error:', err.message)
    errors.push(`Calendar: ${err.message}`)
  }

  // 3. Send notification email
  try {
    const emailResult = await sendNotificationEmail({ name, division, startDate, endDate, returnDate, leaveType, reason })
    results.email = emailResult
  } catch (err) {
    console.error('Email error:', err.message)
    errors.push(`Email: ${err.message}`)
  }

  if (errors.length === 3) {
    // All three failed — return error
    return res.status(500).json({ error: 'All integrations failed. Please contact IT support.', details: errors })
  }

  // Partial or full success
  return res.status(200).json({
    success: true,
    results,
    warnings: errors.length > 0 ? errors : undefined
  })
}
