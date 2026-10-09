// ─── What an operation tells you about the implants ──────────────────────────
// "I want a rule set that if the operation description includes acronyms like
// ALIF, PLIF, ACDF, the portal should know that the implants will be required
// to correspond with that booking request and then cross reference against
// surgeon preferences. We have to build the knowledge in the app back end so it
// can deduce better from non-descript information in the booking."
//
// A booking often says what is being done and not what is going in. "C5/6 ACDF"
// names no system at all, and every reader in the office knows it means a cage
// and a plate — but the app did not, so the case arrived with an empty kit line
// and nothing to arrange from.
//
// The acronym is the most reliable thing on a booking. It survives being typed
// in a hurry, it is the same word at both hospitals, and it is written by the
// surgeon's rooms rather than reconstructed by us. So it is what this reads.
//
// ── Two separate claims, kept separate ──
//
// This file holds one of them: what the operation implies is needed. It is
// clinical and it is the same whoever is operating — a PLIF is an interbody
// cage and posterior screws regardless of which consultant books it.
//
// The other claim — *which* of our systems this surgeon uses for that operation
// — is surgeon preference. It lives in surgeonPreferences.js and it is nobody's
// to deduce. Keeping them apart matters: the first can be stated confidently,
// and the second is only ever as good as what the team has recorded.

/**
 * The operations that always carry implants, and what kind.
 *
 * `needs` is in the office's own words rather than a product name, because the
 * product depends on the surgeon and the hospital and this does not.
 *
 * Longest acronym first where two overlap, so ACDF is never read as part of a
 * longer string and TLIF is not taken for a bare LIF.
 */
export const IMPLANT_PROCEDURES = [
  {
    acronym: 'ACDF',
    // Anterior cervical discectomy and fusion. A cage in the disc space and,
    // nearly always, a plate across the front.
    test: /(?:^|[^a-z])acdf/i,
    region: 'cervical',
    needs: 'cervical cage and plate'
  },
  {
    acronym: 'ACCF',
    // Corpectomy rather than discectomy: the body comes out, so it is a cage
    // or a strut and a longer plate. Davie's booking in October was one.
    test: /(?:^|[^a-z])accf/i,
    region: 'cervical',
    needs: 'corpectomy cage and plate'
  },
  {
    acronym: 'ALIF',
    // From the front. No posterior screws implied — that is the distinction
    // the AIRO badge turns on as well, and getting it wrong books a scanner.
    test: /(?:^|[^a-z])alif/i,
    region: 'lumbar',
    needs: 'anterior lumbar interbody cage'
  },
  {
    acronym: 'PLIF',
    test: /(?:^|[^a-z])plif/i,
    region: 'lumbar',
    needs: 'lumbar interbody cage and pedicle screws'
  },
  {
    acronym: 'TLIF',
    test: /(?:^|[^a-z])tlif/i,
    region: 'lumbar',
    needs: 'lumbar interbody cage and pedicle screws'
  },
  {
    acronym: 'XLIF',
    // Lateral, through psoas. Still a cage, still usually screws.
    test: /(?:^|[^a-z])(?:x|d|o)lif/i,
    region: 'lumbar',
    needs: 'lateral interbody cage'
  },
  {
    acronym: 'PSF',
    test: /(?:^|[^a-z])psf\b|posterior\s+spinal\s+fusion/i,
    region: 'lumbar',
    needs: 'pedicle screws and rods'
  },
  {
    acronym: 'ADR',
    // Disc replacement. A prosthesis, and never a fusion construct — worth
    // separating because the kit is nothing like the others.
    test: /(?:^|[^a-z])adr\b|(?:artificial|total)\s+disc\s+(?:replacement|arthroplasty)/i,
    region: 'cervical',
    needs: 'disc prosthesis'
  },
  {
    acronym: 'Laminectomy',
    // The exception that proves the rule: a decompression on its own carries
    // no implants. Listed so that it is *recognised* and deliberately not
    // flagged, rather than falling through as an unknown operation.
    test: /laminectom|decompress|discectom(?!.*fusion)|microdiscectom/i,
    region: null,
    needs: null
  }
]

// Written in full instead of the acronym. The rooms do this as often as not,
// and a rule that only reads acronyms misses half of what it is for.
const SPELLED_OUT = [
  { test: /anterior\s+cervical\s+discectomy/i, acronym: 'ACDF' },
  { test: /anterior\s+cervical\s+corpectomy/i, acronym: 'ACCF' },
  { test: /anterior\s+lumbar\s+interbody/i, acronym: 'ALIF' },
  { test: /posterior\s+lumbar\s+interbody/i, acronym: 'PLIF' },
  { test: /transforaminal\s+(?:lumbar\s+)?interbody/i, acronym: 'TLIF' },
  { test: /lateral\s+(?:lumbar\s+)?interbody/i, acronym: 'XLIF' },
  { test: /posterior\s+spinal\s+fusion/i, acronym: 'PSF' }
]

/**
 * The implant-bearing operations named in a piece of text.
 *
 * Returns the matched entries, in the order they are listed. An operation that
 * carries no implants — a laminectomy — is recognised and returned with
 * `needs: null`, which is a different answer from not recognising it at all.
 */
export function findImplantProcedures(text) {
  const haystack = String(text || '')
  if (!haystack.trim()) return []

  const hit = new Set()
  for (const entry of IMPLANT_PROCEDURES) {
    if (entry.test.test(haystack)) hit.add(entry.acronym)
  }
  for (const spelled of SPELLED_OUT) {
    if (spelled.test.test(haystack)) hit.add(spelled.acronym)
  }
  return IMPLANT_PROCEDURES.filter(e => hit.has(e.acronym))
}

/**
 * Whether this operation means implants are going in.
 *
 * False for a laminectomy, and false for an operation nobody here recognises.
 * The second is deliberate: a booking reading "exploration of wound" should
 * not raise a question about kit, and the way to be sure of that is to answer
 * only about the operations actually written down above.
 */
export function impliesImplants(text) {
  return findImplantProcedures(text).some(e => e.needs)
}

/**
 * What the operation says is needed, in one phrase.
 *
 * "C5/6 ACDF and L4/5 PLIF" is a real booking shape, and it needs both
 * answers — the two halves are ordered from two different distributors.
 */
export function impliedNeeds(text) {
  const needs = findImplantProcedures(text).map(e => e.needs).filter(Boolean)
  return [...new Set(needs)].join(', ') || null
}
