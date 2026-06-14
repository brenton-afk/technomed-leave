async function getGoogleToken() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!serviceAccountJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not configured')
  const serviceAccount = JSON.parse(serviceAccountJson)
  const { createSign } = await import('crypto')
  const now = Math.floor(Date.now() / 1000)
  const claim = { iss: serviceAccount.client_email, scope: 'https://www.googleapis.com/auth/calendar.readonly', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now }
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claim)).toString('base64url')
  const signingInput = `${header}.${payload}`
  const sign = createSign('RSA-SHA256')
  sign.update(signingInput)
  const signature = sign.sign(serviceAccount.private_key, 'base64url')
  const jwt = `${signingInput}.${signature}`
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) throw new Error('Google auth failed: ' + JSON.stringify(tokenData))
  return tokenData.access_token
}

export default async function handler(req, res) {
  try {
    const token = await getGoogleToken()
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'bookings@technomed.com.au'

    // Get date range — default 4 weeks centred on today, or use query params
    const aestOffset = 10 * 60 * 60 * 1000
    const now = new Date()
    const aestNow = new Date(now.getTime() + aestOffset)

    // Start from 7 days ago, end 28 days from now to cover any week navigation
    const rangeStart = new Date(aestNow)
    rangeStart.setDate(rangeStart.getDate() - 7)
    rangeStart.setHours(0, 0, 0, 0)

    const rangeEnd = new Date(aestNow)
    rangeEnd.setDate(rangeEnd.getDate() + 28)
    rangeEnd.setHours(23, 59, 59, 999)

    const timeMin = new Date(rangeStart.getTime() - aestOffset).toISOString()
    const timeMax = new Date(rangeEnd.getTime() - aestOffset).toISOString()

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=500`

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
