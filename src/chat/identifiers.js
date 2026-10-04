// ─── Noticing a patient identifier before it is sent ─────────────────────────
// Everywhere else in this app, identifiers are stripped: a date of birth typed
// into a booking never reaches the screen, and a surname is cut to one token. A
// chat cannot work that way. Rewriting what somebody wrote is not a scanner
// tidying a field — it is changing what a person said, and they would have no
// way of knowing.
//
// So this warns and does not block. The message sends either way. At seven in
// the morning with a rep on the phone, standing between somebody and sending is
// the wrong trade, and a warning that can be tapped past still does the work: it
// puts the rule in front of the person at the moment they are breaking it, which
// is the only moment anybody learns it.
//
// What it must not do is cry wolf. A warning on every second message is one
// people stop reading, and then it is worse than nothing — so these patterns are
// narrow and each one is tested against the things the team actually types.

const PATTERNS = [
  {
    kind: 'dob',
    // 12/3/1958, 12-03-58, 1958-03-14. Deliberately requires a year of two or
    // four digits so "L4/5" and "C5/6" never match.
    test: /\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b|\b(?:19|20)\d{2}-\d{2}-\d{2}\b/,
    says: 'a date of birth'
  },
  {
    kind: 'ur',
    // A run of five or more digits. Theatre numbers, levels and set counts are
    // all shorter; a UR number is longer.
    test: /\b\d{5,}\b/,
    says: 'a UR or MRN number'
  },
  {
    kind: 'labelled',
    test: /\b(?:DOB|MRN|URN?)\b\s*[:#]?/i,
    says: 'a labelled identifier'
  }
]

// ── Full names ──
//
// Only where something in the sentence says "this is a patient". The obvious
// rule — two capitalised words in a row — reads "X-Core Mini", "Global
// Biomedica", "Reform Cervical", "Lenah Valley" and half the trade as patient
// names, and a warning that fires on every second message is one people stop
// reading. Precision beats recall for a warning that has to stay credible.
//
// The cost is real and deliberate: "Rowe John is second up" does not warn.
// Nothing is lost that the other patterns catch — a date of birth and a UR
// number are the identifiers that actually matter, and they are matched on
// their own shape rather than on context.
const NAME_AFTER = [
  // "Mr David Pennant", "Dr Jane Smith"
  /\b(?:mr|mrs|ms|miss|master|dr)\.?\s+[A-Z][a-z]+\s+[A-Z][a-z]+/i,
  // "Pt Rowe John", "Patient: Rowe John"
  // `[\s:]+` rather than `\s*:?\s+`, which needed a space on both sides of an
  // optional colon and so missed "Pt Rowe John" — the commonest form of all.
  /\b(?:pt|patient)\b[\s:]+[A-Z][a-z]+\s+[A-Z][a-z]+/i
]

function looksLikeAFullName(text) {
  return NAME_AFTER.some(p => p.test(String(text)))
}

/**
 * What in this message looks like a patient identifier.
 *
 * @returns {{kind: string, says: string}[]} empty when there is nothing to say
 */
export function identifiersIn(text) {
  const message = String(text || '')
  if (!message.trim()) return []

  const found = PATTERNS.filter(p => p.test.test(message)).map(({ kind, says }) => ({ kind, says }))
  if (looksLikeAFullName(message)) found.push({ kind: 'name', says: 'a patient’s full name' })
  return found
}

/** The warning itself, as a sentence somebody will actually read. */
export function identifierWarning(text) {
  const found = identifiersIn(text)
  if (!found.length) return null
  const list = found.map(f => f.says)
  const last = list.pop()
  const what = list.length ? `${list.join(', ')} and ${last}` : last
  return `That looks like ${what}. Surnames only is the rule everywhere else in the app.`
}
