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
  // Reform on its own means the cervical set. E4 Reform Posterior Cervical
  // Lateral Mass Screws is its full name and nobody writes that — it is
  // "Reform", "Reform Cervical" or "E4 Reform" on a booking, and all three are
  // the one consignment kit at RHH.
  //
  // It used to detect as a system called "Reform", which the inventory has
  // never heard of — the inventory calls it Reform Cervical — so a booking
  // saying "Reform" came back "not a listed system" about a kit sitting on the
  // shelf. Same fault as E4 Global PLIF against Global BMD PLIF: two names for
  // one thing, and the detector using the one the inventory does not.
  //
  // Lumbar is tested first, because it is the one case where the bare word is
  // not the cervical set.
  { name: 'Reform Lumbar', test: /\breform\s+lumbar\b/i },
  { name: 'Reform Cervical', test: /\breform\b/i },
  { name: 'Ascot', test: /\bascot\b/i },
  { name: 'Athlet', test: /\bathlet\b/i },
  { name: 'Diplomat', test: /\bdiplomat\b/i },
  { name: 'Mobis', test: /\bmobis\b/i },
  // Named as the inventory names them. They were "E4 Global PLIF" here and
  // "Global BMD PLIF" there, so a booking that spelled the product out matched
  // nothing at all — no loan verdict, no clash check, on every PLIF that named
  // its cage properly. Two naming schemes for one product, and neither side
  // knew about the other.
  { name: 'Global BMD ALIF', test: /\b(?:e4\s*)?global\s*(?:bmd\s*)?alif\b/i },
  { name: 'Global BMD PLIF', test: /\b(?:e4\s*)?global\s*(?:bmd\s*)?plif\b/i },
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

// ─── What means a case needs the AIRO ────────────────────────────────────────
// "Any reference to PLIF means the case requires AIRO. This can't be missed."
//
// So each signal is listed separately rather than crammed into one expression,
// because the ones that matter are easy to lose in a wall of alternation.
//
// A missed badge and a wrongly added one are not equally bad. A wrong badge
// books a scanner and a radiographer nobody needs, and somebody notices that
// morning. A missed one means the surgeon has no navigation for screws already
// in a patient. These lean towards catching it.
const AIRO_SIGNALS = [
  // The platform, named outright.
  /\bairo\b/,

  // What is being implanted. "Lateral mass" and "Reform Cervical" are the same
  // thing — Reform Cervical screws *are* lateral mass screws — and both are
  // listed because a booking may name the anatomy or the product.
  //
  // `pedicle` on its own, not `pedicle screws`. Cramond's booking on 28
  // September read "T10-L2 Pedicle Fixation for T12 Fracture" and carried no
  // badge, because the pattern insisted on the word "screws" and the surgeon
  // had no reason to write it. Nothing gets fixed to a pedicle without screws,
  // so the anatomy alone is the signal.
  /\bpedicle\b/,
  /\blateral\s+mass\b/,
  /\breform\s+cervical\b/,

  // Screws named by their type rather than their site. The same booking said
  // "Kit: Mariner (Monoaxial Screws)" — a second missed signal on one case.
  /\b(?:mono|poly)axial\s+screws?\b/,

  // The system, where the system *is* a pedicle screw system. A booking always
  // names its kit, even when the procedure line is a fracture level and nothing
  // else, so this is the signal most likely to still be there when the others
  // are not.
  /\bmariner\b/,
  /\bdiplomat\b/,
  /\bfirebird\b/,

  // The procedures that go in over pedicle screws, whether or not the booking
  // ever says "screws". One that reads "L4/5 PLIF" usually does not — the
  // screws are assumed by anyone reading it clinically.
  //
  // `[pt]lif` takes PLIF and TLIF and leaves ALIF and DLIF, which are
  // approached from the front and the side and are not instrumented from
  // behind. One letter apart, and the wrong call is an AIRO nobody needs.
  //
  // Deliberately NOT \b-anchored at either end. A trailing boundary loses
  // "PLIFs" and "TLIFS"; a leading one loses "L4/5PLIF", written without the
  // space. Instead the character before must not be a letter, which still
  // excludes a word like "uplift" that merely contains the letters.
  /(?:^|[^a-z])[pt]lif/,
  /\bpsf\b/,

  // The same three spelled out. A booking written in full words is still a
  // booking for screws, and the abbreviations are not guaranteed.
  /posterior\s+spinal\s+fusion/,
  /(?:posterior|transforaminal)\s+(?:lumbar\s+)?interbody/
]

export const NAVIGATION = [
  {
    name: 'AIRO',
    test: new RegExp(AIRO_SIGNALS.map(r => r.source).join('|'), 'i')
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

// ─── Navigation is not a kit we supply ───────────────────────────────────────
// "The spinal Brainlab AIRO is only relevant to us in the sense that we need
// the little AIRO badge applied to the booking, but instrument kits are not
// required, so that kind of information when included in the booking can be
// omitted from the instrument requirements — it will not require consignment
// or loan kits so shouldn't be included moving forward."
//
// Oakley's booking from Hana at Calvary carried "Spinal Brainlab" and "AIRO" on
// the kit line, and the portal offered a row of consignment/loan buttons
// against each of them. Nothing can be answered there: the hospital owns the
// scanner, nobody requests one from a distributor and nobody drives one over
// from RHH. The badge is the entire job, and the badge already works.
//
// Deliberately narrow. An entry has to be navigation and nothing else before
// it is dropped — "Mariner + AIRO" is a kit line with a real system on it, and
// AIRO_SIGNALS matches Mariner on purpose, so testing for navigation alone
// would throw the system away with it.

/** Words that name a navigation platform rather than something implanted. */
const NAVIGATION_WORDS =
  /\b(?:airo|brain\s*lab|curve|vario\s*guide|navigation|nav|stealth|o-?arm)\b/gi

/** Words that describe navigation without naming anything of ours. */
const NAVIGATION_FILLER =
  /\b(?:spinal|spine|cranial|cervical|lumbar|system|platform|scanner|support|required|req|and|with|the|for|only|case)\b/gi

/**
 * Whether a kit-line entry is a navigation platform and nothing more.
 *
 * True for "AIRO", "Spinal Brainlab", "Brainlab AIRO", "Curve navigation".
 * False for "Mariner", "Mariner + AIRO", "Reform Cervical" — anything that
 * also names a system, because that is a kit somebody has to produce.
 */
export function isNavigationOnly(name) {
  const text = String(name || '').trim()
  if (!text) return false

  NAVIGATION_WORDS.lastIndex = 0
  if (!NAVIGATION_WORDS.test(text)) return false
  // Something implanted is named here too, so the entry stands.
  if (findSystems(text).length) return false

  const rest = text
    .replace(NAVIGATION_WORDS, ' ')
    .replace(NAVIGATION_FILLER, ' ')
  // Anything left with a letter or a digit in it is a word this does not
  // recognise, and an unrecognised word on a kit line is not something to
  // quietly drop.
  return !/[a-z0-9]/i.test(rest)
}

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
// An E4 product named outright. Nothing to resolve, and resolving anyway would
// turn a Dakota into a PLIF cage.
const NAMES_AN_E4_PRODUCT = /global\s*(?:bmd\s*)?(?:plif|alif)|global\s*bmd|dakota|reform/i
// Pedicle screws either side of it, or the procedure saying so outright. Thani
// writes "E4 cages" and means the Global BMD PLIF cage; on a PLIF there is no
// other E4 product it could be.
const IMPLIES_PLIF = /\b(?:diplomat|mariner|plif)\b/i

/**
 * @param {string} kit
 * @param {string} [context]  the procedure, where the kit line does not say
 *
 * "E4 cages" on its own is still ambiguous and still returns nothing — E4 make
 * four products and picking the wrong one means a tray arriving that nobody can
 * use. But "E4 cages" against "L4/5 PLIF" is not ambiguous at all, and that is
 * how most of these bookings are written.
 */
/**
 * Systems written under another name.
 *
 * Thani writes "Implanet" on a pedicle screw fixation and means Diplomat.
 * Implanet is not a pedicle screw system and we do not carry it, so a booking
 * naming it is a booking naming a product nobody can bring.
 */
const SYSTEM_ALIASES = [
  { written: /\bimplanet\b/gi, means: 'Diplomat' }
]

/**
 * The kit line, resolved: aliases applied and a bare E4 named where the
 * procedure settles which product it is.
 *
 * In one place because it has to run everywhere the kit is shown or written —
 * reading an email, drawing the queue card, accepting onto the calendar, and
 * reading a booking back off it. Doing it only where the email is read fixes
 * the next booking and leaves the one on screen wrong, which is exactly what
 * happened.
 *
 * @param {string} kit
 * @param {string} [context]  the procedure, where the kit line does not say
 */
export function resolveKit(kit, context = '') {
  let text = String(kit || '')
  if (!text.trim()) return text

  for (const { written, means } of SYSTEM_ALIASES) text = text.replace(written, means)

  const e4 = resolveE4Product(text, context)
  if (e4) text = text.replace(/\bE4(?:\s+(?:global\s+)?cages?)?\b/i, e4)

  return text.replace(/\s{2,}/g, ' ').trim()
}

export function resolveE4Product(kit, context = '') {
  const text = String(kit || '')
  if (!/\be4\b/i.test(text)) return null
  if (NAMES_AN_E4_PRODUCT.test(text)) return null
  return IMPLIES_PLIF.test(`${text} ${context}`) ? 'Global BMD PLIF' : null
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
  let found = findSystems(text).map(s => s.name)

  // "E4 Reform" named two systems: the product, and "E4 Cages" from the bare
  // E4 in front of it. So a kit line that said exactly which E4 product it was
  // still asked which E4 product it was — and did it alongside the real
  // answer. Where the line names one outright, the generic match is noise.
  if (found.length > 1 && NAMES_AN_E4_PRODUCT.test(text)) {
    found = found.filter(name => name !== 'E4 Cages')
  }

  const e4 = resolveE4Product(text)
  if (!e4) return found
  // "E4 Cages" is what a bare "E4" matches; alongside Diplomat or Mariner the
  // product is known, so name it.
  return found.map(name => (name === 'E4 Cages' ? e4 : name))
}
