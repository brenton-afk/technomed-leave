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
