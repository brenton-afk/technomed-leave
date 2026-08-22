import { getGoogleToken, getCalendarId, CALENDAR_SCOPE_READONLY } from '../_googleCalendar.js'
import { requireSession } from '../_auth.js'

// The Staff Leave sub-calendar. Read alongside bookings for the clinical plan
// so leave shows up in the week without a second round trip.
const LEAVE_CALENDAR_ID = process.env.GOOGLE_LEAVE_CALENDAR_ID
  || 'c_3221a8751df15d78f4d747cffc90ab6b78e3218d70151dfaaf22f639f2c95639@group.calendar.google.com'

// Google's API is queried with this zone; Hobart keeps the same wall clock.
const QUERY_TZ = 'Australia/Melbourne'

export default async function handler(req, res) {
  // The case plan polls this so the app tracks the calendar as it is edited. A
  // cached response would make those edits invisible for as long as the cache
  // lived, which is the one thing the polling exists to prevent.
  res.setHeader('Cache-Control', 'no-store, max-age=0')
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

    // The window used to be -7/+28 days, which meant a booking more than four
    // weeks out was invisible in the app while sitting on the calendar — and
    // gave no hint that anything had been cut off. Overridable per request so a
    // caller can ask for exactly what it needs.
    const daysBack = Math.min(Math.max(parseInt(req.query.back || '14', 10) || 14, 0), 90)
    const daysForward = Math.min(Math.max(parseInt(req.query.forward || '120', 10) || 120, 1), 400)

    const rangeStart = new Date(aestNow)
    rangeStart.setDate(rangeStart.getDate() - daysBack)
    rangeStart.setHours(0, 0, 0, 0)

    const rangeEnd = new Date(aestNow)
    rangeEnd.setDate(rangeEnd.getDate() + daysForward)
    rangeEnd.setHours(23, 59, 59, 999)

    const timeMin = new Date(rangeStart.getTime() - aestOffset).toISOString()
    const timeMax = new Date(rangeEnd.getTime() - aestOffset).toISOString()

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
      + `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`
      + '&singleEvents=true&orderBy=startTime&maxResults=2500'

    const eventsRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const data = await eventsRes.json()
    if (data.error) throw new Error(data.error.message)

    const events = (data.items || []).map(e => ({
      id: e.id,
      title: e.summary || 'No title',
      // The day view reads the system and supply out of this. Without it the only
      // thing it could show was the title exactly as typed.
      description: e.description || '',
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      location: e.location || null,
      allDay: !e.start?.dateTime,
      colorId: e.colorId || null
    }))

    res.status(200).json({
      events,
      today: aestNow.toISOString().split('T')[0],
      window: { from: timeMin, to: timeMax, daysBack, daysForward },
      // If Google paginated, say so rather than quietly returning a partial week.
      truncated: Boolean(data.nextPageToken)
    })
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
    // Hobart is +10 (AEST) or +11 (AEDT). Widening by a day either side and
    // letting the client filter is safe; mixing the two offsets was not — a
    // +11:00 timeMax on an AEST week excluded the last hour of Sunday.
    const timeMin = `${start}T00:00:00+11:00`
    const timeMax = `${end}T23:59:59+10:00`

    const calendars = [
      { id: getCalendarId(), source: 'bookings' },
      { id: LEAVE_CALENDAR_ID, source: 'leave' }
    ]

    const results = await Promise.all(calendars.map(async cal => {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`
        + `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`
        + `&singleEvents=true&orderBy=startTime&maxResults=2500`
        + `&timeZone=${encodeURIComponent(QUERY_TZ)}`
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      const data = await r.json()
      // A missing or unshared sub-calendar must not fail the whole week.
      if (data.error) return { source: cal.source, events: [], error: data.error.message }
      return {
        source: cal.source,
        truncated: Boolean(data.nextPageToken),
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
      window: { start, end, timeMin, timeMax },
      syncedAt: new Date().toISOString(),
      sourceErrors,
      truncated: results.some(r => r.truncated)
    })
  } catch (err) {
    console.error('calendar/week failed:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
