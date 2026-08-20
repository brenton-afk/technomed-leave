// ─── Google Calendar Client ───────────────────────────────────────────────────
// Uses a Google Service Account to read and write events on the bookings
// calendar. Service-account JWTs are signed inline with node:crypto so the
// googleapis dependency is not needed.

const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'bookings@technomed.com.au'

export const CALENDAR_SCOPE_WRITE = 'https://www.googleapis.com/auth/calendar'
export const CALENDAR_SCOPE_READONLY = 'https://www.googleapis.com/auth/calendar.readonly'

// Google Calendar event colour ID 3 is Grape.
const GRAPE_COLOR_ID = '3'

const LEAVE_LABELS = {
  'ANNUAL_LEAVE': 'Annual Leave',
  'SICK': 'Personal Leave',
  'TOIL': 'TOIL'
}

export function getCalendarId() {
  return GOOGLE_CALENDAR_ID
}

// Mints a service-account access token for the requested scope. Shared by the
// write path here and the read path in api/calendar/today.js.
export async function getGoogleToken(scope = CALENDAR_SCOPE_WRITE) {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!serviceAccountJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not configured')

  let serviceAccount
  try {
    serviceAccount = JSON.parse(serviceAccountJson)
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON')
  }

  const now = Math.floor(Date.now() / 1000)
  const claim = {
    iss: serviceAccount.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }

  const { createSign } = await import('crypto')
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
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  })

  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) {
    throw new Error(`Google auth failed: ${tokenData.error_description || tokenData.error || 'unknown error'}`)
  }
  return tokenData.access_token
}

export async function addCalendarEvent({ name, division, startDate, endDate, leaveType, reason }) {
  const token = await getGoogleToken(CALENDAR_SCOPE_WRITE)

  // Google treats all-day event ends as exclusive, so shift past the last day.
  const endDateObj = new Date(`${endDate}T00:00:00Z`)
  endDateObj.setUTCDate(endDateObj.getUTCDate() + 1)
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
  if (result.error) throw new Error(result.error.message || 'Google Calendar error')

  return { eventId: result.id, eventLink: result.htmlLink }
}
