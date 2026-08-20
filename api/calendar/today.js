import { getGoogleToken, getCalendarId, CALENDAR_SCOPE_READONLY } from '../_googleCalendar.js'

export default async function handler(req, res) {
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
