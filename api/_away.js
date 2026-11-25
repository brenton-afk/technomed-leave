// ─── Away entries on the Staff Leave calendar (Brent, 24 Nov 2026) ──────────
// Training days, RDOs, conferences: paid, but not available for cases. See
// src/clinicalPlan/away.js for the rules. Written in the leave colour so the
// team reads it as "not here"; never a leave application, never Xero.
//
// The portal keeps a short record of what it wrote (`away:entries`), so the
// sheet can list what is coming up and take one off again. The calendar entry
// is the truth for the week; the record is only how to find it to remove it.

import { redis, redisSetBody } from './_redis.js'
import { leaveCalendarRequest } from './_googleCalendar.js'
import { randomUUID } from 'node:crypto'
import { cleanAway, awayEvent, mayAddAway, kindOf } from '../src/clinicalPlan/away.js'

const KEY = 'away:entries'
const KEEP = 200

// Everyone on the staff list may add a status (Brent, 25 Nov 2026); setting
// AWAY_EDITORS narrows it to those addresses.
export const awayEditors = () => {
  const env = String(process.env.AWAY_EDITORS || '').split(',').map(s => s.trim()).filter(Boolean)
  return env.length ? env : null
}
export const mayEditAway = email => mayAddAway(email, awayEditors())

async function readEntries() {
  const raw = await redis('GET', KEY)
  try { return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [] } catch { return [] }
}
const writeEntries = list => redisSetBody(KEY, JSON.stringify(list.slice(-KEEP)))

/** Entries from today on, soonest first. */
export async function upcomingAway(today) {
  return (await readEntries()).filter(e => e.to >= today).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
}

/** Every entry touching from–to, for the who's-where strip. */
export async function awayBetween(from, to) {
  return (await readEntries()).filter(e => e.to >= from && e.from <= to)
}

/**
 * Training, Away and Leave are written to the Staff Leave calendar first, then
 * recorded; Theatre and Office are the portal's own and only recorded.
 */
export async function addAway(body, by) {
  const entry = cleanAway(body)
  if (entry.error) return { status: 400, error: entry.error }
  let id = `st-${randomUUID()}`
  let calendarId = null
  if (kindOf(entry.kind).calendar) {
    const event = awayEvent(entry, by?.name || '')
    const done = await leaveCalendarRequest('POST', null, '', event)
    if (!done.ok) return { status: 502, error: 'The calendar would not take it. Try again shortly.' }
    id = done.data?.id
    calendarId = done.calendarId
  }
  const record = {
    id, calendarId, kind: entry.kind,
    email: entry.person.email, firstName: entry.person.firstName, name: entry.person.name,
    from: entry.from, to: entry.to, allDay: entry.allDay, start: entry.start, end: entry.end,
    reason: entry.reason, where: entry.where, note: entry.note,
    by: by?.email || '', byName: by?.name || '', at: new Date().toISOString()
  }
  const list = await readEntries()
  list.push(record)
  await writeEntries(list)
  return { status: 200, entry: record }
}

/** Takes the calendar entry off (where there is one), then the record. */
export async function removeAway(id) {
  const list = await readEntries()
  const found = list.find(e => e.id === id)
  if (!found) return { status: 404, error: 'Not found — it may already be off.' }
  if (found.calendarId || (found.kind ? kindOf(found.kind).calendar : true)) {
    const done = await leaveCalendarRequest('DELETE', found.calendarId, `/${encodeURIComponent(id)}`)
    if (!done.ok) return { status: 502, error: 'The calendar would not take it off. Try again shortly.' }
  }
  await writeEntries(list.filter(e => e.id !== id))
  return { status: 200, removed: id }
}
