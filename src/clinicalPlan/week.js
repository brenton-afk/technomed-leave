// ─── Week window logic ────────────────────────────────────────────────────────
// Everything is anchored to Australia/Hobart, which observes daylight saving
// (forward on the first Sunday in October, back on the first Sunday in April).
// No naive local-time arithmetic: civil dates are stepped as calendar days and
// only then converted to instants, so a week boundary cannot drift by an hour
// across a DST change.

export const TZ = 'Australia/Hobart'
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

// How far the given instant is from UTC in the named zone. Formats the instant
// as zone-local parts, reads them back as if they were UTC, and takes the
// difference — the standard way to get a zone offset without a date library.
export function zoneOffsetMs(date, tz = TZ) {
  // Intl only formats down to whole seconds, so the comparison has to be made
  // against a whole-second instant — otherwise a time carrying milliseconds
  // (an end-of-day 23:59:59.999) yields an offset short by those milliseconds.
  // Zone offsets are whole minutes, so truncating loses nothing.
  const truncated = Math.floor(date.getTime() / 1000) * 1000
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(truncated)).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value
    return acc
  }, {})
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  )
  return asIfUtc - truncated
}

// The civil (wall-clock) date in Hobart for an instant.
export function zonedCivil(date, tz = TZ) {
  const offset = zoneOffsetMs(date, tz)
  const shifted = new Date(date.getTime() + offset)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    // 1 = Monday … 7 = Sunday
    isoWeekday: ((shifted.getUTCDay() + 6) % 7) + 1
  }
}

// A Hobart wall-clock time → the instant it refers to. Resolved twice because
// the offset itself depends on the instant, which is what makes this correct
// on a DST changeover day.
export function zonedToInstant({ year, month, day, hour = 0, minute = 0, second = 0, ms = 0 }, tz = TZ) {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, ms)
  let instant = naive
  for (let i = 0; i < 2; i++) {
    instant = naive - zoneOffsetMs(new Date(instant), tz)
  }
  return new Date(instant)
}

export function toDateStr({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function parseDateStr(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''))
  if (!m) throw new Error(`Invalid date string "${str}"`)
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

// Calendar-day arithmetic in UTC, which has no DST, then read back as a civil
// date. Stepping days this way can never gain or lose an hour.
export function addCivilDays(civil, days) {
  const base = Date.UTC(civil.year, civil.month - 1, civil.day)
  const moved = new Date(base + days * 86_400_000)
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() }
}

export function civilWeekday(civil) {
  const d = new Date(Date.UTC(civil.year, civil.month - 1, civil.day))
  return ((d.getUTCDay() + 6) % 7) + 1
}

// The Monday of the week containing this civil date.
export function mondayOf(civil) {
  return addCivilDays(civil, -(civilWeekday(civil) - 1))
}

function windowFromMonday(monday, tz = TZ) {
  const sunday = addCivilDays(monday, 6)
  return {
    start: zonedToInstant({ ...monday, hour: 0, minute: 0 }, tz),
    end: zonedToInstant({ ...sunday, hour: 23, minute: 59, second: 59, ms: 999 }, tz),
    startDate: toDateStr(monday),
    endDate: toDateStr(sunday),
    days: Array.from({ length: 7 }, (_, i) => toDateStr(addCivilDays(monday, i)))
  }
}

// Which week the plan shows by default:
//   Monday–Thursday → the current Mon–Sun week
//   Friday–Sunday   → next week, so the view flips forward every Friday in step
//                     with the 5:30pm Friday email
export function resolveDefaultWeek(now = new Date(), tz = TZ) {
  const civil = zonedCivil(now, tz)
  const weekday = civil.isoWeekday
  const thisMonday = mondayOf(civil)
  const monday = weekday <= 4 ? thisMonday : addCivilDays(thisMonday, 7)
  return windowFromMonday(monday, tz)
}

// The window for the week containing an arbitrary date — used by manual
// stepping and by the Daily view crossing a week boundary.
export function weekWindowFor(dateStr, tz = TZ) {
  return windowFromMonday(mondayOf(parseDateStr(dateStr)), tz)
}

export function stepWeek(weekStartStr, direction, tz = TZ) {
  return windowFromMonday(addCivilDays(parseDateStr(weekStartStr), direction * 7), tz)
}

export function todayStr(now = new Date(), tz = TZ) {
  return toDateStr(zonedCivil(now, tz))
}

// "24 – 30 August 2026", collapsing a shared month or year.
export function formatWeekRange(startStr, endStr) {
  const a = parseDateStr(startStr), b = parseDateStr(endStr)
  if (a.year === b.year && a.month === b.month) {
    return `${a.day} – ${b.day} ${MONTHS[a.month - 1]} ${a.year}`
  }
  if (a.year === b.year) {
    return `${a.day} ${MONTHS[a.month - 1]} – ${b.day} ${MONTHS[b.month - 1]} ${a.year}`
  }
  return `${a.day} ${MONTHS[a.month - 1]} ${a.year} – ${b.day} ${MONTHS[b.month - 1]} ${b.year}`
}

// "Monday 24 August"
export function formatDayHeading(dateStr) {
  const c = parseDateStr(dateStr)
  return `${WEEKDAY_NAMES[civilWeekday(c) - 1]} ${c.day} ${MONTHS[c.month - 1]}`
}

export function weekdayName(dateStr) {
  return WEEKDAY_NAMES[civilWeekday(parseDateStr(dateStr)) - 1]
}

// 12-hour lowercase, as the document uses: "10:00am".
export function formatClock(iso, tz = TZ) {
  if (!iso) return ''
  const c = zonedCivil(new Date(iso), tz)
  const suffix = c.hour < 12 ? 'am' : 'pm'
  const hour12 = c.hour % 12 === 0 ? 12 : c.hour % 12
  return `${hour12}:${String(c.minute).padStart(2, '0')}${suffix}`
}

export function formatTimeRange(startIso, endIso, tz = TZ) {
  if (!startIso) return ''
  const from = formatClock(startIso, tz)
  const to = endIso ? formatClock(endIso, tz) : ''
  return to ? `${from}–${to}` : from
}

// Whether Hobart is on daylight saving at this instant — used in the footer's
// AEST/AEDT label and by the DST tests.
export function zoneAbbrev(date = new Date(), tz = TZ) {
  return zoneOffsetMs(date, tz) === 11 * 3_600_000 ? 'AEDT' : 'AEST'
}

export function formatStamp(iso, tz = TZ) {
  if (!iso) return ''
  const d = new Date(iso)
  const c = zonedCivil(d, tz)
  return `${c.day} ${MONTHS[c.month - 1]} ${c.year}, ${formatClock(iso, tz)} ${zoneAbbrev(d, tz)}`
}
