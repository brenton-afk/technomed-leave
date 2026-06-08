// ─── Google Calendar Client ───────────────────────────────────────────────────
// Uses a Google Service Account to write events to bookings@technomed.com.au
// Calendar colour: Grape (#8E24AA) — Google Calendar colorId 9

const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'bookings@technomed.com.au'

// Google Calendar colour ID for Grape
const GRAPE_COLOR_ID = '9'

const LEAVE_LABELS = {
  'ANNUAL_LEAVE': 'Annual Leave',
  'SICK': 'Personal Leave',
  'TOIL': 'TOIL'
}

async function getGoogleToken() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!serviceAccountJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not configured')

  const serviceAccount = JSON.parse(serviceAccountJson)

  // Create JWT for Google OAuth
  const now = Math.floor(Date.now() / 1000)
  const claim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }

  // Sign JWT with service account private key
  const { createSign } = await import('crypto')

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claim)).toString('base64url')
  const signingInput = `${header}.${payload}`

  const sign = createSign('RSA-SHA256')
  sign.update(signingInput)
  const signature = sign.sign(serviceAccount.private_key, 'base64url')
  const jwt = `${signingInput}.${signature}`

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  })

  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) {
    throw new Error(`Google auth failed: ${tokenData.error_description || 'Unknown'}`)
  }
  return tokenData.access_token
}

export async function addCalendarEvent({ name, division, startDate, endDate, leaveType, reason }) {
  const token = await getGoogleToken()

  // Calendar events need end date to be day AFTER last day (Google's convention)
  const endDateObj = new Date(endDate)
  endDateObj.setDate(endDateObj.getDate() + 1)
  const endDateStr = endDateObj.toISOString().split('T')[0]

  const leaveLabel = LEAVE_LABELS[leaveType] || leaveType

  const event = {
    summary: `${name} — ${leaveLabel}`,
    description: [
      `Employee: ${name}`,
      `Division: ${division}`,
      `Leave type: ${leaveLabel}`,
      `Reason: ${reason}`,
      '',
      'Submitted via TechnoMed Leave Portal'
    ].join('\n'),
    start: { date: startDate },
    end: { date: endDateStr },
    colorId: GRAPE_COLOR_ID,
    transparency: 'transparent'
  }

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(event)
    }
  )

  const result = await res.json()

  if (result.error) {
    throw new Error(result.error.message || 'Google Calendar error')
  }

  return { eventId: result.id, eventLink: result.htmlLink }
}
