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

// ─── The standing rota ───────────────────────────────────────────────────────
// Ben and Mat alternate, a turn each.
//
// **A turn runs Friday to Thursday** (Brent, 5 Nov 2026): "The handover happens
// on Friday to the new team leader so that the team leader can get their head
// around cases for the following week." So the leader who will run Monday's
// lists takes over the Friday before, and holds it through the next Thursday.
// It used to be Monday to Friday, which handed a week over on the morning its
// lists started.
//
// Ben's turn starts Friday 13 November 2026, and every second Friday after it;
// Mat has the ones between.
//
// Brent is deliberately not in the rotation. He covers when somebody is away
// or stretched, and a person who only ever covers should not be in the cycle,
// or the cycle stops describing what normally happens. His covers are entries
// (saved, or in COVERS below), so the screen can say "Brent, covering for Mat".
//
// Computed rather than stored, so the roster is right for any week anybody
// looks at, including ones months out that nobody has thought about yet. An
// entry saved against a turn overrides it — see the handler — because the
// whole point of a standing rota is that it says what happens unless somebody
// says otherwise.
export const ROTATION = ['ben@technomed.com.au', 'mat@technomed.com.au']

/** The Friday Ben's turn starts from. Everything else counts out from here. */
export const ROTATION_ANCHOR = '2026-11-13'

/**
 * Covers set when the handover moved to Fridays, by the Friday the turn
 * starts. "Tomorrow team leader is Brent until the following Thursday and then
 * it changes to Ben" — Brent, Thursday 5 Nov 2026. A saved entry for the same
 * turn still wins, so this can be changed from the portal like any other.
 */
export const COVERS = {
  '2026-11-06': 'brenton@technomed.com.au'
}

/**
 * The Friday a date's turn started on: the date itself on a Friday, else the
 * Friday before. Which is also the key a turn's leader is stored under.
 */
export function turnOf(date) {
  const day = String(date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  return shift(day, -((isoWeekday(day) - 5 + 7) % 7))
}

/** The Thursday a turn ends on. */
export function turnEnds(friday) {
  return friday ? shift(friday, 6) : null
}

/**
 * Whose turn it is in the standing rota, on `date` (any day of the turn).
 *
 * Works backwards as well as forwards, so a past turn has an answer too.
 */
export function rosteredLeader(date) {
  const friday = turnOf(date)
  if (!friday) return null
  const days = Math.round(
    (Date.parse(`${friday}T00:00:00Z`) - Date.parse(`${ROTATION_ANCHOR}T00:00:00Z`)) / 86400000)
  const turns = Math.round(days / 7)
  // Modulo that behaves for turns before the anchor, where % alone gives -1.
  const turn = ((turns % ROTATION.length) + ROTATION.length) % ROTATION.length
  const email = ROTATION[turn]
  return STAFF.find(p => p.email === email) || null
}

/** A cover written into COVERS, as a stored entry would read, or null. */
export function standingCover(date) {
  const email = COVERS[turnOf(date)]
  const person = email && STAFF.find(p => p.email === email)
  return person ? { email: person.email, name: person.name, firstName: person.firstName, setBy: 'rota change, 5 Nov 2026' } : null
}

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
