// ─── My leave: your leave coming up, in one list (Toni, 26 Nov 2026) ──────────
// "Would be good if the ME section of portal could hold all future leave dates
// for yourself that have been requested and already approved. This could be
// generated from 'staff leave' calendar as anything approved prior to leave
// being submitted via portal has already been entered into staff leave
// calendar by me."
//
// Two sources: the portal's own leave requests (pending and approved) and the
// Staff Leave calendar (anything there naming the person counts as approved —
// Toni enters it). A calendar entry the portal itself wrote on approval, or
// one covering the same days as a portal request, is the same leave and is
// shown once, as the portal's record — that one has the type and the hours.
// Pure: the server reads, this decides.

import { readAwayTitle } from '../clinicalPlan/away.js'
import { leaveDays } from '../leaveHours.js'
import { publicHoliday } from '../publicHolidays.js'

const TYPE_LABELS = { ANNUAL_LEAVE: 'Annual leave', SICK: 'Personal leave', TOIL: 'TOIL' }

const DAY = /^\d{4}-\d{2}-\d{2}$/

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** True when the text names this person by any name the team writes them under. */
export function namesPerson(text, person) {
  if (!person) return false
  const names = [person.firstName, ...(person.aka || []), String(person.name || '').split(' ').pop()]
  return names.some(n => n && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(String(text || '')))
}

/** What a calendar entry is, in a few words. */
export function calendarLabel(summary) {
  const own = readAwayTitle(summary)
  if (own) {
    if (own.word === 'Leave') return 'Leave'
    if (own.word === 'RDO') return 'RDO'
    return own.reason && own.reason !== own.word ? `${own.word} · ${own.reason}` : own.word
  }
  const t = String(summary || '')
  if (/\bannual\b|\ba\/l\b/i.test(t)) return 'Annual leave'
  if (/\b(personal|sick|carer'?s?)\b/i.test(t)) return 'Personal leave'
  if (/\btoil\b/i.test(t)) return 'TOIL'
  if (/\brdo\b/i.test(t)) return 'RDO'
  if (/\b(training|course|conference)\b/i.test(t)) return 'Training'
  return 'Leave'
}

/** First and last day of a Google event, as Hobart day strings. */
export function eventDays(event) {
  const s = event?.start || {}
  const e = event?.end || {}
  if (s.date) {
    // All-day: Google's end is the day after.
    const from = s.date
    const to = e.date && e.date > from ? addDays(e.date, -1) : from
    return { from, to }
  }
  const from = String(s.dateTime || '').slice(0, 10)
  const to = String(e.dateTime || s.dateTime || '').slice(0, 10)
  return DAY.test(from) ? { from, to: DAY.test(to) && to >= from ? to : from } : null
}

const overlaps = (a, b) => a.from <= b.to && b.from <= a.to

/**
 * The person's leave from today on, soonest first.
 *   person        the staff row (email, firstName, name, aka)
 *   today         'YYYY-MM-DD' in Hobart
 *   applications  portal leave records (any status, anyone's)
 *   events        Staff Leave calendar events
 * Each: { id, from, to, label, status: 'approved'|'pending', source: 'portal'|'calendar', hours?, note? }
 */
export function myUpcomingLeave({ person, today, applications = [], events = [] }) {
  if (!person?.email || !DAY.test(today || '')) return []
  const email = person.email.toLowerCase()

  const mine = applications
    .filter(a => a && String(a.email || '').toLowerCase() === email)
    .filter(a => a.status === 'pending' || a.status === 'approved')
    .filter(a => DAY.test(a.startDate || '') && DAY.test(a.endDate || '') && a.endDate >= today)

  const portal = mine.map(a => ({
    id: `portal-${a.id}`,
    from: a.startDate,
    to: a.endDate,
    label: TYPE_LABELS[a.leaveType] || 'Leave',
    status: a.status,
    source: 'portal',
    ...leaveAmount(a.startDate, a.endDate, person.workPattern, a.hours),
    ...(a.returnDate ? { back: a.returnDate } : {}),
    eventId: a.calendar?.eventId || null
  }))
  const portalEventIds = new Set(portal.map(p => p.eventId).filter(Boolean))

  const seen = new Set()
  const calendar = []
  for (const ev of events) {
    if (!ev || portalEventIds.has(ev.id)) continue
    const summary = ev.summary || ''
    if (!namesPerson(summary, person)) continue
    const days = eventDays(ev)
    if (!days || days.to < today) continue
    const label = calendarLabel(summary)
    // The portal already has it — the same leave entered on both.
    if (portal.some(p => overlaps(p, days))) continue
    const key = `${days.from}|${days.to}|${label}`
    if (seen.has(key)) continue
    seen.add(key)
    calendar.push({
      id: `cal-${ev.id}`,
      from: days.from,
      to: days.to,
      label,
      status: 'approved',
      source: 'calendar',
      ...leaveAmount(days.from, days.to, person.workPattern),
      ...(ev.start?.dateTime ? { note: `${String(ev.start.dateTime).slice(11, 16)}–${String(ev.end?.dateTime || '').slice(11, 16)}` } : {})
    })
  }

  return [...portal, ...calendar]
    .map(({ eventId, ...rest }) => rest)
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
}

const STANDARD_DAY = 7.6
const round = h => Math.round(Number(h || 0) * 100) / 100

/**
 * How much leave a stretch is for this person (Toni, 26 Nov 2026: "it's saying
 * my January leave is 8 working days rather than 5 … not calculating part
 * time hours / days correctly"). Only the days they work count, public
 * holidays never:
 *   fixed pattern  their contracted days, at their hours (Toni Mon/Wed/Thu 5.5h)
 *   flexible       weekdays; hours unknown until they say (Erin)
 *   none           weekdays at 7.6h, full time
 * A portal request that carries its own hours per day is taken as written.
 * → { days, hours } (hours null when it cannot be known)
 */
export function leaveAmount(from, to, pattern, written = null) {
  if (Array.isArray(written) && written.length) {
    const worked = written.filter(d => Number(d.hours) > 0)
    return { days: worked.length, hours: round(worked.reduce((s, d) => s + Number(d.hours), 0)) }
  }
  if (pattern?.kind === 'fixed') {
    const days = leaveDays(from, to, pattern).filter(d => !publicHoliday(d.date))
    return { days: days.length, hours: round(days.reduce((s, d) => s + d.hours, 0)) }
  }
  const days = weekdaysIn(from, to, { holidays: false })
  return { days, hours: pattern?.kind === 'flexible' ? null : round(days * STANDARD_DAY) }
}

/** Working days (Mon–Fri) from `from` to `to`, both counted; public holidays left out unless `holidays`. */
export function weekdaysIn(from, to, { holidays = true } = {}) {
  let n = 0
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay()
    if (wd !== 0 && wd !== 6 && (holidays || !publicHoliday(d))) n++
    if (n > 400) break
  }
  return n
}
