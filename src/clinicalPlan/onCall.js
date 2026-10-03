import { STAFF } from '../staffConfig.js'

// ─── The on-call weekend ─────────────────────────────────────────────────────
// A weekend on call runs from 17:00 Friday to 07:00 Monday. It is a rota: two
// weekends each, in turn, and from January 2027 two on and six off once Aimee
// joins it.
//
// None of that rotation is computed here, on purpose. The roster lives in the
// calendar, which is also where it gets amended — somebody falls ill, somebody
// swaps, and the entry moves. A rotation worked out from a start date and a
// cycle length would be right until the first swap and then confidently wrong
// for weeks, with nobody looking at it because it does not need checking.
//
// So this reads what the calendar says and turns it into hours. The calendar
// is the roster, the same way it is the record for everything else here.
//
// ── The hours ──
//
//   Friday    17:00 → 24:00   7
//   Saturday  00:00 → 24:00  24
//   Sunday    00:00 → 24:00  24
//   Monday    00:00 → 07:00   7
//                            ──
//                            62
//
// A public holiday Monday makes no difference: it still ends at 07:00.

/** 17:00 Friday. */
export const STARTS_AT = 17
/** 07:00 Monday. */
export const ENDS_AT = 7
/** What a whole weekend comes to. */
export const WEEKEND_HOURS = (24 - STARTS_AT) + 24 + 24 + ENDS_AT

/** Days, as an ISO weekday — 5 is Friday, 1 is Monday. */
const FRIDAY = 5

const isoWeekday = date => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1

const shift = (date, by) => {
  const at = new Date(`${date}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + by)
  return at.toISOString().slice(0, 10)
}

/**
 * Whose weekend it is, from the calendar entry's title.
 *
 * Matched against the roster rather than taken as free text: "Brent on call"
 * must reach the same person as "On call — Brent", and a title naming nobody
 * must not become a staff member called "On".
 */
export function whoIsOnCall(title) {
  const text = String(title || '')
  if (!/on[\s-]*call/i.test(text)) return null
  for (const person of STAFF) {
    const names = [person.firstName, ...(person.aka || []), person.name.split(' ').pop()]
    if (names.some(n => n && new RegExp(`\\b${n}\\b`, 'i').test(text))) return person
  }
  return null
}

/**
 * The hours a weekend puts on each day, keyed by date.
 *
 * Given any day of the weekend, not only the Friday — an entry can be written
 * against the Saturday, and somebody reading a roster should not have to care.
 */
export function weekendHours(anyDayOfIt) {
  const date = String(anyDayOfIt || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return {}

  const weekday = isoWeekday(date)
  // Walk back to the Friday the weekend began on. Monday belongs to the
  // weekend behind it, because the shift ends at seven that morning.
  const back = weekday === 1 ? 3 : (weekday - FRIDAY + 7) % 7
  const friday = shift(date, -back)

  return {
    [friday]: 24 - STARTS_AT,
    [shift(friday, 1)]: 24,
    [shift(friday, 2)]: 24,
    [shift(friday, 3)]: ENDS_AT
  }
}

/**
 * On-call hours for one person over a pay period, from the calendar.
 *
 * Only the days inside the period are returned: a weekend straddling the
 * fortnight boundary is paid in two halves, in the fortnight each half falls
 * in, which is what the dates in the calendar already say.
 *
 * @param {Array<{title?: string, date?: string}>} entries  calendar on-call items
 * @param {{firstName?: string, email?: string}} person
 * @param {string[]} days  the period's dates
 * @returns {Record<string, number>} hours by date
 */
export function onCallHoursFor(entries, person, days) {
  const inPeriod = new Set(days || [])
  const hours = {}
  const seen = new Set()

  for (const entry of entries || []) {
    const who = whoIsOnCall(entry?.title)
    if (!who) continue
    if (person?.email && who.email !== person.email) continue
    if (!person?.email && person?.firstName && who.firstName !== person.firstName) continue

    const spread = weekendHours(entry.date)
    // One weekend, however many entries describe it — a Friday entry and a
    // Saturday entry are the same shift, and adding both would pay it twice.
    const key = Object.keys(spread).sort()[0]
    if (!key || seen.has(key)) continue
    seen.add(key)

    for (const [date, amount] of Object.entries(spread)) {
      if (inPeriod.has(date)) hours[date] = (hours[date] || 0) + amount
    }
  }
  return hours
}

/** What that comes to, for a line on a screen. */
export function totalHours(byDay) {
  return Object.values(byDay || {}).reduce((n, h) => n + h, 0)
}
