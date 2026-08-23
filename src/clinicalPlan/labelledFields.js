// ─── Labelled fields in a booking's description ───────────────────────────────
// A booking's notes carry the case as labelled lines:
//
//   Surgeon: Fowler
//   Patient: Jackson
//   Procedure: C5/6 ACDF
//   Kit: Dakota (Consignment)
//   Hospital: RHH
//
// This is far better than anything that can be inferred from a title, and reading
// it removes most of the guesswork the plan used to do. What it does not remove is
// the variation: the same field is written "Surgeon:", "Surg:", "surg:" depending
// on who typed it and how much of a hurry they were in. So every label is matched
// by all of its known spellings, case-insensitively, and a field that cannot be
// read is reported as absent rather than guessed at — a line of raw notes on a
// case card is worse than no line, because it looks like data.

/**
 * Every label, and every way it gets written. Order within a field does not
 * matter; the alternatives are matched as a set.
 */
export const LABELS = {
  surgeon: ['surgeon', 'surg'],
  patient: ['patient', 'pt'],
  procedure: ['procedure', 'surgery', 'operation', 'op'],
  kit: ['kit'],
  hospital: ['hospital', 'hosp']
}

// Longest first, so "Procedure" is not matched as "Proc" and "Surgeon" is never
// read as "Surg" with "eon" left over as the value.
const ALL_LABELS = Object.entries(LABELS)
  .flatMap(([field, names]) => names.map(name => ({ field, name })))
  .sort((a, b) => b.name.length - a.name.length)

// A label has to be preceded by the start of the text, a separator, or
// whitespace. That requirement doubles as a word boundary, which is what stops
// "Postop:" being read as the "op:" label with "Post" left over.
const LABEL_PATTERN = new RegExp(
  `(?:^|[\\n\\r|;•·]|\\s+)(${ALL_LABELS.map(l => l.name).join('|')})\\s*[:\\-–]\\s*`,
  'gi')

/**
 * Reads the labelled fields out of a description.
 *
 * A value runs from its label to whichever comes first: the next label, or the
 * end of the line. The end-of-line boundary matters — without it "Kit: Dakota
 * (Consignment)" followed by a line of unrelated logistics prose would swallow
 * the prose into the kit.
 *
 * @returns {{surgeon?, patient?, procedure?, kit?, hospital?}} raw values, trimmed
 */
export function parseLabelledDescription(description) {
  const text = String(description || '').replace(/\r\n?/g, '\n')
  if (!text.trim()) return {}

  const found = []
  LABEL_PATTERN.lastIndex = 0
  let match
  while ((match = LABEL_PATTERN.exec(text)) !== null) {
    const label = ALL_LABELS.find(l => l.name === match[1].toLowerCase())
    // `at` is where the label itself begins and `from` where its value does. Both
    // are needed: a value ends where the *next label* starts, not where the next
    // value starts, or it swallows that label's name.
    if (label) found.push({ field: label.field, at: match.index, from: match.index + match[0].length })
    // Step back one so two labels separated by a single delimiter both match.
    LABEL_PATTERN.lastIndex = match.index + match[0].length
  }
  if (!found.length) return {}

  const out = {}
  for (let i = 0; i < found.length; i++) {
    const { field, from } = found[i]
    const nextLabel = i + 1 < found.length ? found[i + 1].at : text.length
    const lineEnd = text.indexOf('\n', from)
    const to = Math.min(
      nextLabel === text.length ? text.length : nextLabel,
      lineEnd === -1 ? text.length : lineEnd)
    const value = text.slice(from, to)
      // Trailing delimiters left by the next label's own separator.
      .replace(/[\s|;•·,]+$/, '')
      .trim()
    // First one wins: a field repeated later in the notes is a correction below a
    // heading more often than it is a second case.
    if (value && !out[field]) out[field] = value
  }
  return out
}

/**
 * Splits a Kit field into the implant system and how it is supplied.
 *
 *   "Dakota (Consignment)"  ->  { system: 'Dakota', type: 'Consignment' }
 *   "Mariner (Loan)"        ->  { system: 'Mariner', type: 'Loan' }
 *
 * The bracket is the convention, so it is what is read. Where it is missing the
 * supply word is still looked for in the text, because "Dakota consignment" is a
 * reasonable thing to type and losing the supply is worse than being strict.
 */
export function parseKitField(kit) {
  const text = String(kit || '').trim()
  if (!text) return { system: undefined, type: undefined }

  const bracketed = /^([^([{]*)[([{]([^)\]}]*)[)\]}]?\s*$/.exec(text)
  if (bracketed) {
    const system = bracketed[1].trim().replace(/[\s,\-–]+$/, '')
    return {
      system: system || undefined,
      type: normaliseSupply(bracketed[2]) || undefined
    }
  }

  // No brackets. Take a trailing supply word off the end if there is one.
  const trailing = /^(.*?)[\s,\-–]*\b(?:on\s+)?(consignment|consigned|loan(?:ed)?(?:\s+(?:kit|set))?)\s*$/i.exec(text)
  if (trailing) {
    return {
      system: trailing[1].trim() || undefined,
      type: normaliseSupply(trailing[2]) || undefined
    }
  }
  return { system: text, type: undefined }
}

/** "on consignment", "LOAN KIT" and "Loaned" all mean one of two things. */
function normaliseSupply(raw) {
  const text = String(raw || '').trim()
  if (!text) return undefined
  if (/consign/i.test(text)) return 'Consignment'
  if (/\bloan/i.test(text)) return 'Loan'
  // Something else in the brackets — "(PM list)", "(2 levels)". Kept as written,
  // since the team put it there on purpose.
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * The short hospital code used to group a day's cases.
 *
 * Grouping only — a card sits under its hospital heading, so repeating it on the
 * card itself says the same thing twice.
 */
export function hospitalCode(value) {
  const text = String(value || '')
  if (/calvary|lenah/i.test(text)) return 'CLV'
  if (/\brhh\b|royal\s*hobart/i.test(text)) return 'RHH'
  if (/\bclv\b/i.test(text)) return 'CLV'
  const trimmed = text.trim()
  // An unrecognised hospital still groups, under whatever it was called.
  return trimmed ? trimmed.toUpperCase().slice(0, 12) : undefined
}
