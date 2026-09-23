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
/**
 * A Google access token for the service account.
 *
 * `impersonate` adds the `sub` claim, which makes the token act as that user
 * instead of as the service account itself. It is needed for Gmail and for
 * nothing else here: a service account owns no mailbox, so reading
 * bookings@technomed.com.au means acting as it.
 *
 * This requires domain-wide delegation to be granted in the Workspace admin
 * console — the service account's client ID authorised for the Gmail scope. It
 * is a deliberate, auditable grant and it is not something the code can arrange
 * for itself. Without it Google refuses the token with `unauthorized_client`,
 * which is reported as such rather than as a mysterious failure.
 */
export async function getGoogleToken(scope = CALENDAR_SCOPE_WRITE, { impersonate } = {}) {
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
    iat: now,
    ...(impersonate ? { sub: impersonate } : {})
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
    // Impersonation refused means domain-wide delegation has not been granted
    // for this scope. Google says so as "unauthorized_client", which tells
    // nobody what to do about it — so say what to do, and include the client ID
    // the admin console asks for rather than sending somebody to dig it out of
    // the service-account JSON.
    const refused = /unauthorized_client|not authorized for any of the scopes/i
    if (impersonate && refused.test(`${tokenData.error} ${tokenData.error_description}`)) {
      throw Object.assign(new Error(
        `The app is not yet allowed to act as ${impersonate}.\n\n`
        + 'In Google Workspace admin → Security → Access and data control → '
        + 'API controls → Domain-wide delegation, add:\n\n'
        + `Client ID: ${serviceAccount.client_id}\n`
        + `Scope: ${scope}\n\n`
        + 'Then try again — it can take a few minutes to take effect.'),
        { code: 'delegation' })
    }
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

// ─── Marking who attended a case ──────────────────────────────────────────────

/** `(Brent)` — the form the team already writes by hand. */
function attendanceTag(firstName) {
  const name = String(firstName || '').trim()
  return name ? `(${name})` : ''
}

/**
 * Appends the rep's first name to a booking's title, to record that they were
 * there.
 *
 * Strictly additive, and that is the whole design. This writes to the shared
 * bookings calendar, which is the team's source of truth and is edited by hand by
 * people who are not looking at this app — so the title is never rewritten into a
 * tidier format, never reordered, and nothing is removed. Only ` (Brent)` is put
 * on the end of whatever is already there.
 *
 * It also refuses to guess. A day with two bookings for the same surname gets left
 * alone and says so, because appending the wrong rep to the wrong case is worse
 * than appending nothing and is not visible until someone reads the calendar
 * weeks later.
 *
 * @returns {{updated: boolean, reason?: string, title?: string}}
 */
export async function markAttendance({ date, patientSurname, firstName }) {
  const tag = attendanceTag(firstName)
  const surname = String(patientSurname || '').trim()
  if (!tag) return { updated: false, reason: 'no first name for this staff member' }
  if (!surname || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    return { updated: false, reason: 'no surname or date to match a booking on' }
  }

  const calendarId = getCalendarId()
  if (!calendarId) return { updated: false, reason: 'no bookings calendar configured' }

  const token = await getGoogleToken(CALENDAR_SCOPE_WRITE)
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`

  // The whole Hobart day, in the offsets either side of it, so a booking cannot
  // fall outside the window because of a timezone.
  const params = new URLSearchParams({
    timeMin: `${date}T00:00:00+11:00`,
    timeMax: `${date}T23:59:59+10:00`,
    singleEvents: 'true',
    maxResults: '250'
  })
  const listed = await fetch(`${base}?${params}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!listed.ok) return { updated: false, reason: `could not read the calendar (${listed.status})` }

  const events = (await listed.json()).items || []
  const lower = surname.toLowerCase()
  const matches = events.filter(e => String(e.summary || '').toLowerCase().includes(lower))

  if (matches.length === 0) return { updated: false, reason: `no booking on ${date} mentions ${surname}` }
  if (matches.length > 1) {
    return { updated: false, reason: `${matches.length} bookings on ${date} mention ${surname}, so none was changed` }
  }

  const event = matches[0]
  const summary = String(event.summary || '')
  // Idempotent: scanning a second page, or re-saving, must not produce
  // "(Brent) (Brent)".
  if (summary.includes(tag)) return { updated: false, reason: 'already recorded', title: summary }

  const title = `${summary} ${tag}`.replace(/\s+/g, ' ').trim()
  const patched = await fetch(`${base}/${encodeURIComponent(event.id)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: title })
  })
  if (!patched.ok) {
    const detail = await patched.text()
    return { updated: false, reason: `could not update the booking (${patched.status}): ${detail.slice(0, 160)}` }
  }
  return { updated: true, title }
}


/**
 * Amends one booking, and refuses if it changed underneath you.
 *
 * `etag` is Google's version marker for the event. Sending it as If-Match means
 * the write is rejected with a 412 when somebody else has edited since the
 * portal loaded it — which on this calendar is a normal Tuesday, not an edge
 * case. Without it the last save silently wins and the other person's change is
 * gone with no trace that it existed.
 *
 * Only the fields passed are sent. Google's PATCH leaves the rest alone, which
 * matters for the things the app does not model — attendees, reminders,
 * recurrence, the colour somebody set by hand.
 */
export async function updateCalendarEvent(eventId, patch, { etag } = {}) {
  const token = await getGoogleToken(CALENDAR_SCOPE_WRITE)
  const calendarId = getCalendarId()
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`
    + `/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(etag ? { 'If-Match': etag } : {})
      },
      body: JSON.stringify(patch)
    })

  if (res.status === 412) {
    const conflict = new Error('This booking changed in Google while you had it open')
    conflict.code = 'conflict'
    throw conflict
  }
  if (!res.ok) {
    throw new Error(`Calendar update failed (${res.status}): ${await res.text()}`)
  }
  return res.json()
}

/** One booking, fresh, for reloading after a conflict. */
export async function getCalendarEvent(eventId) {
  const token = await getGoogleToken(CALENDAR_SCOPE_READONLY)
  const calendarId = getCalendarId()
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`
    + `/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Could not read the booking (${res.status})`)
  return res.json()
}


/**
 * A new booking on the bookings calendar.
 *
 * Created spanning the theatre list rather than at a point in time. Case timings
 * are not settled until the list order lands the evening before and then move
 * several times a day, so a start time entered at booking is wrong almost
 * immediately — and the RHH lists themselves read "List duration 08:00am to
 * 5:00pm, All Day List", which is what this reproduces.
 *
 * Not an all-day event, which would be the obvious way to express "no time":
 * the week plan skips all-day entries when looking for cases, so an all-day
 * booking would vanish from the very screen it was created on.
 */
export async function createBookingEvent({ summary, description, date, colorId, location }) {
  const token = await getGoogleToken(CALENDAR_SCOPE_WRITE)
  const calendarId = getCalendarId()

  const body = {
    summary,
    description,
    start: { dateTime: `${date}T08:00:00`, timeZone: BOOKING_TZ },
    end: { dateTime: `${date}T17:00:00`, timeZone: BOOKING_TZ }
  }
  if (colorId) body.colorId = String(colorId)
  if (location) body.location = location

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

  if (!res.ok) throw new Error(`Could not create the booking (${res.status}): ${await res.text()}`)
  return res.json()
}

const BOOKING_TZ = 'Australia/Hobart'


/** Removes a booking. Guarded by the same version marker as an edit. */
export async function deleteCalendarEvent(eventId, { etag } = {}) {
  const token = await getGoogleToken(CALENDAR_SCOPE_WRITE)
  const calendarId = getCalendarId()
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`
    + `/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(etag ? { 'If-Match': etag } : {})
      }
    })
  if (res.status === 412) {
    const conflict = new Error('This booking changed in Google while you had it open')
    conflict.code = 'conflict'
    throw conflict
  }
  // 410 is already gone, which is the outcome asked for.
  if (!res.ok && res.status !== 410) {
    throw new Error(`Could not delete the booking (${res.status}): ${await res.text()}`)
  }
  return { ok: true }
}
