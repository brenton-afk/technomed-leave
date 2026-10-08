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
  hospital: ['hospital', 'hosp'],
  // Recognised so it is consumed, and then ignored: a booking's date is the
  // event's own start time, and the team writing "Date: 22/9/26" in the notes is
  // restating it. Without this it survived as an unclaimed line and would have
  // been shown back to them as a note.
  date: ['date'],
  // Where we are on the hospital's running order — "2nd · afternoon · from 1pm".
  // Read by src/clinicalPlan/listPlace.js, which owns what the line means. Named
  // here so it is consumed rather than repeated underneath the card as prose.
  list: ['list']
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
 * Where each labelled field sits in the description.
 *
 * The same scan `parseLabelledDescription` does, but keeping the offsets instead
 * of throwing them away — which is what makes an edit surgical. Changing the kit
 * rewrites the characters of the kit's value and nothing else.
 */
export function labelledFieldSpans(description) {
  const text = String(description || '').replace(/\r\n?/g, '\n')
  const found = []
  LABEL_PATTERN.lastIndex = 0
  let match
  while ((match = LABEL_PATTERN.exec(text)) !== null) {
    const label = ALL_LABELS.find(l => l.name === match[1].toLowerCase())
    LABEL_PATTERN.lastIndex = match.index + match[0].length
    if (label) found.push({ field: label.field, at: match.index, from: match.index + match[0].length })
  }

  const spans = {}
  for (let i = 0; i < found.length; i++) {
    const { field, at, from } = found[i]
    const nextLabel = i + 1 < found.length ? found[i + 1].at : text.length
    const lineEnd = text.indexOf('\n', from)
    const to = Math.min(nextLabel, lineEnd === -1 ? text.length : lineEnd)
    // First one wins, matching parseLabelledDescription: a field repeated later
    // is a correction under a heading more often than a second case.
    if (!spans[field]) spans[field] = { at, from, to, value: text.slice(from, to) }
  }
  return spans
}

/**
 * Writes one field's value, leaving every other character alone.
 *
 * This is the whole design of editing, and the reason it is not "rebuild the
 * booking from what the portal knows". The portal holds a patient's surname and
 * nothing else, by policy — so regenerating Mitchell's description would write
 * back "Patient: Mitchell" and quietly delete the "(Donna)" that Toni recorded.
 * More generally: the app has been wrong about what a booking contains several
 * times already, and a writer that only touches what it was asked to touch
 * cannot lose the parts it still misunderstands.
 *
 * A field with no label yet is appended on its own line rather than guessed at.
 */
export function setLabelledValue(description, field, value) {
  const text = String(description || '').replace(/\r\n?/g, '\n')
  const span = labelledFieldSpans(text)[field]
  const clean = String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim()

  if (!span) {
    if (!clean) return text
    const label = LABELS[field]?.[0]
    if (!label) return text
    const heading = label.charAt(0).toUpperCase() + label.slice(1)
    const separator = text && !text.endsWith('\n') ? '\n' : ''
    return `${text}${separator}${heading}: ${clean}`
  }

  // The original value's leading whitespace is kept so "Surg:  Fowler" does not
  // silently become "Surg: Fowler" and show up as an edit nobody made.
  const lead = /^\s*/.exec(span.value)[0]
  return text.slice(0, span.from) + lead + clean + text.slice(span.to)
}

/**
 * A patient value with the surname replaced and anything else left alone.
 *
 * "Mitchell (Donna)" with a new surname of "Marsh" becomes "Marsh (Donna)". The
 * portal never shows the first name and must not be the reason it disappears.
 */
export function replaceSurname(existing, surname) {
  const text = String(existing || '').trim()
  const clean = String(surname || '').trim()
  if (!text) return clean
  // Everything after the first token — a parenthetical, a second name, a note.
  const rest = text.replace(/^\S+/, '').trim()
  return rest ? `${clean} ${rest}` : clean
}

/**
 * The parts of the description no label claimed.
 *
 * A booking's notes carry the things that actually shape a day and that no
 * field has a name for: "rebooked from Friday 18/9", "notification received from
 * Toby at 1318hrs", "second loan kit ordered", "entered/amended by Brent". The
 * labelled parser read Surgeon, Patient, Procedure, Kit and Hospital and threw
 * every word of that away — so the app showed a tidy case and the calendar held
 * the reason it was moved.
 *
 * Returned as lines rather than one blob, because that is how they are written:
 * a paragraph per thought, often blank-line separated.
 *
 * Character ranges rather than whole lines, because several labels can share a
 * line — "Surg: Fowler | Pt: Jackson" is a real shape — and dropping the line
 * would lose anything written after them on it.
 */
export function descriptionNotes(description) {
  const text = String(description || '').replace(/\r\n?/g, '\n')
  if (!text.trim()) return []

  const claimed = new Array(text.length).fill(false)
  LABEL_PATTERN.lastIndex = 0
  let match
  while ((match = LABEL_PATTERN.exec(text)) !== null) {
    const label = ALL_LABELS.find(l => l.name === match[1].toLowerCase())
    LABEL_PATTERN.lastIndex = match.index + match[0].length
    if (!label) continue
    const from = match.index + match[0].length
    const lineEnd = text.indexOf('\n', from)
    const to = lineEnd === -1 ? text.length : lineEnd
    for (let i = match.index; i < to; i++) claimed[i] = true
  }

  const kept = []
  let line = ''
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      const trimmed = line.replace(/\s{2,}/g, ' ').trim()
      // Punctuation left behind by a label that shared the line is not a note.
      if (trimmed && /\p{L}/u.test(trimmed) && trimmed.length > 2) kept.push(trimmed)
      line = ''
      continue
    }
    if (!claimed[i]) line += text[i]
  }
  return kept
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

  // A supply marker in brackets anywhere, not only at the end.
  //
  // "Diplomat (Consignment) / Cascadia" is two systems with the supply written
  // after the first. The end-anchored match below could not see it, so the
  // whole string became the system — and the supply was *also* inferred from
  // the same words, so the card read "DIPLOMAT (CONSIGNMENT) / CASCADIA ·
  // Consignment". Saying it twice, which is what the system and kit lines were
  // merged to stop.
  const inline = [...text.matchAll(/[([{]([^)\]}]*)[)\]}]/g)]
  const supplyMark = inline.find(m => KNOWN_SUPPLY.test(m[1]))
  if (supplyMark && supplyMark.index + supplyMark[0].length < text.length) {
    const withoutSupply = text
      // Every supply bracket goes: "Diplomat (consignment) /Cascadia (cons)"
      // names the supply twice and means it once.
      .replace(/[([{][^)\]}]*[)\]}]/g, m => KNOWN_SUPPLY.test(m) ? ' ' : m)
      .replace(/\s{2,}/g, ' ')
      .replace(/\s*([/,])\s*/g, ' $1 ')
      .replace(/^[\s,/\-–]+|[\s,/\-–]+$/g, '')
    return {
      system: withoutSupply || undefined,
      type: normaliseSupply(supplyMark[1]) || undefined
    }
  }

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

// What counts as naming how a kit is supplied. "cons" is in here because the
// team writes it: "Diplomat (consignment) /Cascadia (cons)".
const KNOWN_SUPPLY = /\b(?:consign(?:ment|ed)?|cons|loan(?:ed)?|rhh\s*loan|distributor\s*loan)\b/i

/**
 * "on consignment", "LOAN KIT" and "Loaned" all mean one of a few things.
 *
 * Three answers now rather than two, because "loan" was hiding a distinction
 * that decides who has to do something: a set coming over from RHH is a
 * transfer the team makes themselves, and a set coming from the distributor is
 * a request somebody has to send and chase. Both used to read as "Loan".
 *
 * Checked most specific first — "RHH loan" contains "loan", so the general
 * case has to come last or it swallows both.
 */
function normaliseSupply(raw) {
  const text = String(raw || '').trim()
  if (!text) return undefined
  if (/consign|^\s*cons\s*$/i.test(text)) return 'Consignment'
  if (/\brhh\b[\s-]*loan|loan[\s-]*(?:from[\s-]*)?\brhh\b/i.test(text)) return 'RHH Loan'
  if (/distributor[\s-]*loan|loan[\s-]*(?:from[\s-]*)?distributor/i.test(text)) return 'Distributor Loan'
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

// ─── Keeping the written date in step with the day ───────────────────────────
// "When a booking is moved in the portal and the calendar entry follows it, we
// need to ensure that the date in the description gets altered in the calendar
// entry, so that the information is accurate."
//
// Davie was moved to Tuesday 13 October and the entry moved with it — the title
// bar of the event says Tuesday, October 13 — while the notes underneath still
// read "Date: 08/10/2026". The app itself was never fooled: it reads the date
// label only so as to consume it, and takes the event's own start as the truth.
// People are not reading the event's start. They are reading the block of text,
// and they forward it, print it and ring a hospital about it.
//
// So the written date follows the event. Not because anything in here needs it
// — because it is in front of somebody.

const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
]

/** The weekday of a plain yyyy-mm-dd, with no timezone anywhere near it. */
function weekdayOf(y, m, d) {
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

/**
 * The new date, written the way the old one was.
 *
 * Whoever typed "8/10/26" and whoever typed "Thursday 08-10-2026" both meant
 * it to stay looking like that. Rewriting one into the house style would show
 * up in the calendar's own revision history as an edit nobody made, which is
 * the same reason setLabelledValue keeps the leading whitespace.
 */
function datedLike(existing, y, m, d) {
  const was = String(existing || '').trim()
  const separator = /[/.-]/.exec(was)?.[0] || '/'
  // Four digits unless the old one plainly used two. A bare "8/10" with no
  // year gets the full one: this is the line somebody reads to find out which
  // day, so the year is worth the characters.
  const shortYear = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2}\b(?!\d)/.test(was)
  const year = shortYear ? String(y).slice(-2) : String(y)
  const date = [
    String(d).padStart(2, '0'), String(m).padStart(2, '0'), year
  ].join(separator)

  // A weekday, where there was one. It is the part people actually act on —
  // nobody checks a date against a calendar in a corridor — so leaving a stale
  // "Thursday" in front of a corrected number would be worse than not touching
  // the line at all.
  const named = /^([A-Za-z]{3,9})\b/.exec(was)
  const full = named && WEEKDAYS.find(day =>
    day.toLowerCase() === named[1].toLowerCase())
  const abbreviated = named && !full && WEEKDAYS.find(day =>
    day.slice(0, 3).toLowerCase() === named[1].slice(0, 3).toLowerCase())

  const weekday = weekdayOf(y, m, d)
  if (full) return `${weekday} ${date}`
  if (abbreviated) return `${weekday.slice(0, 3)} ${date}`
  return date
}

/**
 * Puts the description's date label back in step with the day the booking is on.
 *
 * Only where the label is already there. A booking whose team never wrote a
 * date does not acquire one here: every description in the calendar would gain
 * a line on its next save, which is a lot of noise to add in order to fix the
 * ones that are wrong.
 *
 * Only where it disagrees, so an ordinary edit to the kit does not register as
 * an edit to the date.
 *
 * @param {string} description the booking's notes
 * @param {string} isoDate     yyyy-mm-dd, the day the event now starts
 */
export function withDateFollowing(description, isoDate) {
  const text = String(description || '').replace(/\r\n?/g, '\n')
  const on = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || '').trim())
  if (!on) return text

  const span = labelledFieldSpans(text).date
  if (!span) return text

  // Only a value that is actually a date. "Date: TBC" is somebody saying the
  // day is not settled, and a provisional slot in the calendar is not the
  // confirmation they are waiting for — overwriting it would make the line
  // read as agreed when it is not, which is worse than leaving it stale.
  if (!/\d{1,2}\s*[/.-]\s*\d{1,2}/.test(span.value)) return text

  const written = datedLike(span.value, Number(on[1]), Number(on[2]), Number(on[3]))
  return span.value.trim() === written ? text : setLabelledValue(text, 'date', written)
}
