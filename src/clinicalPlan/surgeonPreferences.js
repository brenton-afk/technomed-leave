// ─── Which system this surgeon uses for that operation ───────────────────────
// "...and then cross reference against surgeon preferences."
//
// procedureImplants.js answers the clinical half: a PLIF means an interbody
// cage and pedicle screws, whoever is operating. This file answers the half
// that is ours — which of our systems that surgeon actually wants — and the two
// are kept apart on purpose, because they are known with very different
// confidence.
//
// ── Where this comes from ──
//
// Dictated, not deduced. The preference cards in the app are written for people
// to read and nothing in them is machine-readable, and deriving a table from
// past bookings would learn our mistakes along with our habits: every booking
// where the wrong kit was sent is a vote for sending it again.
//
// So each row is somebody saying it. The `since` field records when, because a
// preference that has not been confirmed in a year is a preference somebody
// should check rather than one the app should assert.
//
// ── Why it is safe for this to be empty ──
//
// It starts empty, and everything built on it is written to behave sensibly
// with no rows at all: the booking still raises the question "this is an ACDF
// and no kit is named", it simply cannot propose an answer. A half-filled table
// is the ordinary state of this file, not a broken one.

/**
 * One surgeon, one operation, one system.
 *
 * @typedef {object} Preference
 * @property {string}  surgeon  as the app spells it — see SURGEON_KEYS
 * @property {string}  acronym  as procedureImplants.js spells it
 * @property {string}  system   as the inventory spells it
 * @property {string}  [hospital] where the answer differs by site
 * @property {string}  [note]   anything a person would want to read
 * @property {string}  since    yyyy-mm-dd, when this was last confirmed
 */

/** @type {Preference[]} */
export const SURGEON_PREFERENCES = [
  // Awaiting Brent. The shape, for when the list arrives:
  //
  //   { surgeon: 'Ibbett', acronym: 'ACDF', system: 'Dakota', since: '2026-10-09' },
  //   { surgeon: 'Gupta',  acronym: 'PLIF', system: 'Mariner',
  //     note: 'with Global BMD PLIF cages', since: '2026-10-09' },
  //
  // A row per combination that is genuinely settled. Anything that varies case
  // by case is better left out than written down as though it were a rule —
  // see preferenceFor: no row means the app asks, which is the right outcome
  // for a question that really does need asking.
]

/**
 * What this surgeon uses for this operation, or null.
 *
 * Null rather than a near-miss. "Nobody has recorded this" and "somebody else
 * uses a Dakota for it" are different answers, and only one of them belongs in
 * front of a person packing a car at seven in the morning.
 *
 * A hospital-specific row beats a general one, since that is the more specific
 * statement of the same preference.
 */
export function preferenceFor(surgeon, acronym, hospital) {
  const who = String(surgeon || '').trim().toLowerCase()
  const what = String(acronym || '').trim().toLowerCase()
  if (!who || !what) return null

  const matches = SURGEON_PREFERENCES.filter(p =>
    String(p.surgeon).toLowerCase() === who
    && String(p.acronym).toLowerCase() === what)
  if (!matches.length) return null

  const site = String(hospital || '').trim().toLowerCase()
  return matches.find(p => p.hospital && String(p.hospital).toLowerCase() === site)
    || matches.find(p => !p.hospital)
    || null
}

/** Every recorded preference for one surgeon, for their card. */
export function preferencesForSurgeon(surgeon) {
  const who = String(surgeon || '').trim().toLowerCase()
  if (!who) return []
  return SURGEON_PREFERENCES.filter(p => String(p.surgeon).toLowerCase() === who)
}

/** Whether anybody has recorded anything for this surgeon at all. */
export function hasRecordedPreferences(surgeon) {
  return preferencesForSurgeon(surgeon).length > 0
}
