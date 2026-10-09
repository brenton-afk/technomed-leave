// ─── Deducing the kit from a booking that did not name one ───────────────────
// "We have to build the knowledge in the app back end so it can deduce better
// from non-descript information in the booking."
//
// Three things are now known separately and have never been put together:
//
//   · what the operation implies    procedureImplants.js — a PLIF is a cage
//                                   and screws, whoever is operating
//   · which system this surgeon      surgeonPreferences.js — dictated, never
//     uses for it                    inferred
//   · what the booking actually      systems.js / kitSupply.js — what the team
//     named                          wrote on the kit line
//
// This asks the one question that falls out of all three: the operation needs
// implants, and nothing on this booking says which.
//
// ── It asks. It does not answer. ──
//
// Nothing here writes to a booking. The deduction becomes a question on the
// card that somebody taps to confirm, in the same way an inferred supply is
// shown with a "?" rather than quietly recorded. The reason is the cost of
// being wrong in each direction: an unanswered question is a conversation at
// half past seven, and a wrong answer written in as fact is a tray arriving
// from Melbourne that nobody can use, discovered in the theatre.
//
// Deducing is also the thing this app has been wrong about most often. Every
// one of those — La Pietra, the dropped "removal", the Mariner nobody needed
// — was the app being confident instead of being useful.

import { findSystems } from './systems.js'
import { findImplantProcedures } from './procedureImplants.js'
import { preferenceFor, hasRecordedPreferences } from './surgeonPreferences.js'

/**
 * The implant question a booking raises, or null when it raises none.
 *
 * Null in three quite different situations, all of which are fine:
 *   · the operation carries no implants — a laminectomy, a washout
 *   · the operation is not one this app has knowledge of
 *   · the booking already names a system, so there is nothing to ask
 *
 * @param {object} surgicalCase as the plan holds it
 * @returns {null | {
 *   acronyms: string[],     what was recognised — ['PLIF']
 *   needs: string,          'lumbar interbody cage and pedicle screws'
 *   suggestion: string|null the system, where a preference is recorded
 *   surgeon: string|null    whose preference it is
 *   note: string|null       anything written alongside that preference
 *   asked: string           the question, in words, for the card
 * }}
 */
export function implantQuestion(surgicalCase) {
  if (!surgicalCase) return null
  // A case that is off, or one somebody has said we are not needed on, is not
  // a case anybody is packing for.
  if (surgicalCase.cancelled || surgicalCase.notRequired) return null

  // What the booking already says. Both fields, because the two conventions in
  // the calendar put the system in different places.
  const named = [surgicalCase.system, surgicalCase.kit].filter(Boolean).join(' ')
  if (findSystems(named).length) return null

  const operation = [surgicalCase.operation, surgicalCase.kit]
    .filter(Boolean).join(' ')
  const found = findImplantProcedures(operation).filter(e => e.needs)
  if (!found.length) return null

  const acronyms = found.map(e => e.acronym)
  const needs = [...new Set(found.map(e => e.needs))].join(', ')

  // The surgeon's own answer, where somebody has recorded one. Only where a
  // single operation was recognised: "ACDF and PLIF" on one booking is two
  // preferences and two systems, and running them together would propose one
  // kit for an operation that needs two.
  const preference = found.length === 1
    ? preferenceFor(surgicalCase.surgeon, found[0].acronym, surgicalCase.hospital)
    : null

  return {
    acronyms,
    needs,
    suggestion: preference?.system || null,
    surgeon: preference ? surgicalCase.surgeon : null,
    note: preference?.note || null,
    asked: questionFor(acronyms, needs, preference, surgicalCase.surgeon)
  }
}

/**
 * The question as somebody reads it on a card.
 *
 * Three shapes, because there are three states of knowledge and flattening
 * them into one sentence would make the strongest and the weakest look alike:
 *
 *   PLIF — Mariner?                 we know whose case it is and what they use
 *   PLIF — no kit named             we know the operation, not their preference
 *   PLIF — no kit named (nothing    we know the operation, and nobody has ever
 *   recorded for Gupta)             written down what this surgeon uses
 *
 * The third is the one worth saying out loud. It is not a gap in the booking,
 * it is a gap in what the office has recorded, and it will not close by itself.
 */
function questionFor(acronyms, needs, preference, surgeon) {
  const what = acronyms.join(' + ')
  if (preference) return `${what} — ${preference.system}?`
  if (surgeon && !hasRecordedPreferences(surgeon)) {
    return `${what} — no kit named (nothing recorded for ${surgeon})`
  }
  return `${what} — no kit named, needs ${needs}`
}
