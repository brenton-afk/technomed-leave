import { readBooking } from './parse.js'
import { whoIsOnCall, weekendHours } from './onCall.js'

// ─── Being called in ─────────────────────────────────────────────────────────
// A call-in is a case attended outside ordinary hours by whoever was on call.
// It pays a flat allowance — $250, and $450 from January 2027 — which covers
// the first five hours. Past that, every hour or part thereof is paid at double
// the person's ordinary rate.
//
// ── What is and is not a call-in ──
//
// The suggestions used to be every timed calendar entry outside 7am–6pm, shown
// to whoever happened to be looking at their timesheet. That is wrong twice.
//
// "List Order" is the loudest example: it is a standing reminder for the team
// leader to ring the hospitals, it sits on the calendar every weekday, and it
// is not a case. Nobody has ever been called in to a list order, and offering
// it as one invites a claim for something that did not happen.
//
// And a case is attended by somebody in particular. The team records who was in
// the room — the rep is on the booking — so a case Ben attended is not a
// call-in for Aimee, and should not be put in front of her.

/** Ordinary hours. Outside these, a case is worth asking about. */
export const DAY_STARTS = 7
export const DAY_ENDS = 18

/** What the allowance covers before double time starts. */
export const COVERED_HOURS = 5

/**
 * The double-time hours a call-in earns beyond the allowance.
 *
 * "Every hour or part thereof" — so five and a quarter hours is one hour of
 * double time, not a quarter. Rounded up deliberately: the rule is written
 * that way because somebody dragged out of bed at two in the morning is not
 * being asked to account for the twenty minutes.
 */
export function extraDoubleTime(hoursOnSite, { covered = COVERED_HOURS } = {}) {
  const hours = Number(hoursOnSite)
  if (!Number.isFinite(hours) || hours <= covered) return 0
  return Math.ceil(hours - covered)
}

/**
 * Whether a calendar entry could be a call-in at all.
 *
 * It has to be a case. readBooking is the same reader the whole app uses, and
 * it returns nothing without both a patient and a surgeon — which is what
 * keeps the list-order reminder, the team meeting and the leave entry out.
 */
export function isAttendableCase(event) {
  if (!event?.start?.dateTime) return false      // all-day entries are not cases
  const read = readBooking(event.summary || '', event.description || '')
  return Boolean(read?.patient && read?.surgeon)
}

/** The Hobart hour and date of an event, whatever zone the server is in. */
function hobart(startsAt) {
  const at = new Date(new Date(startsAt).getTime() + 10 * 3600 * 1000)
  return { hour: at.getUTCHours(), date: at.toISOString().slice(0, 10), weekday: at.getUTCDay() }
}

/** Whether it falls outside ordinary hours, which is what makes it askable. */
export function isOutOfHours(event) {
  const startsAt = event?.start?.dateTime
  if (!startsAt) return false
  const { hour, weekday } = hobart(startsAt)
  if (weekday === 0 || weekday === 6) return true
  return hour < DAY_STARTS || hour >= DAY_ENDS
}

/**
 * The call-ins worth putting to one person.
 *
 * A case is theirs if they are recorded as having attended it. Where nobody is
 * recorded, it falls to whoever the calendar says was on call that weekend —
 * the roster answers it, which is the whole reason the roster is read rather
 * than computed.
 *
 * Anything that matches neither is left out. An unattributed case shown to
 * everybody is four people deciding whether it was them, and at least three of
 * them wrong.
 */
export function callInsFor(events, person, days, { onCallEntries = [] } = {}) {
  const inPeriod = new Set(days || [])
  const firstName = person?.firstName
  if (!firstName) return []

  // The weekends this person was on call, as a set of dates.
  const theirWeekends = new Set()
  for (const entry of onCallEntries) {
    const who = whoIsOnCall(entry?.title)
    if (who?.email !== person.email) continue
    for (const date of Object.keys(weekendHours(entry.date))) theirWeekends.add(date)
  }

  const found = []
  for (const event of events || []) {
    if (!isAttendableCase(event) || !isOutOfHours(event)) continue
    const { hour, date } = hobart(event.start.dateTime)
    if (!inPeriod.has(date)) continue

    const read = readBooking(event.summary || '', event.description || '')
    const reps = read?.reps?.length ? read.reps : (read?.rep ? [read.rep] : [])
    const attended = reps.some(r => String(r).toLowerCase() === firstName.toLowerCase())
    // Attributed to somebody else: not this person's to claim.
    if (reps.length && !attended) continue
    // Nobody recorded, and not their weekend either.
    if (!reps.length && !theirWeekends.has(date)) continue

    found.push({
      id: event.id,
      day: date,
      title: event.summary || 'Case',
      time: `${String(hour).padStart(2, '0')}:${String(new Date(
        new Date(event.start.dateTime).getTime() + 10 * 3600 * 1000).getUTCMinutes()).padStart(2, '0')}`,
      location: event.location || null,
      // Why it is being asked about, so the prompt can say.
      reason: attended ? 'you are down as the rep' : 'your on-call weekend'
    })
  }
  return found
}
