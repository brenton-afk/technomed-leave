// ─── Google Calendar Client ───────────────────────────────────────────────────
// Uses a Google Service Account to read and write events on the bookings
// calendar. Service-account JWTs are signed inline with node:crypto so the
// googleapis dependency is not needed.

import { readBooking, plainDescription } from '../src/clinicalPlan/parse.js'
import { redis } from './_redis.js'

const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'bookings@technomed.com.au'

export const CALENDAR_SCOPE_WRITE = 'https://www.googleapis.com/auth/calendar'
// The narrower scope used when acting as bookings@ (domain-wide delegation):
// events only, not calendar settings or sharing.
export const CALENDAR_SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events'
// Staff Leave — "Calendar for TechnoMed Team's Approved Annual/Personal Leave",
// owned by bookings@. GOOGLE_LEAVE_CALENDAR_ID overrides it.
export const STAFF_LEAVE_CALENDAR_ID = 'c_3221a8751df15d78f4d747cffc90ab6b78e3218d70151dfaaf22f639f2c95639@group.calendar.google.com'
const CALENDAR_OWNER = process.env.BOOKINGS_MAILBOX || 'bookings@technomed.com.au'
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
/**
 * The address a calendar has to be shared with for the app to read it.
 *
 * Returned so a failure can name it. "Share it with the service account" sends
 * somebody hunting through a JSON blob in Vercel's settings; the address itself
 * is one paste into Google Calendar's sharing box.
 */
export function serviceAccountEmail() {
  try {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}').client_email || ''
  } catch {
    return ''
  }
}

// ─── Google sign-in, kept for its hour (Brent, 11 Nov 2026: "loading times in
// the booking … phone battery being drained") ───────────────────────────────
// Every request used to sign a fresh token and wait on Google's token server
// before it could ask for a single event — a few hundred milliseconds on every
// week load, every booking opened, every save. A token lasts an hour; it is
// now kept in the instance's memory and in Redis (so a cold instance does not
// have to sign again) until five minutes before it runs out.
const TOKEN_MARGIN_S = 300
const memoryTokens = new Map()
const tokenCacheOn = () => !process.env.VITEST || process.env.GOOGLE_TOKEN_CACHE === 'on'
const tokenKey = (scope, impersonate) => `google:token:${impersonate || 'sa'}:${scope}`

/** Forget kept tokens — for the tests, and after Google refuses one. */
export function forgetGoogleTokens() { memoryTokens.clear() }

// ─── The calendar's version (Brent, 11 Nov 2026: speed) ──────────────────────
// Bumped after every write the portal makes to Google, so the shared copy of
// the week (`handleWeek` in api/calendar/today.js) is never served after the
// portal itself has changed a booking. Fire and forget: a failed bump costs at
// most the twenty seconds the copy lives.
export const CAL_VERSION_KEY = 'cal:version'
export function calendarChanged() {
  redis('incr', CAL_VERSION_KEY).catch(() => {})
}

export async function getGoogleToken(scope = CALENDAR_SCOPE_WRITE, { impersonate } = {}) {
  if (!tokenCacheOn()) return signGoogleToken(scope, { impersonate })
  const key = tokenKey(scope, impersonate)
  const now = Math.floor(Date.now() / 1000)
  const held = memoryTokens.get(key)
  if (held && held.exp - TOKEN_MARGIN_S > now) return held.token
  try {
    const raw = await redis('get', key)
    const kept = raw ? JSON.parse(raw) : null
    if (kept?.token && kept.exp - TOKEN_MARGIN_S > now) { memoryTokens.set(key, kept); return kept.token }
  } catch { /* Redis unavailable: sign as before */ }
  const { token, expiresIn } = await signGoogleToken(scope, { impersonate, withExpiry: true })
  const entry = { token, exp: now + (Number(expiresIn) || 3600) }
  memoryTokens.set(key, entry)
  redis('set', key, JSON.stringify(entry), 'EX', String(Math.max(60, entry.exp - now - TOKEN_MARGIN_S))).catch(() => {})
  return token
}

async function signGoogleToken(scope, { impersonate, withExpiry = false } = {}) {
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
  return withExpiry ? { token: tokenData.access_token, expiresIn: tokenData.expires_in } : tokenData.access_token
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

  // ── Which calendar approved leave goes on ──
  //
  // "There are currently two entries in the calendar for Brenton leave."
  //
  // There was a Staff Leave calendar — "Calendar for TechnoMed Team's Approved
  // Annual/Personal Leave", which is exactly what this writes — and this wrote
  // to the bookings calendar anyway. The portal reads both, so every approved
  // request has been showing up twice: once from whoever keeps the leave
  // calendar by hand, and once from here. Brent's was the one he noticed.
  //
  // The leave calendar first, where one is configured. The bookings calendar
  // only as a fallback, because a staff member filing leave at nine on a
  // Sunday night must not be told to come back when somebody has fixed a
  // sharing setting — the request still has to land somewhere.
  //
  // Written *as bookings@*, which owns Staff Leave, where it can be. Workspace
  // will not let a calendar be shared for editing with an account outside the
  // domain, and the service account is one — so "Make changes to events" is
  // greyed out for it on Staff Leave (Brent, 2 Nov 2026). Acting as bookings@
  // needs only the calendar.events scope added to the domain-wide delegation
  // the bookings inbox already uses. Until that is granted, the token is
  // refused and this carries on exactly as before.
  const leaveCalendar = (process.env.GOOGLE_LEAVE_CALENDAR_ID || STAFF_LEAVE_CALENDAR_ID).trim()
  const asOwner = async () => getGoogleToken(CALENDAR_SCOPE_EVENTS, { impersonate: CALENDAR_OWNER })
  const targets = [
    { id: leaveCalendar, preferred: true, token: asOwner },
    { id: leaveCalendar, preferred: true, token: async () => token },
    { id: GOOGLE_CALENDAR_ID, preferred: false, token: async () => token }
  ]

  let lastError = null
  for (const target of targets) {
    let bearer
    try {
      bearer = await target.token()
    } catch (err) {
      // Delegation not granted (yet): try the next way in.
      lastError = { message: err.message }
      continue
    }
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.id)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      }
    )

    const result = await res.json()
    if (!result.error) {
      calendarChanged()
      return {
        eventId: result.id,
        eventLink: result.htmlLink,
        calendarId: target.id,
        // Said out loud so the caller can say it too. A silent fallback would
        // recreate the duplicate quietly, which is the bug this is fixing.
        fellBack: !target.preferred
      }
    }
    lastError = result.error
    // Only a permissions problem is worth trying the other calendar for. A
    // malformed event will be just as malformed on the second attempt.
    const denied = res.status === 403 || res.status === 404
    if (!denied) break
  }

  throw new Error(lastError?.message || 'Google Calendar error')
}

// ─── TOIL taken on a timesheet, ahead of time (Brent, 12 Nov 2026) ──────────
// "If it's prospective then we want the TOIL added to the calendar like a
// leave day or an RDO." A day of TOIL typed on a timesheet for today or later
// goes on the Staff Leave calendar, one all-day entry per day, written the way
// approved leave is (as bookings@ where it can be, else the service account).
// A day taken off the timesheet comes off the calendar; a past day is never
// added — the leave calendar is for planning.

const nextDay = d => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }
const fmtHours = h => `${Math.round(Number(h) * 100) / 100}h`

async function leaveCalendarWays() {
  const leaveCalendar = (process.env.GOOGLE_LEAVE_CALENDAR_ID || STAFF_LEAVE_CALENDAR_ID).trim()
  return [
    { id: leaveCalendar, token: () => getGoogleToken(CALENDAR_SCOPE_EVENTS, { impersonate: CALENDAR_OWNER }) },
    { id: leaveCalendar, token: () => getGoogleToken(CALENDAR_SCOPE_WRITE) },
    { id: GOOGLE_CALENDAR_ID, token: () => getGoogleToken(CALENDAR_SCOPE_WRITE) }
  ]
}

/**
 * @param {object} input
 * @param {string} input.name        the person
 * @param {object} input.want        { day: hours } — today and later only
 * @param {object} input.existing    { day: { eventId, calendarId, hours } } written before
 * @returns {Promise<{ entries: object, errors: string[] }>} the entries now on the calendar
 */
export async function syncToilCalendar({ name, want = {}, existing = {}, today }) {
  const entries = { ...existing }
  const errors = []
  const ways = await leaveCalendarWays()
  const call = async (method, calendarId, path, body) => {
    let last = ''
    for (const way of ways.filter(w => !calendarId || w.id === calendarId)) {
      let bearer
      try { bearer = await way.token() } catch (err) { last = err.message; continue }
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(way.id)}/events${path}`, {
        method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
      if (res.ok || (method === 'DELETE' && (res.status === 404 || res.status === 410))) {
        return { ok: true, calendarId: way.id, data: method === 'DELETE' ? null : await res.json().catch(() => ({})) }
      }
      last = `${res.status}`
      if (res.status !== 403 && res.status !== 404) break
    }
    return { ok: false, error: last }
  }
  const event = (day, hours) => ({
    summary: `${name} — TOIL (${fmtHours(hours)})`,
    description: [`Employee: ${name}`, 'Leave type: TOIL', `Hours: ${hours}`, '',
      'Taken on a timesheet in the TechnoMed Portal'].join('\n'),
    start: { date: day }, end: { date: nextDay(day) },
    colorId: GRAPE_COLOR_ID, transparency: 'transparent'
  })

  for (const [day, was] of Object.entries(existing)) {
    if (today && day < today) continue
    if (Number(want[day]) > 0) continue
    const done = await call('DELETE', was.calendarId, `/${encodeURIComponent(was.eventId)}`)
    if (done.ok) delete entries[day]
    else errors.push(`Could not take TOIL off the calendar for ${day}`)
  }
  for (const [day, hours] of Object.entries(want)) {
    if (today && day < today) continue
    const was = existing[day]
    if (was && Number(was.hours) === Number(hours)) continue
    const done = was
      ? await call('PATCH', was.calendarId, `/${encodeURIComponent(was.eventId)}`, event(day, hours))
      : await call('POST', null, '', event(day, hours))
    if (done.ok) entries[day] = { eventId: was?.eventId || done.data?.id, calendarId: done.calendarId, hours: Number(hours) }
    else errors.push(`Could not put TOIL on the calendar for ${day}`)
  }
  if (JSON.stringify(entries) !== JSON.stringify(existing)) calendarChanged()
  return { entries, errors }
}

/**
 * Moves an approved leave's calendar entry to its amended dates (Brent, 11 Nov
 * 2026). The entry is found by the id kept at approval, or — for leave
 * approved before ids were kept — by its title on its old first day, on the
 * Staff Leave calendar and then the bookings one. Edited in place, never a
 * second entry: two entries for one leave is the duplicate this calendar has
 * already been through. Returns { updated, eventId } or { updated: false }.
 */
export async function updateLeaveEvent(before, after) {
  const leaveCalendar = (process.env.GOOGLE_LEAVE_CALENDAR_ID || STAFF_LEAVE_CALENDAR_ID).trim()
  const sa = await getGoogleToken(CALENDAR_SCOPE_WRITE)
  const ways = [
    async () => getGoogleToken(CALENDAR_SCOPE_EVENTS, { impersonate: CALENDAR_OWNER }),
    async () => sa
  ]
  const label = LEAVE_LABELS[after.leaveType] || after.leaveType
  const dayAfter = d => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }
  const patch = {
    summary: `${after.name} — ${label}`,
    start: { date: after.startDate },
    end: { date: dayAfter(after.endDate) },
    description: [`Employee: ${after.name}`, `Division: ${after.division || ''}`, `Leave type: ${label}`,
      ...(after.totalHours ? [`Hours: ${after.totalHours}`] : []), `Reason: ${after.reason || ''}`, '',
      'Submitted via TechnoMed Leave Portal (amended)'].join('\n')
  }

  const candidates = before.calendar?.eventId
    ? [{ calendarId: before.calendar.calendarId || leaveCalendar, eventId: before.calendar.eventId }]
    : []
  for (const calendarId of [leaveCalendar, GOOGLE_CALENDAR_ID]) {
    if (candidates.length) break
    for (const way of ways) {
      let bearer
      try { bearer = await way() } catch { continue }
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
        + `?timeMin=${encodeURIComponent(`${before.startDate}T00:00:00Z`)}&timeMax=${encodeURIComponent(`${dayAfter(before.startDate)}T23:59:59Z`)}`
        + `&singleEvents=true&q=${encodeURIComponent(before.name)}`
      const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } })
      const data = await res.json().catch(() => ({}))
      if (data.error) continue
      const hit = (data.items || []).find(e => String(e.summary || '').startsWith(`${before.name} — `) && e.start?.date === before.startDate)
      if (hit) { candidates.push({ calendarId, eventId: hit.id }); break }
    }
  }
  for (const { calendarId, eventId } of candidates) {
    for (const way of ways) {
      let bearer
      try { bearer = await way() } catch { continue }
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
      })
      if (res.ok) { calendarChanged(); return { updated: true, eventId, calendarId } }
    }
  }
  return { updated: false }
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
  // What the booking says was being done, for the registrar text (Brent,
  // 4 Nov 2026: "the portal should automatically give the rep a list of the
  // levels based on the booking"). Procedure and kit only — no identifiers.
  const booking = bookingFacts(event)
  // Idempotent: scanning a second page, or re-saving, must not produce
  // "(Brent) (Brent)".
  if (summary.includes(tag) || namedInBrackets(summary, firstName)) {
    return { updated: false, reason: 'already recorded', title: summary, booking }
  }

  const title = `${summary} ${tag}`.replace(/\s+/g, ' ').trim()
  const patched = await fetch(`${base}/${encodeURIComponent(event.id)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: title })
  })
  if (!patched.ok) {
    const detail = await patched.text()
    return { updated: false, reason: `could not update the booking (${patched.status}): ${detail.slice(0, 160)}`, booking }
  }
  calendarChanged()
  return { updated: true, title, booking }
}

/**
 * Whether the title already names this person inside a bracket of reps —
 * "(Mat/Aimee)" names Aimee, so filing her usage must not add "(Aimee)" again
 * (Rowley, 4 Nov 2026: "Rowley DIPLOMAT - Fowler (Mat/Aimee) (Aimee)").
 */
export function namedInBrackets(summary, firstName) {
  const who = String(firstName || '').trim().toLowerCase()
  if (!who) return false
  return [...String(summary || '').matchAll(/\(([^)]*)\)/g)]
    .some(m => m[1].split(/[\/,&+]|\band\b/i).map(x => x.trim().toLowerCase()).includes(who))
}

/** The procedure and kit a booking names, read the way the week reads it. */
function bookingFacts(event) {
  try {
    const read = readBooking(String(event.summary || ''), String(event.description || ''))
    return {
      procedure: String(read?.operation || '').slice(0, 200),
      kit: String(read?.kit || read?.system || '').slice(0, 200)
    }
  } catch {
    return null
  }
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
  calendarChanged()
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
  const event = await res.json()
  // Notes Google stored as HTML (touched in its web page, Outlook, a forwarded
  // invitation) come back as plain lines. Edit booking read them raw and every
  // field ran together — "Gupta<br>Patient: Brandall<br>Date: …" in the
  // surgeon box and the rest blank (Brent, 11 Nov 2026). Every edit path reads
  // the booking through here, so a save writes plain lines back.
  if (event.description) event.description = plainDescription(event.description)
  return event
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
/**
 * @param {object} o
 * @param {number} [o.hour]  the hour the booking occupies, 24h. One hour long.
 *
 * Bookings used to span 08:00 to 17:00, which is honest about how little anyone
 * knows of the real timing — and unreadable, because in Google's week view a
 * nine-hour block is the whole column and six cases are six slabs of colour on
 * top of one another. An hour each, laid out end to end, says the same nothing
 * about timing and shows the day. See src/clinicalPlan/dayLayout.js.
 */
/**
 * A task on a day: kit to move, a tray to get back, something to restock.
 *
 * All-day on purpose. A task is not at ten o'clock — it is a thing that has to
 * happen before the day is out — and an all-day entry sits in the band at the
 * top of the day in Google, above the cases, which is exactly where a reminder
 * wants to be. It also keeps tidyDay away from it: that only moves entries with
 * a start time, and a task being shuffled into a theatre slot would be absurd.
 */
export async function createTaskEvent({ summary, description, date, colorId, extendedProperties }) {
  const token = await getGoogleToken(CALENDAR_SCOPE_WRITE)
  const calendarId = getCalendarId()

  // Google treats an all-day end as exclusive, so a one-day task ends tomorrow.
  const end = new Date(`${date}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 1)

  const body = {
    summary,
    description,
    start: { date },
    end: { date: end.toISOString().slice(0, 10) },
    // It does not make anybody busy. Somebody has a job to do, not a meeting.
    transparency: 'transparent'
  }
  if (colorId) body.colorId = String(colorId)
  if (extendedProperties) body.extendedProperties = extendedProperties

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

  if (!res.ok) throw new Error(`Could not add the task (${res.status}): ${await res.text()}`)
  calendarChanged()
  return res.json()
}

export async function createBookingEvent({
  summary, description, date, colorId, location, hour = 8, extendedProperties
}) {
  const token = await getGoogleToken(CALENDAR_SCOPE_WRITE)
  const calendarId = getCalendarId()

  const from = String(Math.floor(hour)).padStart(2, '0')
  const to = String(Math.floor(hour) + 1).padStart(2, '0')
  const body = {
    summary,
    description,
    start: { dateTime: `${date}T${from}:00:00`, timeZone: BOOKING_TZ },
    end: { dateTime: `${date}T${to}:00:00`, timeZone: BOOKING_TZ }
  }
  if (colorId) body.colorId = String(colorId)
  if (location) body.location = location
  if (extendedProperties) body.extendedProperties = extendedProperties

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

  if (!res.ok) throw new Error(`Could not create the booking (${res.status}): ${await res.text()}`)
  calendarChanged()
  return res.json()
}

export const BOOKING_TZ = 'Australia/Hobart'


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
  calendarChanged()
  return { ok: true }
}
