import { normaliseSurgeon } from './parse.js'
import { findSystems } from './systems.js'

// ─── What the patient already has in ─────────────────────────────────────────
// A booking that says "removal of existing fusion" or "revision" is asking a
// question the team has to answer before the day: what is in there, who put it
// in, and when. Get it wrong and the right screwdriver is in another hospital.
//
// The answer is already filed. Every usage sheet the team has ever sent goes to
//   /ALL SURGEON USAGE/SPINE/{SURGEON}/{MONTH YEAR}/{FOLDER}
// and the folder is named to a convention the team has kept for years:
//
//   Millward 29.09.26 Ibbett Diplomat PSF CLV
//   Petrusma 28.09.26 Thani C1-2 CLV
//   Norman 28.09.26 Thani ALIF CLV
//
// Surname, date, surgeon, what went in, where. Years of it, searchable.
//
// ── What this cannot do, and must not pretend to ──
//
// The app holds surnames and nothing else, on purpose. So a match is a patient
// with the same surname — not necessarily this patient. Two Smiths is not
// far-fetched over a decade of operating in one city, and "this patient has a
// Diplomat in situ" stated confidently about the wrong Smith is worse than
// saying nothing. Everything here is phrased as what was found, never as what
// this patient has.

/** Words in a booking that mean somebody needs to know what is already in. */
const ASKS_ABOUT_EXISTING = new RegExp([
  'revision', 'removals?', 'remove', 'explant', 'existing',
  'in\\s*-?\\s*situ', 'insitu', 'previous', 'prior', 're-?do',
  'extend(?:ing|ed)?\\s+(?:the\\s+)?(?:fusion|construct)',
  'adjacent\\s+segment'
].map(w => `\\b${w}\\b`).join('|')
  // "R/O" is how the team writes removal of — Hudson's booking on 13 October
  // reads "R/O C5/6 ACDF plate" and nothing else in it says removal at all.
  + '|\\bR\\s*/\\s*O\\b', 'i')

/** Whether this booking needs the history looked up at all. */
export function needsPriorImplants(text) {
  return ASKS_ABOUT_EXISTING.test(String(text || ''))
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * The date out of a folder name: 29.09.26, 29/9/26, 29-09-2026.
 *
 * Two-digit years are 2000s. The business did not operate in 1926 and will not
 * be reading these in 2126.
 */
function dateFrom(text) {
  const numeric = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/.exec(text)
  if (numeric) {
    const [, d, m, y] = numeric
    const year = y.length === 4 ? Number(y) : 2000 + Number(y)
    const month = Number(m)
    const day = Number(d)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }
  const named = /\b(\d{1,2})\s*([A-Za-z]{3,})\s*(\d{2,4})\b/.exec(text)
  if (named) {
    const month = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase())
    if (month >= 0) {
      const year = named[3].length === 4 ? Number(named[3]) : 2000 + Number(named[3])
      return `${year}-${String(month + 1).padStart(2, '0')}-${String(named[1]).padStart(2, '0')}`
    }
  }
  return null
}

const HOSPITAL = /\b(RHH|CLV|CALVARY|LENAH)\b/i

/**
 * One filed case, read out of its folder name.
 *
 * @param {string} name  e.g. "Millward 29.09.26 Ibbett Diplomat PSF CLV"
 * @param {string} [path] where it was found, which is how the surgeon is known
 *        when the name itself does not say
 */
export function readFiledCase(name, path = '') {
  const text = String(name || '').trim()
  if (!text) return null

  // The surname leads, by convention, and is the only patient detail kept.
  const surname = (/^([A-Za-z][A-Za-z'’-]+)/.exec(text) || [])[1] || null
  if (!surname) return null

  const date = dateFrom(text)

  // The surgeon is in the name on most of them, and always in the path — the
  // tree is filed by surgeon, which is what makes the folder above it the
  // reliable answer.
  const fromPath = /ALL SURGEON USAGE\/SPINE\/([^/]+)/i.exec(String(path))
  const surgeon = normaliseSurgeon(fromPath?.[1] || '')
    || text.split(/\s+/).map(normaliseSurgeon).find(Boolean)
    || null

  const systems = findSystems(text).map(s => s.name)
  const hospital = (HOSPITAL.exec(text) || [])[1]?.toUpperCase() || null

  return {
    patient: surname.charAt(0).toUpperCase() + surname.slice(1).toLowerCase(),
    date,
    surgeon,
    systems,
    hospital: hospital === 'CALVARY' || hospital === 'LENAH' ? 'CLV' : hospital,
    // Kept whole, because the convention is not universal and the words nobody
    // parsed are sometimes the ones that matter.
    filedAs: text
  }
}

/**
 * Filed cases that might be this patient, most recent first.
 *
 * @param {Array} filed        every case read out of the tree
 * @param {string} patient     the surname on the booking
 * @param {string} [surgeon]   the surgeon on the booking
 */
export function priorImplantsFor(filed, patient, surgeon) {
  const surname = String(patient || '').trim().toLowerCase()
  if (!surname) return []

  const theirs = normaliseSurgeon(surgeon) || null

  return (filed || [])
    .filter(Boolean)
    .filter(c => c.patient?.toLowerCase() === surname)
    .map(c => ({
      ...c,
      // A case found under another surgeon is worth showing and worth marking.
      // Most patients come back to the same one; the ones who do not are
      // exactly the ones somebody would otherwise miss.
      sameSurgeon: Boolean(theirs && c.surgeon === theirs)
    }))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
}

/**
 * What to say about what was found.
 *
 * Deliberately hedged. These are matched on a surname alone, because a surname
 * is all this app keeps — so the honest claim is about the record, not about
 * the patient in front of anybody.
 */
export function describePrior(matches, surgeon) {
  if (!matches?.length) return null
  const theirs = normaliseSurgeon(surgeon)
  const elsewhere = matches.filter(m => !m.sameSurgeon)

  if (matches.length === 1) {
    const one = matches[0]
    const who = one.sameSurgeon ? '' : ` under ${one.surgeon || 'another surgeon'}`
    return `One earlier case filed under this surname${who}. Check it is the same patient.`
  }
  const note = elsewhere.length && theirs
    ? ` ${elsewhere.length} of them under another surgeon.`
    : ''
  return `${matches.length} earlier cases filed under this surname.${note} Check they are the same patient.`
}
