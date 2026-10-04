import { STAFF } from '../staffConfig.js'

// ─── Who is team leader this week ────────────────────────────────────────────
// The duty leader rings the hospitals for the running orders, fields whatever
// the day throws up, and is the person everybody else asks. It changes often —
// somebody is on leave, somebody swaps — and it was a calendar entry that had
// to be remembered and moved, so it drifted: Mat was showing as team leader
// during a week he was on TOIL.
//
// So the portal owns it, and anybody on the team can change it with a tap. Not
// admin-only on purpose: the person who knows the roster has changed is
// usually the person it changed to, and making them ask somebody else is how a
// rota goes stale.
//
// ── The week, and the gap either side of it ──
//
// A leader holds it from 07:00 Monday to 17:00 Friday. The weekend belongs to
// whoever is on call — that is a separate rota and a different job, and the
// two must not be confused for each other. Between Friday evening and Monday
// morning there is no team leader at all, and the honest thing to say is who
// is on call instead.

/** 07:00 Monday. */
export const STARTS_AT = 7
/** 17:00 Friday. */
export const ENDS_AT = 17

const isoWeekday = date => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1

const shift = (date, by) => {
  const at = new Date(`${date}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + by)
  return at.toISOString().slice(0, 10)
}

/**
 * The Monday of the week a date belongs to.
 *
 * Which is also the key the roster is stored under, so a week has exactly one
 * leader however the question is asked.
 */
export function weekOf(date) {
  const day = String(date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  return shift(day, -(isoWeekday(day) - 1))
}

/**
 * Whether a moment falls inside the leader's week.
 *
 * @param {string} date  YYYY-MM-DD
 * @param {number} hour  0–23, Hobart
 */
export function withinWeek(date, hour) {
  const day = String(date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const weekday = isoWeekday(day)
  if (weekday > 5) return false                       // Saturday, Sunday
  if (weekday === 1) return Number(hour) >= STARTS_AT  // Monday, from seven
  if (weekday === 5) return Number(hour) < ENDS_AT     // Friday, until five
  return true
}

/** The staff member behind a stored roster entry, or null. */
export function leaderFrom(entry) {
  if (!entry?.email) return null
  return STAFF.find(s => s.email.toLowerCase() === String(entry.email).toLowerCase()) || null
}

/**
 * Who is covering right now, and under which hat.
 *
 * Returns the leader inside the week and the on-call person outside it, said
 * plainly rather than blended — somebody reading this needs to know whether
 * they are ringing the duty leader or waking the on-call rep, and those are
 * different conversations.
 *
 * @param {object} input
 * @param {string} input.date       YYYY-MM-DD, Hobart
 * @param {number} input.hour       0–23, Hobart
 * @param {object} [input.leader]   the stored roster entry for that week
 * @param {object} [input.onCall]   the staff member on call, where known
 */
export function coverNow({ date, hour, leader, onCall } = {}) {
  if (withinWeek(date, hour)) {
    const person = leaderFrom(leader)
    return person
      ? { role: 'leader', person, label: `${person.firstName} is team leader` }
      : { role: 'leader', person: null, label: 'Nobody is set as team leader' }
  }
  return onCall
    ? { role: 'onCall', person: onCall, label: `${onCall.firstName} is on call` }
    : { role: 'onCall', person: null, label: 'Out of hours — nobody is on call' }
}

/** Tidies what came off the button into what gets stored. */
export function cleanLeader({ email, setBy } = {}) {
  const person = STAFF.find(s => s.email.toLowerCase() === String(email || '').toLowerCase())
  if (!person) return null
  return {
    email: person.email,
    name: person.name,
    firstName: person.firstName,
    // Who changed it, because a rota anybody can edit is a rota worth being
    // able to ask about.
    setBy: String(setBy || '').toLowerCase() || null,
    setAt: new Date().toISOString()
  }
}
