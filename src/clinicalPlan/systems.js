// ─── The implant systems TechnoMed carries ────────────────────────────────────
// One list, because the case plan has to recognise a system name wherever it is
// written — in a booking's title, in its notes, or both — and there is no way to
// do that by position alone.
//
// Position was the previous approach and it could not hold. A title is free text
// typed in a hurry: "Panthi SHORELINE - Gupta" with a note reading "C4/5 ACDF
// Shoreline", "Panthi C4/5 ACDF SHORELINE - Gupta" with "consignment" on the end,
// "Kit: Dakota (loan)" versus "DAKOTA loan kit". Guessing which words are the
// operation and which are the system from where they sit produced a different
// answer for each of those, so the plan read differently case to case and printed
// the system twice whenever the notes happened to repeat it.
//
// Knowing the names removes the guess. Whatever the layout, "Shoreline" is the
// system and what remains is the operation.
//
// Adding a system means adding one line here. Anything unrecognised still shows —
// it falls back to reading the title by position — so a new system appears on the
// plan on the day it is first booked, just without the tidying.

/**
 * Canonical name, and how it might be written. `name` is what the plan shows, so
 * it should read the way the team says it out loud.
 */
export const SYSTEMS = [
  { name: 'Mariner', test: /\bmariners?\b/i },
  { name: 'Shoreline', test: /\bshorelines?\b/i },
  // Dakota-2 is a distinct set, and the hyphen is part of the name.
  { name: 'Dakota-2', test: /\bdakota\s*-?\s*2\b/i },
  { name: 'Dakota', test: /\bdakota\b/i },
  { name: 'Reform Cervical', test: /\breform\s+cerv(?:ical)?\b/i },
  { name: 'Reform Lumbar', test: /\breform\s+lumbar\b/i },
  { name: 'Reform', test: /\breform\b/i },
  { name: 'Ascot', test: /\bascot\b/i },
  { name: 'Athlet', test: /\bathlet\b/i },
  { name: 'Diplomat', test: /\bdiplomat\b/i },
  { name: 'Mobis', test: /\bmobis\b/i },
  { name: 'E4 Global ALIF', test: /\be4\s*(?:global\s*)?alif\b/i },
  { name: 'E4 Global PLIF', test: /\be4\s*(?:global\s*)?plif\b/i },
  { name: 'E4 Cages', test: /\be4\b(?:\s*global)?(?:\s*cages?)?/i },
  { name: 'Lonestar', test: /\blone\s*star\b/i },
  { name: 'Stryker CCI', test: /\bstryker\s*cci\b/i },
  { name: 'Stryker PSI', test: /\bstryker\s*psi\b/i },
  { name: 'Stryker', test: /\bstryker\b/i },
  { name: 'Orthofix Connectors', test: /\borthofix\s*connectors?\b/i },
  { name: 'Orthofix', test: /\borthofix\b/i },
  { name: 'Boost', test: /\bboost\b/i },
  { name: 'Signus', test: /\bsignus\b/i }
]

/**
 * TechnoMed's own loan sets. These are kit a rep has to physically bring, not the
 * implant system going into the patient, so they belong on the kit line and must
 * never be mistaken for the system.
 */
export const LOAN_SETS = [
  { name: 'TM Locking Distractor', test: /\b(?:tm\s*)?locking\s*distractor\b/i },
  { name: 'TM Screw Removal', test: /\b(?:tm\s*)?screw\s*removal\b/i },
  { name: 'TM Long Term Loan', test: /\b(?:tm\s*)?long\s*term\s*loan\b/i }
]

/**
 * Every system named in a piece of text, most specific first.
 *
 * Order matters: "Reform Cervical" is tested before "Reform" and "Dakota-2"
 * before "Dakota", so the more specific name wins and the looser one does not
 * also match the same words.
 */
export function findSystems(text) {
  const haystack = String(text || '')
  if (!haystack.trim()) return []

  const found = []
  let remaining = haystack
  for (const system of SYSTEMS) {
    const match = system.test.exec(remaining)
    if (!match) continue
    found.push({ name: system.name, matched: match[0], index: haystack.indexOf(match[0]) })
    // Blank out what matched so a looser pattern cannot claim the same words.
    remaining = remaining.replace(match[0], ' '.repeat(match[0].length))
  }
  return found.sort((a, b) => a.index - b.index)
}

/** Every TechnoMed loan set named in a piece of text. */
export function findLoanSets(text) {
  const haystack = String(text || '')
  return LOAN_SETS.filter(set => set.test.test(haystack)).map(set => set.name)
}

/**
 * The individual words belonging to the systems named in a text, so they can be
 * removed from an operation description without touching the clinical part of it.
 */
export function systemWords(text) {
  const words = new Set()
  for (const system of findSystems(text)) {
    for (const word of system.matched.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word) words.add(word)
    }
  }
  return words
}

/**
 * Image guidance and navigation platforms.
 *
 * A case using one of these is a different kind of day: the platform has to be
 * booked, set up and calibrated, and whoever is covering needs to see that at a
 * glance rather than read for it. So these override the surgeon's colour — the
 * one thing on the plan that is allowed to.
 */
// "Curve" as a shape rather than a platform: preceded by a region or a
// descriptor, or followed by the thing you do to a deformity.
const CURVE_IS_ANATOMY =
  /\b(?:cervical|thoracic|thoracolumbar|lumbar|sagittal|coronal|scoliotic|kyphotic|lordotic|main|major|minor|primary|secondary|structural|fractional|compensatory)\s+curve\b|\bcurve\s+(?:correction|progression|magnitude)\b/i

export const NAVIGATION = [
  {
    name: 'AIRO',
    // Not only the word. Every RHH case putting in pedicle screws or lateral
    // mass screws has AIRO CT and navigation support by definition, so the
    // booking rarely says so — it says what is being implanted.
    //
    // "Lateral mass" and "Reform Cervical" are the same thing: Reform Cervical
    // screws *are* lateral mass screws. They are both listed because a booking
    // may name the anatomy or the product, not because they are two signals —
    // so neither is redundant and removing one would lose half the bookings.
    test: /\bairo\b|\bpedicle\s+screws?\b|\blateral\s+mass\b|\breform\s+cervical\b/i
  },
  {
    name: 'Curve',
    // The Varioguide needle biopsies and the cranial registrations. Varioguide
    // is a Curve application, so it earns the Curve badge rather than one of its
    // own — the badge is meant to say which platform has to be set up.
    test: /\bcurve\b|vario\s*guide/i,
    // "Curve" is also ordinary spinal language. A scoliosis correction is a
    // deformity, not a navigation platform, and painting it blueberry would say
    // a platform needs booking when it does not. Varioguide is exempt: it names
    // the platform outright.
    notWhen: text => CURVE_IS_ANATOMY.test(text) && !/vario\s*guide/i.test(text)
  },
  {
    name: 'Brainlab',
    // The vendor rather than a platform. Only shown when the booking has not
    // said which one, so a case does not carry both "AIRO" and "Brainlab".
    test: /brain\s*lab/i,
    onlyIfNothingElse: true
  }
]

/** The navigation platforms named in a piece of text. */
export function findNavigation(text) {
  const haystack = String(text || '')
  const excluded = n => {
    if (!n.notWhen) return false
    return typeof n.notWhen === 'function' ? n.notWhen(haystack) : n.notWhen.test(haystack)
  }
  const found = NAVIGATION.filter(n => n.test.test(haystack) && !excluded(n))
  const named = found.filter(n => !n.onlyIfNothingElse)
  return (named.length ? named : found).map(n => n.name)
}


/**
 * Which E4 product a bare "E4" on a kit line means.
 *
 * The RHH lists write "Diplomat + E4" and "Mariner + E4", which names a
 * distributor but not a product — E4 supply Global BMD PLIF, Global BMD ALIF,
 * Dakota and Reform Cervical, and a loan request has to say which.
 *
 * Alongside Diplomat or Mariner it is a PLIF, so the cages are Global BMD PLIF.
 * Both of those are posterior lumbar constructs; the E4 part is the interbody
 * that goes with them. Confirmed by Brent, 23 September.
 *
 * Only where the line does not already name an E4 product, and only where one of
 * those two systems is present. A bare "E4" on its own stays ambiguous and
 * reaches the review queue as a question, which is the right outcome: guessing a
 * product here means a tray arriving that nobody can use.
 */
const NAMES_AN_E4_PRODUCT = /global\s*bmd|dakota|reform/i
const IMPLIES_PLIF = /\b(?:diplomat|mariner)\b/i

export function resolveE4Product(kit) {
  const text = String(kit || '')
  if (!/\be4\b/i.test(text)) return null
  if (NAMES_AN_E4_PRODUCT.test(text)) return null
  return IMPLIES_PLIF.test(text) ? 'Global BMD PLIF' : null
}

/**
 * The systems a kit line names, with a bare "E4" resolved where it can be.
 *
 * Used when turning an ingested booking into something orderable: the line as
 * written is kept for display, and this is what the loan logic and the
 * distributor routing work from.
 */
export function systemsInKit(kit) {
  const text = String(kit || '')
  // Through findSystems, which already knows every system's spellings and stops
  // a looser pattern claiming words a more specific one matched.
  const found = findSystems(text).map(s => s.name)
  const e4 = resolveE4Product(text)
  if (!e4) return found
  // "E4 Cages" is what a bare "E4" matches; alongside Diplomat or Mariner the
  // product is known, so name it.
  return found.map(name => (name === 'E4 Cages' ? e4 : name))
}
