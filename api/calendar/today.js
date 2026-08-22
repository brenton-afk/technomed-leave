import { getGoogleToken, getCalendarId, CALENDAR_SCOPE_READONLY } from '../_googleCalendar.js'
import { requireSession } from '../_auth.js'

// The Staff Leave sub-calendar. Read alongside bookings for the clinical plan
// so leave shows up in the week without a second round trip.
const LEAVE_CALENDAR_ID = process.env.GOOGLE_LEAVE_CALENDAR_ID
  || 'c_3221a8751df15d78f4d747cffc90ab6b78e3218d70151dfaaf22f639f2c95639@group.calendar.google.com'

// Google's API is queried with this zone; Hobart keeps the same wall clock.
const QUERY_TZ = 'Australia/Melbourne'

export default async function handler(req, res) {
  // ?action=week backs the Clinical Plan tab. It lives here rather than in its
  // own file because Vercel's Hobby plan caps a deployment at 12 serverless
  // functions and the app is at that ceiling — same reason the meetings, usage
  // and timesheet features are single functions routed by action.
  if (req.query.action === 'week') return handleWeek(req, res)

  try {
    const token = await getGoogleToken(CALENDAR_SCOPE_READONLY)
    const calendarId = getCalendarId()

    // The UI navigates a few weeks either side of today, so fetch a window
    // wide enough to cover it. Dates are anchored to AEST (UTC+10).
    const aestOffset = 10 * 60 * 60 * 1000
    const aestNow = new Date(Date.now() + aestOffset)

    const rangeStart = new Date(aestNow)
    rangeStart.setDate(rangeStart.getDate() - 7)
    rangeStart.setHours(0, 0, 0, 0)

    const rangeEnd = new Date(aestNow)
    rangeEnd.setDate(rangeEnd.getDate() + 28)
    rangeEnd.setHours(23, 59, 59, 999)

    const timeMin = new Date(rangeStart.getTime() - aestOffset).toISOString()
    const timeMax = new Date(rangeEnd.getTime() - aestOffset).toISOString()

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
      + `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`
      + '&singleEvents=true&orderBy=startTime&maxResults=500'

    const eventsRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const data = await eventsRes.json()
    if (data.error) throw new Error(data.error.message)

    const events = (data.items || []).map(e => ({
      id: e.id,
      title: e.summary || 'No title',
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      location: e.location || null,
      allDay: !e.start?.dateTime,
      colorId: e.colorId || null
    }))

    res.status(200).json({ events, today: aestNow.toISOString().split('T')[0] })
  } catch (err) {
    console.error('Calendar error:', err)
    res.status(500).json({ error: err.message })
  }
}

// ─── Clinical Plan: one week, both calendars ─────────────────
// Read-only. Returns raw events and lets the client derive the plan, so the
// view, the text copy and the .docx all come from one pure function.
async function handleWeek(req, res) {
  const session = await requireSession(req, res)
  if (!session) return

  const { start, end } = req.query
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) {
    return res.status(400).json({ error: 'start and end must be YYYY-MM-DD' })
  }

  try {
    const token = await getGoogleToken(CALENDAR_SCOPE_READONLY)
    // Hobart is +10/+11; the window is widened by a day either side and then
    // filtered client-side, so a DST shift cannot clip an edge event.
    const timeMin = `${start}T00:00:00+10:00`
    const timeMax = `${end}T23:59:59+11:00`

    const calendars = [
      { id: getCalendarId(), source: 'bookings' },
      { id: LEAVE_CALENDAR_ID, source: 'leave' }
    ]

    const results = await Promise.all(calendars.map(async cal => {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`
        + `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`
        + `&singleEvents=true&orderBy=startTime&maxResults=500`
        + `&timeZone=${encodeURIComponent(QUERY_TZ)}`
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      const data = await r.json()
      // A missing or unshared sub-calendar must not fail the whole week.
      if (data.error) return { source: cal.source, events: [], error: data.error.message }
      return {
        source: cal.source,
        events: (data.items || []).map(e => ({
          id: e.id, summary: e.summary || '', description: e.description || '',
          location: e.location || '', colorId: e.colorId || null,
          start: e.start, end: e.end, source: cal.source
        }))
      }
    }))

    const events = results.flatMap(r => r.events)
    const sourceErrors = results.filter(r => r.error).map(r => ({ source: r.source, error: r.error }))

    return res.status(200).json({
      events,
      window: { start, end },
      syncedAt: new Date().toISOString(),
      sourceErrors
    })
  } catch (err) {
    console.error('calendar/week failed:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
