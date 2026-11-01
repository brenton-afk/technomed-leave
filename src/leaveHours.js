import { periodFor } from '../api/_fortnight.js'

// ─── Leave in hours, for staff who do not work five standard days ───────────
// "Leave requests must work for part-time staff."
//
// Xero AU payroll has no idea which days somebody works. Given a date range it
// spreads their weekly ordinary hours evenly over Monday to Friday — 16.5 / 5
// is 3.3 hours a day for Toni, including her days off. On 27 October that, and
// a request on top of three she had already lodged in Xero herself, paid her
// leave twice in the draft pay run.
//
// So the portal works the hours out itself and tells Xero exactly how many
// fall in each pay period. Xero is never left to guess.
//
// A pattern is one of:
//   { kind: 'fixed', days: [mon, tue, wed, thu, fri, sat, sun] }  hours per weekday
//   { kind: 'flexible', weeklyHours }  days vary week to week; the person says
//                                      which days and how long, against the
//                                      weekly figure as a guide
// Staff with no pattern keep the plain date range, which Xero gets right for a
// standard Monday-to-Friday week.

const DAY_MS = 86_400_000

function dayIndex(date) {
  // 0 = Monday … 6 = Sunday
  const d = new Date(`${date}T00:00:00Z`).getUTCDay()
  return (d + 6) % 7
}

function addDay(date) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + DAY_MS).toISOString().slice(0, 10)
}

const round = h => Math.round(Number(h || 0) * 100) / 100

/**
 * The days in a range, each with the hours the pattern says they are worth.
 *
 * Fixed: the contracted hours, and only the days that have some.
 * Flexible: every weekday, at nothing — they fill in the days they work.
 */
export function leaveDays(startDate, endDate, pattern) {
  if (!pattern || !startDate || !endDate || endDate < startDate) return []
  const out = []
  for (let date = startDate; date <= endDate; date = addDay(date)) {
    const i = dayIndex(date)
    if (pattern.kind === 'fixed') {
      const hours = round(pattern.days?.[i])
      if (hours > 0) out.push({ date, hours })
    } else if (pattern.kind === 'flexible') {
      if (i < 5) out.push({ date, hours: 0 })
    }
  }
  return out
}

/** Hours across the days that have any. */
export function totalHours(days) {
  return round((days || []).reduce((sum, d) => sum + Number(d.hours || 0), 0))
}

/**
 * The hours grouped by the fortnightly pay period they fall in.
 *
 * Toni, Tue 27 Oct to Mon 2 Nov: 11 hours in the period ending Sun 1 Nov
 * (Wed and Thu) and 5.5 in the period ending Sun 15 Nov (Mon). That is what
 * goes to Xero, period by period.
 */
export function hoursByPayPeriod(days) {
  const periods = new Map()
  for (const { date, hours } of days || []) {
    if (!(Number(hours) > 0)) continue
    const { start, end } = periodFor(date)
    const at = periods.get(end) || { start, end, hours: 0 }
    at.hours = round(at.hours + Number(hours))
    periods.set(end, at)
  }
  return [...periods.values()].sort((a, b) => (a.end < b.end ? -1 : 1))
}

/**
 * Checks hours a person sent in.
 *
 * Every day inside the range, between 0 and 12 hours, at least something
 * overall. Returns the cleaned list or throws a sentence for the form.
 */
export function cleanLeaveHours(hours, { startDate, endDate }) {
  if (!Array.isArray(hours)) throw new Error('Hours for each day are needed')
  const seen = new Set()
  const out = []
  for (const row of hours) {
    const date = String(row?.date || '')
    const h = round(row?.hours)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < startDate || date > endDate) {
      throw new Error('An hours entry falls outside the leave dates')
    }
    if (!(h >= 0 && h <= 12)) throw new Error('Each day must be between 0 and 12 hours')
    if (seen.has(date)) throw new Error('A day appears twice in the hours')
    seen.add(date)
    if (h > 0) out.push({ date, hours: h })
  }
  if (!out.length) throw new Error('Enter the hours you would have worked on at least one day')
  return out.sort((a, b) => (a.date < b.date ? -1 : 1))
}
