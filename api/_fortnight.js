// ─── Fortnight periods ────────────────────────────────────────────────────────
// Pay periods are Monday→Sunday, two weeks, counted from a fixed anchor.
//
// The spec named "Monday 16 June 2026", but 16 June 2026 is a Tuesday. The
// Monday→Sunday shape is the load-bearing part (it drives the grid, the Xero
// NumberOfUnits ordering and the Sunday deadline), so the anchor is the Monday
// of that week. If the intent really was Tuesday-to-Monday periods, change this
// one constant and everything else follows.
export const FORTNIGHT_ANCHOR = '2026-06-15'

const DAY_MS = 86_400_000
// Tasmania runs UTC+10 (AEST); matches the offset used by api/calendar/today.js.
const AEST_OFFSET_MS = 10 * 60 * 60 * 1000

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const FORTNIGHT_DAYS = 14
export const STANDARD_DAY_HOURS = 7.6
export const STANDARD_WEEK_HOURS = 38

function toUtcMs(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''))
  if (!m) return NaN
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function toDateStr(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(dateStr, n) {
  return toDateStr(toUtcMs(dateStr) + n * DAY_MS)
}

// Today's date in Tasmania, not the server's timezone.
export function todayAest(nowMs = Date.now()) {
  return new Date(nowMs + AEST_OFFSET_MS).toISOString().slice(0, 10)
}

// Which fortnight a date falls in. Dates before the anchor give a negative
// index, which is correct arithmetic — nothing clamps it.
export function fortnightIndexFor(dateStr) {
  const diffDays = Math.floor((toUtcMs(dateStr) - toUtcMs(FORTNIGHT_ANCHOR)) / DAY_MS)
  return Math.floor(diffDays / FORTNIGHT_DAYS)
}

export function fortnightStartFor(dateStr) {
  return addDays(FORTNIGHT_ANCHOR, fortnightIndexFor(dateStr) * FORTNIGHT_DAYS)
}

// The full period a date belongs to: bounds, the 14 day strings, and the two
// Mon–Sun weeks the grid renders.
export function periodFor(dateStr) {
  const start = fortnightStartFor(dateStr)
  const days = Array.from({ length: FORTNIGHT_DAYS }, (_, i) => addDays(start, i))
  return {
    index: fortnightIndexFor(dateStr),
    start,
    end: days[FORTNIGHT_DAYS - 1],
    days,
    weeks: [days.slice(0, 7), days.slice(7)]
  }
}

export function currentPeriod(nowMs = Date.now()) {
  return periodFor(todayAest(nowMs))
}

// Recent periods, newest first — for a period picker.
export function recentPeriods(count = 6, nowMs = Date.now()) {
  const current = currentPeriod(nowMs)
  return Array.from({ length: count }, (_, i) =>
    periodFor(addDays(current.start, -i * FORTNIGHT_DAYS)))
}

export function isValidPeriodStart(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return false
  return fortnightStartFor(dateStr) === dateStr
}

// Deadline is the end of the final Sunday, in Tasmanian time.
export function isPeriodClosed(periodStart, nowMs = Date.now()) {
  return todayAest(nowMs) > addDays(periodStart, FORTNIGHT_DAYS - 1)
}

export function dayLabel(dateStr) {
  const ms = toUtcMs(dateStr)
  const dow = new Date(ms).getUTCDay() // 0=Sun
  return DAY_NAMES[(dow + 6) % 7]
}

// Xero's legacy payroll API wants /Date(ms+0000)/.
export function xeroDate(dateStr) {
  const ms = toUtcMs(dateStr)
  if (Number.isNaN(ms)) throw new Error(`Invalid date "${dateStr}"`)
  return `/Date(${ms}+0000)/`
}
