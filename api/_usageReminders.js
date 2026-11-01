import { getGoogleToken, getCalendarId, CALENDAR_SCOPE_READONLY } from './_googleCalendar.js'
import { readBooking, isCancelled, detectHospital } from '../src/clinicalPlan/parse.js'
import { isDistributorEmail } from '../src/clinicalPlan/bookingSources.js'
import { redis, getUsageHistory, getTeamLeader } from './_redis.js'
import { STAFF } from '../src/staffConfig.js'
import { weekOf, rosteredLeader } from '../src/clinicalPlan/teamLeader.js'

// ─── "Usage not sent" (Task 11) ──────────────────────────────────────────────
// "Once a team member is allocated to a case and has not sent the usage by end
// of day, notify them." — Mat.
//
// 6pm on the case day: everyone planned for or recorded at a case with no
// usage email sent gets a reminder. 9am the next day, anything still unsent
// goes to that week's team leader. A case marked "No usage", called off, or
// one we were not needed at, is left alone.
//
// The reminder names the surgeon, the operation and the hospital — never the
// patient. It is a staff email, and the rep knows which case it is.

/** The day's cases from the bookings calendar, as the reminder needs them. */
export async function casesOn(day) {
  const token = await getGoogleToken(CALENDAR_SCOPE_READONLY)
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(getCalendarId())}/events`
    + `?timeMin=${encodeURIComponent(`${day}T00:00:00+11:00`)}`
    + `&timeMax=${encodeURIComponent(`${day}T23:59:59+10:00`)}`
    + '&singleEvents=true&orderBy=startTime&maxResults=250&timeZone=Australia%2FMelbourne'
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return (data.items || [])
    .filter(e => e.start?.dateTime && e.start.dateTime.slice(0, 10) === day)
    .filter(e => !isDistributorEmail(e.organizer?.email))
    .map(e => {
      const read = readBooking(e.summary || '', e.description || '',
        { knownPatient: e.extendedProperties?.private?.tmPatient })
      if (!read?.patient && !read?.awaitingName) return null
      return {
        id: e.id,
        date: day,
        patient: read.patient || '',
        surgeon: read.surgeon || '',
        operation: read.operation || read.system || '',
        hospital: read.hospital || detectHospital(e.location, e.description, { caseEvent: true }) || '',
        planned: read.planned || [],
        reps: read.reps || [],
        cancelled: isCancelled(e.summary || '', e.description || ''),
        notRequired: Boolean(read.notRequired)
      }
    })
    .filter(Boolean)
}

/** Whether a usage email went for this case: same day, same surname, one sent. */
export function usageSent(c, records) {
  const surname = String(c.patient || '').trim().toLowerCase()
  if (!surname) return false
  return records.some(r => String(r.date || '') === c.date
    && String(r.patientSurname || '').trim().toLowerCase() === surname
    && (r.emailsSent || []).some(e => e.ok && !e.test))
}

/** The cases that still owe a usage, each with the reps it is owed by. */
export function owingUsage(cases, records, noUsage = new Set()) {
  return cases
    .filter(c => !c.cancelled && !c.notRequired && !noUsage.has(c.id))
    .map(c => ({ ...c, who: [...new Set([...(c.planned || []), ...(c.reps || [])])] }))
    .filter(c => c.who.length && !usageSent(c, records))
}

/** "Ibbett · L4/5 PLIF · RHH" — what a case is called in a reminder. */
export function caseLine(c) {
  return [c.surgeon, c.operation, c.hospital].filter(Boolean).join(' · ') || 'A case'
}

export async function noUsageMarks(ids) {
  const marked = new Set()
  await Promise.all(ids.map(async id => {
    try { if (await redis('get', `usage:none:${id}`)) marked.add(id) } catch { /* treat as unmarked */ }
  }))
  return marked
}

export async function markNoUsage(eventId, by, on = true) {
  if (on) await redis('set', `usage:none:${eventId}`, JSON.stringify({ by, at: new Date().toISOString() }))
  else await redis('del', `usage:none:${eventId}`)
}

export async function isMarkedNoUsage(eventId) {
  try { return Boolean(await redis('get', `usage:none:${eventId}`)) } catch { return false }
}

/** Everything a run needs: the day's owing cases, grouped by rep email. */
export async function owingFor(day) {
  const [cases, records] = await Promise.all([casesOn(day), getUsageHistory(200).catch(() => [])])
  const owing = owingUsage(cases, records, await noUsageMarks(cases.map(c => c.id)))
  const byEmail = new Map()
  for (const c of owing) {
    for (const name of c.who) {
      const staff = STAFF.find(s => s.firstName === name)
      if (!staff) continue
      if (!byEmail.has(staff.email)) byEmail.set(staff.email, { staff, cases: [] })
      byEmail.get(staff.email).cases.push(c)
    }
  }
  return { owing, byEmail }
}

export async function leaderEmailFor(day) {
  const monday = weekOf(day)
  let set = null
  try { set = await getTeamLeader(monday) } catch { set = null }
  return (set || rosteredLeader(monday))?.email || null
}
