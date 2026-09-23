import { SURGEON_KEYS, normaliseSurgeon, stripIdentifiers } from './parse.js'
import { toDateStr } from './week.js'

// ─── Reading an RHH theatre list out of an email ─────────────────────────────
// One email, a whole week: seven cases across four days is a normal Monday
// morning. It arrives as a table pasted out of the hospital's theatre system,
// so the reliable structure is the HTML, not the text — flattening the table to
// lines interleaves the columns and puts one case's procedure above another
// case's patient, which is unparseable and, worse, parseable *wrongly*.
//
// The list carries patient first names and dates of birth. Those are stripped
// here, at the door, and never returned: the app stores surnames and nothing
// else, and an ingestion path is exactly where that rule would quietly lapse.
//
// Nothing here writes anywhere. It turns an email into candidate bookings for a
// person to confirm, which is the whole design — the table is messy enough that
// a wrong reading is likely, and a wrong booking is worse than a missing one.

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december']

/** "21st September 2026" → "2026-09-21". */
export function parseListDate(text) {
  const m = /(\d{1,2})\s*(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/.exec(String(text || ''))
  if (!m) return null
  const month = MONTHS.findIndex(name => name.startsWith(m[2].toLowerCase().slice(0, 3)))
  if (month < 0) return null
  return toDateStr({ year: Number(m[3]), month: month + 1, day: Number(m[1]) })
}

/**
 * A patient cell: an upper-case surname, usually followed by a given name.
 *
 * The surname is the only part kept. The given name and any date of birth in
 * the same cell are dropped here rather than downstream, so nothing that
 * reaches the rest of the app has ever held them.
 */
export function readPatientCell(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  // Three or more upper-case letters. Two was not enough: "KT Lonestar" is a
  // kit, and it was being read as a patient called Kt — which then took the real
  // patient's place on the case and pushed the surname into the procedure. A
  // genuine two-letter surname would now be missed, and that is the better
  // failure: it shows up in the review queue as a case with no patient rather
  // than as a case with a confidently wrong one.
  //
  // Apostrophes and hyphens are part of a surname: O'BRIEN, PETERS-WILLKE.
  const m = /^([A-Z][A-Z'’\-]{2,})\b/.exec(raw)
  if (!m) return null
  const surname = m[1]
  // A cell that is only a heading word is not a patient.
  if (['THEATRE', 'LIST', 'NEUROSURGERY', 'ORTHOPAEDICS', 'KIT', 'DOB'].includes(surname)) return null
  return surname.charAt(0) + surname.slice(1).toLowerCase()
}

/** Whether a cell names one of the surgeons, in any of the ways they are written. */
function readSurgeonCell(text) {
  const raw = String(text || '').trim()
  if (!raw || raw.length > 40) return null
  // Must look like a name rather than a sentence.
  if (/\d/.test(raw) || raw.split(/\s+/).length > 3) return null
  return normaliseSurgeon(raw)
}

const NOISE = /theatre\s*number|list\s*duration|anaesthetic|all\s*day\s*list|^\s*(am|pm)\s*list|neurosurgery|orthopaedics|^\s*$/i

/** Cells of one table row, tags stripped. */
function rowsFromHtml(html) {
  const rows = []
  for (const row of String(html || '').match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = (row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(cell =>
      cell.replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
        .replace(/\s{2,}/g, ' ').trim())
    if (cells.some(Boolean)) rows.push(cells)
  }
  return rows
}

/**
 * The pipe-delimited form, which is what a quoted reply and some text-only
 * clients produce. Same shape, one cell per column.
 */
function rowsFromPipes(text) {
  return String(text || '').split('\n')
    .filter(line => line.includes('|'))
    .map(line => line.replace(/^\||\|$/g, '').split('|').map(c => c.trim()))
    .filter(cells => cells.some(Boolean))
}

/**
 * Candidate bookings from a theatre-list email.
 *
 * @param {{html?: string, text?: string}} email
 * @returns {Array} one entry per case, each with `confident` false where the
 *          reading needs a person. Nothing is ever dropped silently: a row that
 *          names a patient always produces a candidate, even if the surgeon or
 *          the kit could not be read.
 */
export function parseTheatreList({ html, text } = {}) {
  let rows = rowsFromHtml(html)
  if (rows.length < 2) rows = rowsFromPipes(text || html)
  if (!rows.length) return []

  const cases = []
  let date = null
  let surgeon = null
  let theatre = null

  for (const cells of rows) {
    const joined = cells.join(' ')

    const onThisRow = parseListDate(joined)
    if (onThisRow && WEEKDAYS.some(d => joined.toLowerCase().includes(d))) {
      date = onThisRow
      // A new day starts a new list; the surgeon is stated again beneath it.
      surgeon = null
      theatre = null
      continue
    }

    // A surgeon heading: their name plus the theatre and the list hours.
    if (/theatre\s*number/i.test(joined)) {
      const named = cells.map(readSurgeonCell).find(Boolean)
      if (named) surgeon = named
      theatre = (/theatre\s*number\s*(\d+)/i.exec(joined) || [])[1] || null
      continue
    }

    // A case row is one that names a patient.
    const patientIndex = cells.findIndex(cell => readPatientCell(cell))
    if (patientIndex < 0) continue
    const patient = readPatientCell(cells[patientIndex])

    // The kit sits to the left of the patient and the procedure to the right,
    // which is the column order every one of these lists uses.
    const kit = cells.slice(0, patientIndex).reverse()
      .find(cell => cell && !NOISE.test(cell) && !readSurgeonCell(cell)) || ''
    const after = cells.slice(patientIndex + 1)
      .map(cell => stripIdentifiers(cell))
      .filter(cell => cell && !NOISE.test(cell) && !/^\d+$/.test(cell))
    const procedure = after.sort((a, b) => b.length - a.length)[0] || ''

    cases.push({
      date,
      patient,
      surgeon,
      kit: stripIdentifiers(kit),
      procedure,
      theatre,
      hospital: 'RHH',
      source: 'rhh',
      // What a person has to look at. A case with no date or no surgeon is still
      // offered — dropping it would lose a real booking silently, which is the
      // failure this whole path exists to avoid.
      confident: Boolean(date && surgeon && patient)
    })
  }

  return cases
}
