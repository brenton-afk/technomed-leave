import { STAFF } from '../staffConfig.js'
import { parseKitSupplies } from './kitSupply.js'
import { findSystems, findLoanSets, systemWords, findNavigation, resolveKit } from './systems.js'
import { parseLabelledDescription, parseKitField, hospitalCode, descriptionNotes } from './labelledFields.js'
import { isPreOpNoise } from './preOpNoise.js'
import { parseListPlace } from './listPlace.js'
import { attendanceNotRequired } from './attendance.js'
// ─── Event parsing ────────────────────────────────────────────────────────────
// Surgical cases are titled `<Patient surname> <KIT> - <Surgeon>`. Everything
// else on the bookings calendar is a non-case item.
//
// Privacy (§10) is enforced here, at the boundary: identifiers are stripped as
// events are parsed, so nothing beyond a surname is ever stored in a WeekPlan,
// cached, exported or rendered — regardless of what a calendar event contains.

export const SURGEON_KEYS = [
  // Spine
  'Hannan', 'Dubey', 'Thani', 'Fowler', 'Ibbett', 'JPW', 'Gupta', 'Atallah',
  // Maxillofacial. Mostly RHH, occasionally Calvary, and almost always us
  // providing AIRO support — they like a post-operative CT once a facial
  // fracture is reduced and fixated.
  'Garg', 'Varidel', 'Silifent', 'Ong', 'Carter',
  // Orthopaedics. A different service with different kit and different
  // theatres — see ORTHOPAEDIC_SURGEONS in colours.js, which is what makes the
  // card say so.
  'Harvie'
]

/**
 * The other names a surgeon is written under.
 *
 * The RHH theatre lists give surnames in full while the booking calendar uses
 * the short form the team says out loud, so the same surgeon arrives as
 * "PETERS-WILLKE" from the hospital and "JPW" from us. Without this the whole
 * booking fails to find a surgeon and is not read as a case at all.
 *
 * Keys are matched after punctuation is flattened, so "Peters-Willke",
 * "Peters Willke" and "PETERS WILLKE" all land on the same entry.
 */
const SURGEON_ALIASES = {
  'peters willke': 'JPW',
  'jens peters willke': 'JPW'
}

/**
 * Systems written under another name.
 *
 * Thani writes "Implanet" on a pedicle screw fixation and means Diplomat. The
 * app had never heard of Implanet, so it came through as the system itself and
 * the booking named a product we do not carry.
 */
export const SYSTEM_ALIASES = {
  implanet: 'Diplomat'
}

/** The system, under whichever name it was written. */
export function normaliseSystem(name) {
  const key = String(name || '').trim().toLowerCase()
  return SYSTEM_ALIASES[key] || name
}

const SURGEON_LOOKUP = new Map([
  ...SURGEON_KEYS.map(k => [k.toLowerCase(), k]),
  ...Object.entries(SURGEON_ALIASES)
])

/** Hyphens, apostrophes and doubled spaces flattened, for alias matching. */
function flattenName(value) {
  return String(value || '').toLowerCase().replace(/[-'’.]/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

// Long digit runs are MRN/UR numbers; the date shapes are DOBs. Both are
// removed from every string that reaches the plan.
const IDENTIFIER_PATTERNS = [
  /\b\d{5,}\b/g,                          // MRN / UR
  /\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/g, // 14/03/1958
  /\b\d{4}-\d{2}-\d{2}\b/g,               // 1958-03-14
  /\bDOB\b[:\s]*/gi,
  /\b(MRN|UR|URN)\b[:\s#]*/gi
]

export function stripIdentifiers(text) {
  let out = String(text == null ? '' : text)
  for (const p of IDENTIFIER_PATTERNS) out = out.replace(p, ' ')
  return out.replace(/\s{2,}/g, ' ').trim()
}

// Surname only. A calendar entry may carry "Jackson, Mary" or "Mary Jackson";
// either way exactly one name token survives, and never a numeric one.
export function sanitisePatient(raw) {
  const cleaned = stripIdentifiers(raw)
  if (!cleaned) return ''
  // "Surname, First" → the part before the comma is the surname.
  const beforeComma = cleaned.split(',')[0].trim()
  const words = beforeComma.split(/\s+/).filter(Boolean)
  if (!words.length) return ''

  // Usually one word. More where the name begins with a particle — see
  // surnameLength. This used to take words[0] unconditionally, so La Pietra
  // was filed as "La": in the title, in the Pt: field, in the Dropbox folder
  // name, and on the sheet that went to the distributor. It also meant the
  // booking could not be corrected by hand, because typing the space back in
  // was undone by this function on the way through.
  const take = surnameLength(words)
  const kept = words.slice(0, take)
    .map(word => word.replace(/[^A-Za-z'’\-]/g, ''))
    .filter(Boolean)
  if (!kept.length) return ''

  // Case, three ways, because the name arrives written three ways.
  //
  //   · ALL CAPS is how hospitals and theatre lists write everything, and how
  //     it comes out of an email. Normalised, or the card shouts.
  //   · McDonald and O'Brien are mixed case on purpose and must survive, so
  //     only an entirely upper-case word is touched.
  //   · a particle after the first word stays lower — "Van der Berg", which
  //     is how the name is written.
  const particle = word =>
    SURNAME_PARTICLES.has(word.toLowerCase().replace(/[^a-z.']/g, ''))

  return kept
    .map((word, i) => {
      const body = word === word.toUpperCase() ? word.toLowerCase() : word.slice(1)
      const rest = word === word.toUpperCase() ? body.slice(1) : body
      if (i > 0 && particle(word)) return word.toLowerCase()
      return word.charAt(0).toUpperCase() + rest
    })
    .join(' ')
}

export function normaliseSurgeon(raw) {
  const cleaned = stripIdentifiers(raw).replace(/^(dr|mr|mrs|ms|prof|professor|a\/prof)\b\.?/i, '').trim()
  if (!cleaned) return null
  const direct = SURGEON_LOOKUP.get(cleaned.toLowerCase()) || SURGEON_LOOKUP.get(flattenName(cleaned))
  if (direct) return direct
  // An alias buried in a longer string — "Dr Jens Peters-Willke (RHH)".
  const flat = flattenName(cleaned)
  for (const [alias, key] of Object.entries(SURGEON_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(flat)) return key
  }
  // Tolerate "Fowler (RHH)" or a surname buried in a longer string.
  for (const key of SURGEON_KEYS) {
    if (new RegExp(`\\b${key}\\b`, 'i').test(cleaned)) return key
  }
  return null
}

// Reading a case title.
//
// This was originally strict: `<Patient> <KIT> - <Surgeon>`, spaces required
// either side of the dash, surgeon spelled as one of the known names. Real
// bookings do not respect that. "Kennedy REFORM-JPW", "Kennedy - JPW", a colon
// instead of a dash, or a surgeon the list has never seen all failed, and a real
// case got flagged instead of read.
//
// So there are now two ways to attribute a case, in order:
//
//   1. the title names a known surgeon after a separator, or
//   2. the event's calendar colour names one — which is exactly what the team's
//      colour guide is for ("it's how we see surgeon allocation at a glance").
//
// Only the shape is relaxed. Attribution still comes from the title or the
// colour, never from a guess, and a booking with neither stays flagged.

// Candidate split points: any dash or colon, with or without spaces. Used to
// *locate* the surgeon, not to tokenise the whole title — slicing at the one
// separator that matters keeps hyphens inside a kit name intact, so "DAKOTA-2"
// survives.
// ">" is in here because it is the convention the team was asked to use:
// "Pt name>SYSTEM>Surgeon name>(REP NAME)". Without it a title in that exact
// format split on nothing, so patient, surgeon and system all came back empty
// and the booking rendered blank.
const SEPARATOR = /\s*[-–—:>]\s*/g

/**
 * The rep who attended, from a "(Mat)" suffix.
 *
 * Written by markAttendance when a usage form is scanned, and by hand when the
 * team notes who is covering a list. It was being thrown away: the surgeon
 * matcher tolerates a surname "buried in a longer string", so "Fowler (Mat)"
 * matched Fowler, the whole fragment was consumed as the surgeon, and the rep
 * went with it — silently, which is the worst part. The name was in the
 * calendar and simply absent from the app.
 *
 * Only roster first names count. A bracketed "(RHH)" or "(2 of 3)" is not a
 * person, and guessing would put a hospital code where a rep's name goes.
 */
/**
 * Every way a rep's name is written, mapped to the one the app shows.
 *
 * Only used to tidy a name the roster recognises — "Brenton" is shown as Brent
 * so the picker lights up and two spellings do not read as two people. A name
 * nobody recognises is kept exactly as written. The longer forms come free from
 * the full name already on the roster, so this is not a list to maintain.
 */
function repNameForms() {
  const forms = []
  for (const person of STAFF) {
    if (!person.firstName) continue
    const written = new Set([
      person.firstName,
      String(person.name || '').trim().split(/\s+/)[0],
      ...(person.aka || [])
    ].filter(Boolean))
    for (const form of written) forms.push({ form, canonical: person.firstName })
  }
  return forms.sort((a, b) => b.form.length - a.form.length)
}

// A trailing bracket that is about the kit rather than about people. The team's
// title convention is "Patient SYSTEM (supply) - Surgeon (Rep)", so the supply
// note normally sits earlier — but not always, and "- Thani (LOAN)" must not
// put a rep called Loan on the case.
const NOT_A_PERSON = new RegExp([
  // Kit and supply.
  'loans?', 'consignment', 'consign', 'kits?', 'sets?', 'trial', 'stock', 'self\\s*funding',
  // Places. "(RHH)" on the end of a title is a hospital, not somebody called Rhh.
  'rhh', 'clv', 'calvary', 'lenah', 'royal\\s*hobart', 'theatre', 'offsite',
  // Navigation platforms.
  'airo', 'curve', 'brainlab', 'vario\\s*guide',
  // Status.
  'tbc', 'tba', 'cancelled', 'postponed'
].map(w => `\\b${w}\\b`).join('|') + '|\\d', 'i')

/**
 * Who attended, taken from the end of the title and read as written.
 *
 * This used to match only names on the roster, which meant the bracket had to
 * be made *entirely* of known names or it was thrown away whole. Bonney's case
 * read "(Aimee/Brenton)" and showed no rep at all — not even Aimee — because
 * the roster calls him Brent.
 *
 * So it no longer asks permission. Whatever is in the last bracket is who
 * attended, because that is what the calendar says and the app's job here is to
 * show the calendar. A locum, a new starter, someone from Brainlab, a name
 * misspelled in a hurry — all of it comes through rather than disappearing.
 *
 * The only thing filtered out is a bracket that is plainly about the kit, since
 * those appear in the same position often enough to matter.
 */
export function extractRep(title) {
  const text = String(title || '')
  // The last bracket, at the very end. A supply note sits beside the system
  // earlier in the title, which is what separates the two without a word list.
  const match = /\(([^()]*)\)\s*$/.exec(text)
  if (!match) return { rep: null, reps: [], rest: text }

  const inside = match[1].trim()
  if (!inside || NOT_A_PERSON.test(inside)) return { rep: null, reps: [], rest: text }

  const forms = repNameForms()
  const reps = []
  for (const part of inside.split(/[/,&+]| and /i)) {
    const written = part.trim()
    if (!written) continue
    // Tidied to the roster's spelling where we know the person, kept verbatim
    // where we do not.
    const known = forms.find(f => f.form.toLowerCase() === written.toLowerCase())
    const name = known ? known.canonical : written
    if (!reps.includes(name)) reps.push(name)
  }
  if (!reps.length) return { rep: null, reps: [], rest: text }

  return {
    // Kept as written, so the card reads the way the booking does.
    rep: reps.join('/'),
    reps,
    rest: (text.slice(0, match.index) + ' ' + text.slice(match.index + match[0].length))
      .replace(/\s{2,}/g, ' ').trim()
  }
}
// Titles that are not cases however they are coloured. On-call and
// reduced-hours entries are routinely coded Graphite (officially Dubey's), so
// without this guard colour inference would invent a Dubey case every week.
const NOT_A_CASE = /\bon\s*-?\s*call\b|late start|early finish|reduced hours|\bwfh\b|\bday off\b|annual leave|personal leave|\bleave\b|\bmeeting\b|catch\s*-?\s*up|list order|\btransfer\b|\bconference\b|handover|team leader|\boffice\b|\bhuddle\b|\breview\b|vendor|\bin hobart\b/i

// A patient is a surname. These are the words that turn up first in a title
// that is describing something else — a room, a session, a list — and they must
// not be mistaken for one when the surgeon is being inferred from a colour.
const NOT_A_SURNAME = new Set([
  'theatre', 'theater', 'list', 'lists', 'room', 'session', 'clinic', 'ward',
  'am', 'pm', 'all', 'the', 'and', 'tbc', 'tba', 'am/pm', 'case', 'cases',
  'spine', 'ortho', 'cmf', 'admin', 'setup', 'set', 'pack', 'stock', 'loan'
])

// ─── Surnames that are more than one word ────────────────────────────────────
// "Patient surname is La Pietra. The app can't handle the space in the surname
// and just keeps booking it as surname 'la'."
//
// The title is read as "surname, then everything else", and the surname was
// taken to be the first word. For most people that is right. For La Pietra it
// took "La" and handed "Pietra" to the operation, so the booking was filed
// under a surname that does not exist, the folder was named after it, and the
// usage sheet carried it to a distributor.
//
// Guessing is not an option — "Hollis DIPLOMAT" has a perfectly ordinary
// second word that is not part of the name. What makes La Pietra different is
// the first word, not the second: a small, closed set of particles that are
// never a surname on their own and are nearly always followed by the rest of
// one.
//
// Conservative on purpose. A particle that is not in this list reads as a
// one-word surname, which is the behaviour as it was; a word wrongly added to
// the list would start eating system names off the front of every title.
const SURNAME_PARTICLES = new Set([
  'la', 'le', 'de', 'del', 'della', 'di', 'da', 'das', 'dos', 'du',
  'van', 'von', 'der', 'den', 'ter', 'ten',
  'mac', 'mc', 'st', 'st.', 'saint', 'san', 'santa',
  'al', 'el', 'bin', 'ibn', 'abu'
])

/** Whether a word is a surname particle and nothing else. */
export function isBareParticle(word) {
  return SURNAME_PARTICLES.has(
    String(word || '').trim().toLowerCase().replace(/[^a-z.']/g, ''))
}

/**
 * How many leading words belong to the surname.
 *
 * Usually one. More where the name starts with a particle — and more than two
 * where it starts with several, as "Van der Berg" does.
 *
 * Never all of them: a particle at the end of the words with nothing after it
 * is not a surname, it is a word that happens to be in the list, and taking
 * the lot would leave the operation empty.
 */
export function surnameLength(words) {
  const particle = word =>
    SURNAME_PARTICLES.has(String(word).toLowerCase().replace(/[^a-z.']/g, ''))

  let n = 0
  while (n < words.length - 1 && particle(words[n])) n++
  if (n === 0) return 1

  // What follows the particles has to be a name. "Van ACDF - Thani" is a
  // patient called Van having an ACDF, not a patient called Van ACDF — and
  // joining there would eat the operation off the front of the title and
  // leave the case with none. A particle that leads nowhere is just a short
  // surname, which is what it was before any of this.
  const next = String(words[n] || '')
  // And it has to be a name rather than another particle. "De la" is the
  // front of a surname with the surname still missing, not a surname.
  if (!looksLikeSurname(next) || particle(next)
    || findSystems(next).length || isOperationWord(next)) {
    return 1
  }
  return n + 1
}

/** Words that describe the operation rather than the person having it. */
const OPERATION_WORDS = new Set([
  'acdf', 'plif', 'tlif', 'alif', 'xlif', 'llif', 'olif', 'adr',
  'decompression', 'discectomy', 'laminectomy', 'fusion', 'revision',
  'removal', 'washout', 'biopsy', 'cranio', 'craniotomy', 'cervical',
  'lumbar', 'thoracic', 'anterior', 'posterior', 'redo', 'bilateral'
])

const isOperationWord = word =>
  OPERATION_WORDS.has(String(word).toLowerCase().replace(/[^a-z]/g, ''))

function looksLikeSurname(token) {
  const letters = String(token || '').replace(/[^A-Za-z'’-]/g, '')
  if (letters.length < 2) return false
  return !NOT_A_SURNAME.has(letters.toLowerCase())
}

/** Every way the title could be cut in two, left to right. */
function splitPoints(raw) {
  const points = []
  SEPARATOR.lastIndex = 0
  let m
  while ((m = SEPARATOR.exec(raw)) !== null) {
    if (m.index === 0 || m.index + m[0].length >= raw.length) continue
    points.push({ left: raw.slice(0, m.index), right: raw.slice(m.index + m[0].length) })
  }
  return points
}

/**
 * Reads a booking title.
 *
 * Originally this demanded `<Patient> <KIT> - <Surgeon>` with spaces either side
 * of the dash and a surgeon from a fixed list. Real bookings do not respect
 * that: "Kennedy REFORM-JPW", "Kennedy - JPW", a colon, or a name the list has
 * never seen all failed, and a real case got flagged instead of read.
 *
 * Attribution now has two routes, in order of authority:
 *   1. a known surgeon named in the title, on either side of any separator;
 *   2. the event's calendar colour, which is what the team's colour guide is for.
 *
 * Only the shape is relaxed. A booking with neither route stays unattributed.
 *
 * @param {string} title
 * @param {{ colourSurgeon?: string|null }} [hint]
 * @returns {{patient: string, procedure: string, surgeon: string, surgeonSource: 'title'|'colour'} | null}
 */
export function parseCaseTitle(title, hint = {}) {
  // Checked before stripping: if the title opens with an identifier rather than
  // a name, the patient is not something we can name safely. Stripping it would
  // promote the next word — usually the kit — into the patient field, so the
  // booking is refused and surfaces as needing attention instead of being
  // mislabelled.
  const rawFirstWord = String(title == null ? '' : title).trim().split(/\s+/)[0] || ''
  if (rawFirstWord && !/[A-Za-z]/.test(rawFirstWord)) return null

  const raw = stripIdentifiers(title)
  if (!raw) return null
  if (NOT_A_CASE.test(raw)) return null

  const points = splitPoints(raw)
  let caseText = null, surgeon = null

  // Right-hand side first, from the last separator back: the convention puts
  // the surgeon last.
  for (let i = points.length - 1; i >= 0 && !surgeon; i--) {
    const candidate = normaliseSurgeon(points[i].right)
    if (candidate) { surgeon = candidate; caseText = points[i].left }
  }
  // Then the left-hand side, for "JPW - Kennedy REFORM".
  for (let i = 0; i < points.length && !surgeon; i++) {
    const candidate = normaliseSurgeon(points[i].left)
    if (candidate) { surgeon = candidate; caseText = points[i].right }
  }
  // Then a trailing word with no separator at all: "Kennedy REFORM JPW".
  if (!surgeon) {
    const words = raw.split(/\s+/)
    if (words.length >= 2) {
      const candidate = normaliseSurgeon(words[words.length - 1])
      if (candidate) { surgeon = candidate; caseText = words.slice(0, -1).join(' ') }
    }
  }

  let surgeonSource = 'title'
  if (!surgeon) {
    const fromColour = hint.colourSurgeon ? normaliseSurgeon(hint.colourSurgeon) : null
    if (!fromColour) return null
    surgeon = fromColour
    surgeonSource = 'colour'
    caseText = raw
  }

  // Whitespace, and ">" — which the team's own convention uses with no spaces
  // around it, so "Mardon>MARINER" was read as one word and the patient came
  // out "MardonMARINER". Hyphens are deliberately *not* split here: a
  // vertebral level is written "L4-L5", and splitting it produced "L4 L5".
  const words = String(caseText || '').trim().split(/[\s>]+/).filter(Boolean)
  if (words.length === 0) return null

  // Inference from colour alone is only allowed where the first word actually
  // reads like a surname, so "Theatre 3 list" does not become a patient.
  if (surgeonSource === 'colour' && !looksLikeSurname(words[0])) return null

  const take = surnameLength(words)
  const patient = sanitisePatient(words.slice(0, take).join(' '))
  if (!patient) return null

  return {
    patient,
    procedure: stripIdentifiers(words.slice(take).join(' ')),
    surgeon,
    surgeonSource
  }
}

export function isSurgicalCase(title, hint) {
  return parseCaseTitle(title, hint) !== null
}

/**
 * Whether a booking has been called off.
 *
 * A cancellation reaches this app two ways. Deleting the event is the clean one —
 * Google stops returning it and it simply disappears. But the team more often
 * *renames* it, because a deleted booking leaves no record that the theatre time
 * was ever held, and a renamed one was still being read as a live case: same
 * patient, same surgeon, same kit, no indication that nobody is operating.
 *
 * Kept as a case rather than dropped. "Cancelled" is information — the slot was
 * booked and is now free — and a case quietly vanishing from a plan someone
 * printed this morning is worse than one shown struck through.
 *
 * Deliberately narrow. `\bcancel` and `\bpostpone` only, anchored to a word
 * start, because a substring match would catch a surgeon or a procedure and take
 * a real case off the list.
 */
const CALLED_OFF = /\b(?:cancel(?:l?ed|lation)?|postponed?|abandoned)\b/i

/**
 * Whether the booking itself says it is off.
 *
 * The title is an assertion about the booking; the description is commentary
 * about it. Scanning both for the word anywhere conflated the two, and a live
 * case was shown struck through and "CANCELLED" on the strength of a note that
 * merely mentioned one — "moved, Tuesday's list cancelled", "loan set
 * cancellation". That is the app contradicting the calendar, which is worse than
 * showing nothing: nobody can trust a screen that invents a fact.
 *
 * So the title decides. A description can still mark a case off, but only by
 * saying so on a line of its own — "CANCELLED", not a sentence containing the
 * word. That keeps the deliberate note working and drops the incidental mention.
 *
 * Erring towards showing a cancelled case as live is the safer failure: the case
 * stays on the list and the team reconciles against Google, which they do
 * anyway. Erring the other way removes a real case from the day.
 */
export function isCancelled(title, description) {
  if (CALLED_OFF.test(String(title || ''))) return true
  return String(description || '').split('\n').some(line => {
    const bare = line.replace(/[^\p{L}\s]/gu, ' ').trim()
    // The whole line is the marker, give or take punctuation and a "case".
    return bare.length <= 24 && CALLED_OFF.test(bare)
  })
}

/**
 * The booking title without its cancellation marker.
 *
 * A title is read as `{Patient} {procedure} - {Surgeon}`, so "CANCELLED - Streets
 * ACDF - JPW" put the marker exactly where the patient's name goes and the case
 * came out belonging to a patient called Cancelled. Removing the word first means
 * a called-off booking still reads as the case it was, which is the whole point of
 * keeping it on the page.
 *
 * Leading and trailing separators go with it, along with the brackets around a
 * parenthesised "(cancelled)".
 */
// A patient paying for their own implants. Written at the front of the title,
// like a cancellation, and it was not recognised — so "SELF FUNDING Russell
// CYLOX - Thani" parsed its system as "FUNDING Russell CYLOX" and the card
// showed the word FUNDING sitting in front of the surname.
//
// It matters commercially and it matters on the day, so it is lifted out and
// shown rather than swallowed or dropped.
const SELF_FUNDING = /\bself[\s-]*fund(?:ing|ed)?\b/i

/** Whether the patient is paying for their own implants. */
export function isSelfFunding(title, description) {
  return SELF_FUNDING.test(`${title || ''}\n${description || ''}`)
}

/** The title without the self-funding marker, so the rest of it parses. */
export function stripSelfFunding(title) {
  return String(title || '')
    .replace(/\([^)]*\bself[\s-]*fund(?:ing|ed)?\b[^)]*\)/gi, ' ')
    // The phrase with at most one separator either side, the same way
    // cancellations are taken off: rewriting every separator in a title turns
    // "L4-L5 TLIF" into "L4 L5".
    .replace(/\s*[-–—:|]?\s*\bself[\s-]*fund(?:ing|ed)?\b\s*[-–—:|]?\s*/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * The title, marked as called off.
 *
 * "CANCELLED" at the front, which is what the team has always written by hand —
 * so a booking cancelled from the app reads exactly like one cancelled the old
 * way, and every reader of the calendar already knows what it means.
 *
 * Idempotent: cancelling twice does not produce "CANCELLED CANCELLED". That is
 * not hypothetical — two people hearing the same news is the normal way a case
 * comes off.
 */
export function markCancelled(title) {
  const clean = stripCancellation(title)
  return clean ? `CANCELLED ${clean}` : 'CANCELLED'
}

export function stripCancellation(title) {
  return String(title || '')
    // "(cancelled)" and anything else in those brackets.
    .replace(/\([^)]*\b(?:cancel(?:l?ed|lation)?|postponed?|abandoned)\b[^)]*\)/gi, ' ')
    // The word, together with one separator either side of it — and no others.
    // Rewriting every separator in the title turned "L4-L5 TLIF" into "L4 L5".
    .replace(/\s*[-–—:|]?\s*\b(?:cancel(?:l?ed|lation)?|postponed?|abandoned)\b\s*[-–—:|]?\s*/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// The clinical procedure, from the event notes — "C5/6 ACDF" and the like.
// This is the most clinically meaningful thing about a case and was previously
// discarded: only the kit and the hospital were read out of the description.
//
// Accepts an explicit label, and otherwise takes the first line that is not the
// Kit line, which is where the team already writes it.
const OPERATION_LABEL = /\b(?:procedure|operation|op|surgery)\s*[:\-]\s*([^\n;|]+)/i
// A vertebral level or a known approach is a strong signal on its own, e.g.
// "C5/6", "L4-L5", "ACDF", "PLIF", "TLIF", "ALIF", "XLIF".
const CLINICAL_HINT = /\b([CTLS]\d{1,2}\s*[/\-–]\s*[CTLS]?\d{1,2}|ACDF|[APTX]LIF|laminectomy|discectomy|fusion|decompression|arthroplasty)\b/i

/**
 * Clinical fragments: a vertebral level, or a named approach. Global, because a
 * title carries several ("C4/5 ACDF").
 */
const CLINICAL_SPAN = /\b([CTLS]\d{1,2}(?:\s*[/\-–]\s*[CTLS]?\d{1,2})+|ACDF|[APTX]LIF|laminectomy|discectomy|fusion|decompression|arthroplasty|corpectomy)\b/gi

/**
 * Separates what was done from what it was done with.
 *
 * A booking title's middle section runs the two together — "C4/5 ACDF SHORELINE"
 * is an operation and an implant system in one string — while the operation is
 * often *also* written in the notes. Rendering both then says the same thing
 * twice: the operation appears in bold and again on the line beneath with the
 * system tacked on. Cases whose notes are empty showed it once, so the plan read
 * inconsistently from row to row.
 *
 * Splitting here rather than at the point of display means the operation and the
 * system are separate fields everywhere afterwards — on screen, in the text
 * export and in the document — and neither can be shown twice.
 *
 * @param {string} procedure   the title's middle section
 * @param {string} [fromNotes] an operation written out in the calendar notes,
 *                             which is preferred when present since it is
 *                             deliberate prose rather than a fragment of a title
 * @returns {{operation: string|undefined, system: string|undefined}}
 */
export function splitOperationAndSystem(procedure, fromNotes) {
  const text = String(procedure || '').trim()
  const spans = text.match(CLINICAL_SPAN) || []

  // Whatever is left once the clinical fragments are taken out is the system.
  let system = text
  for (const span of spans) system = system.replace(span, ' ')
  system = system
    // Separators orphaned by the removal: "C4/5 ACDF / SHORELINE" would leave a
    // leading slash behind.
    .replace(/\s+/g, ' ')
    .replace(/^[\s/+,\-–]+|[\s/+,\-–]+$/g, '')
    .replace(/([/+])\s*\1+/g, '$1')
    .trim()

  const operation = (fromNotes || spans.join(' ')).trim() || undefined
  // A system that only repeats the operation is not worth a line of its own.
  const same = operation && system && system.toLowerCase() === operation.toLowerCase()
  return { operation, system: same || !system ? undefined : system }
}

/**
 * How the kit is being supplied, and whether the kit line says anything the
 * system line has not already said.
 *
 * These were two lines showing one fact: a case with system DAKOTA and a notes
 * line "Kit: Dakota (consignment)" printed "DAKOTA" and then "Kit: Dakota
 * (consignment)" underneath it. The only new word in the second line was
 * "consignment".
 *
 * So the supply is pulled out and shown against the system, and the kit keeps a
 * line of its own only when it names something the system does not. That last
 * part matters: "STRYKER CCI" with "Kit: Stryker PSI" is two genuinely different
 * things — patient-specific instruments alongside the implant system — and
 * collapsing those would lose a kit the rep has to physically bring.
 *
 * @returns {{supply: string|undefined, kit: string|undefined}}
 */
/**
 * Whether one description of kit says anything the other has not already said.
 *
 * Filler is ignored, so "Mariner set" beside system MARINER reads as the same
 * thing rather than as a second kit. Only a *subset* says nothing new: a
 * candidate naming the system plus something else — "Diplomat + extra cages" — is
 * naming a second thing the rep has to physically bring, and dropping it would
 * lose it.
 */
export function addsNothingTo(candidate, existing) {
  const plain = value => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:set|sets|kit|kits|tray|trays|the|a)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = plain(candidate)
  const already = plain(existing)
  if (!words) return true
  if (!already) return false
  return words === already || already.includes(words)
}

export function describeSupply(system, kit) {
  const text = String(kit || '').trim()
  if (!text) return { supply: undefined, kit: undefined }

  const supply = /consignment/i.test(text) ? 'Consignment'
    : /\bloan(ed)?\b/i.test(text) ? 'Loan'
      : undefined

  // What the kit line says once the supply words and their brackets are gone.
  const remainder = text
    .replace(/\(?\s*(?:on\s+)?(?:consignment|loan(?:ed)?(?:\s+kit)?)\s*\)?/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,\-–]+|[\s,\-–]+$/g, '')
    .trim()

  // Filler is stripped before comparing, so "Mariner set" against system MARINER
  // reads as the same thing rather than as an extra kit to bring.
  const saysNothingNew = addsNothingTo(remainder, system)

  return { supply, kit: saysNothingNew ? undefined : remainder }
}

export function extractOperation(description) {
  const text = stripIdentifiers(description)
  if (!text) return undefined

  const labelled = OPERATION_LABEL.exec(text)
  if (labelled) {
    const value = labelled[1].trim().replace(/[.,;]$/, '')
    if (value) return value
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/[.,;]$/, '')
    if (!line) continue
    if (/^kit\s*[:\-]/i.test(line)) continue      // that's the kit line
    if (/^(rep|surgeon|hospital|theatre)\s*[:\-]/i.test(line)) continue
    // A first line is only taken as the operation if it reads clinical, so a
    // stray note ("call Erin first") is not mistaken for a procedure.
    if (CLINICAL_HINT.test(line)) return line
  }
  return undefined
}

// An explicit "Kit: ..." line in the event description. The title's middle part
// is the procedure; the kit is often a different set, e.g. procedure
// "STRYKER CCI" with "Kit: Stryker PSI".
export function extractKit(description) {
  const text = stripIdentifiers(description)
  if (!text) return undefined
  const m = /\bkit\s*[:\-]\s*([^\n;|]+)/i.exec(text)
  if (!m) return undefined
  const kit = m[1].trim().replace(/[.,;]$/, '')
  return kit || undefined
}

export const HOSPITALS = {
  RHH: 'RHH',
  CALVARY: 'CALVARY LENAH VALLEY',
  // Calvary run three hospitals we see. Lenah Valley is the Hobart one we are
  // at constantly; St John's is the other Hobart campus; St Luke's is in
  // Launceston, two hours up the highway.
  //
  // They were all one site here, matched on the word "Calvary", which is fine
  // until it is not: the consignment shelves are at Lenah Valley, so a St
  // Luke's case was told the kit was already there. Nobody driving to
  // Launceston wants to find that out on arrival. Rare is not the same as
  // never, and the rare one is exactly the one nobody double-checks.
  ST_JOHNS: 'CALVARY ST JOHNS',
  ST_LUKES: 'CALVARY ST LUKES',
  OFFSITE: 'OFFSITE'
}

/**
 * The hospital named in one piece of text, or null if it names none.
 *
 * Every way the team writes each one. "CLV" is the shorthand they type into the
 * location field, and it was not listed — so those bookings fell through to the
 * pass-through branch below and came back as a hospital called "CLV", sitting
 * beside "CALVARY LENAH VALLEY" as though Tuesday had cases at two different
 * places. The pass-through is useful for a genuinely offsite case and dangerous
 * for a name we simply failed to recognise, which is why the aliases are
 * asserted in the tests.
 */
function hospitalIn(text) {
  const value = String(text || '')
  if (!value.trim()) return null
  if (/\brhh\b|royal\s*hobart/i.test(value)) return HOSPITALS.RHH
  // The named Calvary campuses first. Both contain the word "Calvary", so
  // testing the generic pattern ahead of them would swallow the pair.
  if (/st\.?\s*luke(?:'?s)?/i.test(value)) return HOSPITALS.ST_LUKES
  if (/st\.?\s*john(?:'?s)?/i.test(value)) return HOSPITALS.ST_JOHNS
  if (/\bclv\b|calvary|lenah/i.test(value)) return HOSPITALS.CALVARY
  if (/offsite|off-site/i.test(value)) return HOSPITALS.OFFSITE
  return null
}

/**
 * Which hospital a case is at.
 *
 * Asked in order of authority, and the order is the whole point:
 *
 *   1. the event's own location field
 *   2. a labelled "Hospital:" line in the description
 *   3. anything else the description happens to say
 *
 * This used to mash the location and the description into one string and test
 * RHH first, which meant any mention of RHH anywhere in the notes outvoted the
 * location. A Calvary case whose notes read "Loan kit (RHH) transferred to
 * Calvary … return kit to RHH post-case" was filed under RHH — the notes were
 * about where the kit came from, not where the patient is.
 *
 * That is not a cosmetic grouping error. The hospital decides which consignment
 * applies, whether a loan set is needed, and which building a rep drives to at
 * seven in the morning. It has to come from the field that states it, not from
 * whatever the notes mention in passing.
 *
 * An unrecognised but non-empty location is still passed through, since Hospital
 * is an open string type and an offsite case can be anywhere.
 */
export function detectHospital(location, description, { caseEvent = true } = {}) {
  const stated = hospitalIn(location)
  if (stated) return stated

  const labelled = hospitalIn(parseLabelledDescription(description).hospital)
  if (labelled) return labelled

  // Last resort. Only reached when nothing actually says where the case is, and
  // a guess from the notes beats no answer at all.
  const mentioned = hospitalIn(description)
  if (mentioned) return mentioned

  const trimmed = String(location || '').trim()
  if (trimmed) return stripIdentifiers(trimmed).toUpperCase()
  return caseEvent ? HOSPITALS.RHH : HOSPITALS.OFFSITE
}

// A Google Calendar event → a normalised shape, with times always preserved.
// `allDay` events carry a `start.date` rather than `start.dateTime`.
export function normaliseEvent(event) {
  const startIso = event.start?.dateTime || null
  const endIso = event.end?.dateTime || null
  const allDay = !startIso
  return {
    id: event.id,
    title: stripIdentifiers(event.summary || ''),
    rawTitle: event.summary || '',
    description: event.description || '',
    location: event.location || '',
    colorId: event.colorId || null,
    allDay,
    start: startIso,
    end: endIso,
    startDate: startIso ? null : (event.start?.date || null),
    endDate: endIso ? null : (event.end?.date || null)
  }
}


// ─── One case, four facts ─────────────────────────────────────

const SUPPLY_PATTERN = /\(?\s*(?:on\s+)?(?:consignment|consigned|loan(?:ed)?(?:\s+(?:kit|set))?)\s*\)?/gi
// Words that only join other words together. Left stranded when a system name is
// lifted out of the middle of a sentence, and meaningless on their own.
const JOINERS = new Set(['with', 'using', 'and', 'plus', 'the', 'a', 'an', 'for',
  'via', 'in', 'of', 'set', 'sets', 'kit', 'kits', 'tray', 'trays', 'x'])

function stripSupply(text) {
  return String(text || '').replace(SUPPLY_PATTERN, ' ').replace(/\s+/g, ' ').trim()
}

function tidy(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s/+,\-–:;]+|[\s/+,\-–:;]+$/g, '')
    .trim()
}

/** Drops joining words left stranded at either end. */
function trimJoiners(words) {
  const bare = word => word.toLowerCase().replace(/[^a-z0-9]/g, '')
  const out = words.slice()
  while (out.length && JOINERS.has(bare(out[0]))) out.shift()
  while (out.length && JOINERS.has(bare(out[out.length - 1]))) out.pop()
  return out
}

/**
 * Cuts a description off after its last clinical term.
 *
 * A note is rarely only the operation — "L4/5 TLIF. TM Locking Distractor also
 * needed" is an operation followed by a request for kit. Everything up to the last
 * clinical term is the surgery; whatever trails it is about something else, and
 * leaving it in put the kit on the operation line as well as the kit line.
 *
 * Text *before* the first clinical term is kept, since that is where the surgery
 * is qualified: "Revision of L4/5 fusion" is not the same operation as "L4/5
 * fusion".
 */
function toLastClinical(text) {
  const scan = new RegExp(CLINICAL_SPAN.source, 'gi')
  let end = -1, match
  while ((match = scan.exec(text)) !== null) end = match.index + match[0].length
  return end === -1 ? '' : text.slice(0, end)
}

/**
 * Reads one booking into the four things the plan shows, with every fact assigned
 * to exactly one of them.
 *
 * This exists because the same case can be written half a dozen ways and used to
 * come out differently each time:
 *
 *   "Panthi SHORELINE - Gupta"           + note "C4/5 ACDF Shoreline"
 *   "Panthi C4/5 ACDF SHORELINE - Gupta" + note "C4/5 ACDF SHORELINE consignment"
 *   "Horne DAKOTA - Ibbett"              + note "L4/5 TLIF DAKOTA loan kit"
 *
 * Every one of those printed the system twice — once inside the bolded operation,
 * because the operation was taken as the whole note line, and again on the system
 * line beneath it. Two of them also lost the consignment or loan status, because
 * the word was sitting inside the operation text where nothing looked for it.
 *
 * So each fact is now found by what it is rather than by where it sits: the supply
 * is whichever of consignment or loan appears anywhere, the system is whichever
 * known system is named anywhere, and the operation is what is left of the
 * clinical description once those have been taken out of it.
 *
 * @returns {{operation, system, supply, kit}} any of which may be undefined
 */
export function describeCase(titleSection, description) {
  const title = stripIdentifiers(titleSection || '')
  const notes = stripIdentifiers(description || '')
  const everything = `${title}\n${notes}`

  // ── Supply, from wherever it was written ──
  const supply = /consign/i.test(everything) ? 'Consignment'
    : /\bloan(ed)?\b/i.test(everything) ? 'Loan'
      : undefined

  // ── System ──
  // The title's own wording is preferred, so "REFORM / ASCOT / ATHLET" keeps the
  // shape the team gave it rather than being rewritten.
  const fromTitle = splitOperationAndSystem(stripSupply(title))
  let system = fromTitle.system
  if (!system) {
    // Nothing usable in the title, so fall back to whatever is named in the
    // notes. A booking titled only "Kennedy - JPW" still gets its system.
    const named = findSystems(notes).map(s => s.name)
    if (named.length) system = named.join(' + ')
  }

  // ── Operation ──
  // The notes are preferred: written out deliberately, rather than squeezed into
  // a title alongside everything else.
  const operation = cleanOperation(extractOperation(notes) || fromTitle.operation,
    { system, context: everything, requireClinical: true })

  // ── Kit ──
  // Only what the system line does not already say. A TechnoMed loan set named
  // anywhere counts, since that is a physical set someone has to bring.
  const loanSets = findLoanSets(everything)
  const explicit = describeSupply(system, extractKit(notes)).kit
  const extras = [...new Set([...loanSets, ...(explicit ? [explicit] : [])])]
  const kit = extras.length ? extras.join(' · ') : undefined

  return { operation, system: system || undefined, supply, kit }
}


/**
 * Takes the system, the supply and any loan set out of an operation description.
 *
 * Shared by both routes into a case — a `Procedure:` label and a bare clinical
 * line in the notes — so a system named inside the description is removed the
 * same way whichever way it arrived, and can never appear on both the operation
 * line and the system line.
 *
 * @param {object} o
 * @param {string} [o.system]   the system, so its words can be removed
 * @param {string} [o.context]  all the booking's text, for finding system names
 * @param {boolean} [o.requireClinical] reject the result unless it still reads
 *   clinically. Right for a line guessed out of free text, wrong for a labelled
 *   field: someone who filled in "Procedure:" meant what they wrote there.
 * @param {boolean} [o.truncate] cut the text off after its last clinical term.
 */
export function cleanOperation(text, o = {}) {
  if (!text) return undefined
  const { system, context = text, requireClinical = false, truncate = requireClinical } = o

  // Words that name a procedure as well as appearing in a product's name. The
  // operation is allowed to keep them.
  //
  // "Global BMD PLIF" is a cage; "L5/S1 PSF and PLIF" is what is being done.
  // Once the kit resolves to the full product name, "plif" joins the words
  // stripped out of the operation — and the operation loses the word that says
  // what the operation is.
  const PROCEDURE_WORDS = new Set(['plif', 'alif', 'tlif', 'dlif', 'acdf', 'psf', 'lif'])

  // Anatomy, and which side of the body.
  //
  // The same trap one service along. A spine system is a brand — Diplomat,
  // Mariner — so stripping its words out of the operation is safe. An
  // orthopaedic set is named after the bone it goes on: "Synthes VA Proximal
  // Tibia Set, Sterile Lateral VA Plates and Medial LCP Plates". Dropping
  // those words left "Left proximal tibia, lateral and medial plates" reading
  // as "Left" — the side, and nothing else.
  //
  // These words can appear in a product name and can never be only a product
  // name. Losing which bone, or which side, is not a tidier operation; it is
  // a different one, and on a card somebody packs a tray from.
  const ANATOMY = new Set([
    'left', 'right', 'bilateral', 'proximal', 'distal', 'medial', 'lateral',
    'anterior', 'posterior', 'superior', 'inferior',
    'tibia', 'tibial', 'femur', 'femoral', 'fibula', 'humerus', 'radius',
    'ulna', 'clavicle', 'patella', 'calcaneus', 'scapula', 'pelvis',
    'ankle', 'wrist', 'elbow', 'shoulder', 'hip', 'knee', 'foot', 'hand'
  ])

  // What is being put in, and the words joining it together.
  //
  // "Lateral and medial plates" came back as "lateral medial": the kit names
  // plates, so "plates" went, and it names "and", so the conjunction went with
  // it. Neither is ever a product's identity on its own, and without them the
  // line stops being English.
  const FIXATION = new Set([
    'plate', 'plates', 'plating', 'screw', 'screws', 'nail', 'nails',
    'wire', 'wires', 'pin', 'pins', 'fixation', 'orif'
  ])
  const JOINERS = new Set(['and', 'with', 'plus', 'the', 'for', 'to', 'of', 'a'])

  const keep = word =>
    PROCEDURE_WORDS.has(word) || ANATOMY.has(word)
    || FIXATION.has(word) || JOINERS.has(word)

  const drop = new Set([
    ...systemWords(context),
    ...String(system || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
    // Loan sets belong on the kit line. Left in, they appeared on both.
    ...findLoanSets(context).join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  ].filter(word => !keep(word)))

  const kept = trimJoiners(
    stripSupply(text).split(/\s+/).filter(word => {
      const bare = word.toLowerCase().replace(/[^a-z0-9]/g, '')
      // A token with no letters or digits cannot be a system name, which is
      // the only thing this filter is for — so it is kept.
      //
      // It used to be dropped, and "C3/4 +/- C4/5" came out as "C3/4 C4/5".
      // That is not a tidier version of the same operation, it is a different
      // one: +/- means the second level may not be done at all, and reading it
      // as two levels changes what gets brought and what gets opened.
      if (!bare) return word.length > 0
      return !drop.has(bare)
    }))
  const rebuilt = tidy(truncate ? toLastClinical(kept.join(' ')) : kept.join(' '))
  if (!rebuilt) return undefined
  // A guessed line that no longer reads clinically was naming the system rather
  // than describing surgery, so there is no operation in it.
  if (requireClinical && !CLINICAL_HINT.test(rebuilt)) return undefined
  return rebuilt
}

/**
 * Reads a calendar booking into a case, or returns null if it is not one.
 *
 * The single entry point for "what is this booking?". Both the case plan and the
 * calendar view go through it, which is the point: the calendar view used to
 * render the raw event title instead, so the same booking appeared one way on one
 * screen and another way on the other, with the system and kit text showing
 * through exactly as it had been typed.
 */
/**
 * A booking's notes as plain text, whatever Google handed us.
 *
 * Google Calendar stores a description as HTML whenever it has been touched by
 * the web interface, by Outlook, or by an invitation forwarded from a supplier.
 * The same booking is then "Surg: Ibbett<br>Pt: Hays" rather than two lines,
 * and every labelled field in it reads as one unbroken run — so the parser
 * found no fields at all and the card came back blank. Not partly wrong:
 * blank, with the booking sitting there in Google looking perfectly fine.
 *
 * `<br>` and `</div>`, `</p>`, `</li>` become line breaks because that is what
 * they are to a reader; every other tag is dropped. Entities are decoded last,
 * so a `&lt;` that was written as text does not then get treated as markup.
 */
export function plainDescription(description) {
  const text = String(description || '')
  if (!/[<&]/.test(text)) return text          // the common case, untouched
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    // Google wraps lines generously; three blank lines in a row is not a
    // paragraph break anybody typed.
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function readBooking(title, description, { colourSurgeon } = {}) {
  // Before anything reads it. See plainDescription: a booking Google stored as
  // HTML has no line breaks the parser can see, so every labelled field runs
  // together and the card comes back blank rather than merely imperfect.
  description = plainDescription(description)
  // Both markers are read before anything else and taken off the title, because
  // both sit where the patient's name goes and both otherwise end up inside
  // whatever field parses next.
  const selfFunding = isSelfFunding(title, description)
  title = stripSelfFunding(stripCancellation(title))
  // Taken off before anything else reads the title. The surgeon matcher accepts
  // a surname buried in a longer string, so "Fowler (Mat)" was swallowed whole
  // and the rep disappeared.
  const { rep, reps, rest } = extractRep(title)
  title = rest
  const everything = `${title || ''}\n${description || ''}`
  // Labelled fields first. Where the team has written "Surgeon: Fowler" there is
  // nothing to infer, and inference was only ever a way of coping without them.
  const raw = parseLabelledDescription(description)
  // Identifiers are stripped on the way out of every labelled value, not only the
  // patient one. A UR number in "Patient:" was already handled; a date of birth
  // typed into "Procedure:" was not, and went straight to the screen.
  //
  // The cancellation marker is taken off here too, and for a sharper reason.
  // When a case comes off, the team writes CANCELLED by hand — into the title,
  // and often into the Pt: line as well. The title was cleaned; the labelled
  // fields never were, and a labelled field beats the title. So a booking
  // reading "Pt: CANCELLED Hays" came back with the patient as "CANCELLED" and
  // the surname thrown away, which is the one thing on the card anybody uses to
  // find the case again. A cancelled case still has to be traceable: kit was
  // moved for it, somebody may have driven to it, and it is the case most
  // likely to be asked about afterwards.
  //
  // Only the displayed value is cleaned. isCancelled still reads the raw title
  // and description, so the strikethrough and the badge are untouched.
  const labelled = Object.fromEntries(
    Object.entries(raw).map(([field, value]) =>
      [field, stripCancellation(stripSelfFunding(stripIdentifiers(value)))]))
  // Resolved before anything reads it, so a booking accepted onto the calendar
  // with "Implanet" on it still shows the system somebody can actually bring.
  const fromTitle = parseCaseTitle(title, { colourSurgeon })

  // ── Repairing a description written before surnames could have spaces ──
  //
  // A labelled field beats the title, and rightly: "Pt:" is what the team
  // typed. But La Pietra's booking was *written* by this app back when the
  // surname was taken to be one word, so the description it saved says
  // "Pt: La" and "Procedure: Pietra ATHLET and ASCOT". Fixing the parser did
  // nothing for it — the damage is in the stored text, and the stored text
  // wins.
  //
  // Reported as: "the title has changed correctly but when you edit in edit
  // booking it still just says La in the patient name, then in the
  // description it has pietra ATHLET and ASCOT. It's all over the place."
  //
  // Narrow on purpose. It only fires where the labelled patient is a bare
  // particle — never a surname on its own — and the title's reading of the
  // same booking starts with that particle and carries on. Both conditions
  // together describe one thing: a name this app cut in half.
  const labelledPatient = sanitisePatient(labelled.patient)
  const titlePatient = fromTitle?.patient
  const severed = Boolean(labelledPatient && titlePatient
    && isBareParticle(labelledPatient)
    && titlePatient.toLowerCase().startsWith(`${labelledPatient.toLowerCase()} `))
  // The rest of the name, which is sitting at the front of the procedure.
  const strandedName = severed
    ? titlePatient.slice(labelledPatient.length).trim()
    : ''

  if (severed && strandedName) {
    // The stranded half of the name is at the front of whichever labelled
    // field the app happened to write it into when it mis-read the title.
    // That was the procedure on one booking and the kit on another — "Kit:
    // Pietra ATHLET AND ASCOT PLATE" — so it comes off all of them rather
    // than off the one that was noticed first.
    //
    // Only the exact word, and only at the front: a field that merely
    // mentions it further along is saying something else.
    const lead = new RegExp(`^\\s*${strandedName}\\b[\\s,/-]*`, 'i')
    for (const field of ['procedure', 'kit', 'system', 'notes']) {
      const value = labelled[field]
      if (!value) continue
      const trimmed = String(value).replace(lead, '').trim()
      if (trimmed) labelled[field] = trimmed
    }
  }


  // After the repair, deliberately: this reads labelled.kit, and a kit with
  // half a surname on the front of it is what started all this.
  const kitField = parseKitField(resolveKit(labelled.kit, labelled.procedure || ''))

  const patient = (severed ? titlePatient : labelledPatient) || fromTitle?.patient
  const surgeon = normaliseSurgeon(labelled.surgeon) || fromTitle?.surgeon
  // Both names are needed. Without them this is a meeting, a list marker or a
  // staffing entry, and calling it a case would put a half-blank card on the day.
  if (!patient || !surgeon) return null

  // Free-text reading still runs, as the fallback for whatever was not labelled.
  const inferred = describeCase(fromTitle?.procedure, description)

  // Two conventions are live in the calendar, and "Kit:" means something
  // different in each.
  //
  // In a properly labelled booking it is the system field — that is what the
  // label is for — so it is what the system line shows.
  //
  // In an older free-text booking, where "Kit:" is the only label on an otherwise
  // prose note, it often names an *extra* set to bring while the title names the
  // system: "Gill STRYKER CCI - Fowler" with "Kit: Stryker PSI on loan" is an
  // implant system and a tray of patient-specific instruments, two things.
  // Collapsing those would lose one.
  //
  // The presence of the other labels is what tells them apart.
  const isLabelled = Boolean(labelled.patient || labelled.surgeon
    || labelled.procedure || labelled.hospital)

  inferred.system = closeBrackets(inferred.system)
  const system = isLabelled
    // Even here the title can have the better wording: "Kit: Mariner set" beside
    // a title reading MARINER is the same system in worse words.
    ? (kitField.system && !addsNothingTo(kitField.system, inferred.system)
      ? kitField.system : (inferred.system || kitField.system))
    : (inferred.system || kitField.system)
  const supply = kitField.type || inferred.supply
  // The supply for each system named, read from the raw field before
  // parseKitField strips the brackets out of it.
  //
  // `supply` above is one answer for the whole booking, which is right until a
  // case names two systems with different answers — and then it is whichever
  // was read first, shown against both. "Mariner (DT LOAN) E4 Global PLIF
  // (Consignment)" came out as "Mariner / E4 Global PLIF · Distributor Loan",
  // saying the cages were on loan when they are on the shelf.
  const supplies = parseKitSupplies(
    resolveKit(labelled.kit, labelled.procedure || '') || title)
  const operation = cleanOperation(labelled.procedure, { system, context: everything })
    || inferred.operation
  const kit = isLabelled ? undefined : inferred.kit

  return {
    patient,
    surgeon,
    surgeonSource: normaliseSurgeon(labelled.surgeon) ? 'label'
      : (fromTitle?.surgeonSource || undefined),
    // A labelled procedure is trusted as written, beyond having the system and
    // supply lifted out of it so they cannot appear twice.
    operation,
    system,
    supply,
    supplies,
    // A labelled booking has said everything on the system line already.
    kit,
    hospital: hospitalCode(labelled.hospital),
    // Where we are on that hospital's list, when somebody has rung and been
    // told. Not inferred from anything — an invented running order is worse
    // than a blank one, because nobody would know to check it.
    listPlace: parseListPlace(labelled.list) || undefined,
    navigation: findNavigation(everything).join(' + ') || undefined,
    notRequired: attendanceNotRequired(everything) || undefined,
    // The hospital told us about the case and said nobody from here is wanted
    // in the room. Worth having on the calendar — it is why a theatre is busy
    // and why a surgeon is unavailable — and it must not read as a case we are
    // attending. See attendance.js.

    // Who attended, or who is covering it. The calendar carries this and the
    // app was dropping it. Two reps on one case is normal.
    rep,
    reps,
    // The patient is paying for their own implants. Shown on the card, because
    // it changes what happens on the day and it was being lost in the parse.
    selfFunding: selfFunding || undefined,
    // What the team wrote in the notes that no field has a name for: why a case
    // moved, who called it in, what still has to be ordered. Every line goes
    // through stripIdentifiers, because free prose is exactly where a date of
    // birth or a full name gets typed.
    notes: descriptionNotes(description)
      .map(stripIdentifiers)
      .filter(Boolean)
      // A note that only repeats a field already on the card is not a note. An
      // unlabelled first line is read as the operation — "L5/S1 ALIF" above a
      // "Kit:" line is the common shape — and it would otherwise appear twice,
      // once in bold and once underneath as commentary on itself.
      .filter(note => !saysOnly(note, { patient, surgeon, system, supply, operation, kit }))
      // The pre-operative workup — bloods, ECG, fasting, consent. It matters
      // enormously and none of it to us, and left in it is most of the booking.
      // Filtered here, where a booking is read, so the ones already on the
      // calendar come good too.
      .filter(note => !isPreOpNoise(note)),
    // Anything in the title that reached none of the fields above — but only
    // for a free-text booking, where the title *is* the record.
    //
    // Where the description carries labels, that is the record and the title is
    // decoration: often a bare placeholder like "Booking" or "RHH Spine".
    // Reporting those words as unread detail is exactly the raw-text noise this
    // app was asked to stop showing. Checking `fromTitle` alone is not enough —
    // the colour hint lets a placeholder title parse as a case.
    unread: (!isLabelled && fromTitle)
      ? leftoverOf(title, { patient, surgeon, system, supply, operation, kit })
      : undefined
  }
}

/**
 * What the title said that nothing above captured.
 *
 * The parser's habit is to drop whatever it cannot place, on the reasoning that
 * a raw fragment looks like data and is worse than a clean gap. That is right
 * for noise and wrong for everything else, and it fails silently either way: the
 * attending rep sat in the calendar title and simply never appeared, with
 * nothing on screen to suggest anything was missing.
 *
 * So the remainder is shown. A booking is a record the team relies on being
 * complete, and a word they typed going missing is the more serious failure.
 *
 * Conservative on purpose — anything already displayed, any separator, any
 * one-character scrap drops out — so an ordinary booking yields nothing here and
 * the line appears only when the title really does hold something unplaced.
 */
// One tokeniser for both sides, which matters more than it looks. Splitting the
// title one way and the shown values another made "C4/5 ACDF" report "C4/5" as
// unread — it was on screen the whole time — and "Kennedy REFORM-JPW" report the
// entire rest of the title. A leftover check that cries wolf gets ignored, and
// then it is not a check.
const tokens = value => String(value || '')
  .split(/[\s>/(),.+·-]+/)
  .map(word => word.trim())
  .filter(Boolean)

/**
 * Drops a bracket that opens and never closes.
 *
 * A title like "Farr CYLOX (second LOAN kit) - Thani" is split on the dash, and
 * the system inferred from the left-hand side came back as "CYLOX (second" —
 * a fragment cut mid-parenthesis, shown on the card exactly like that. It reads
 * as corruption, which as far as the person looking at it is concerned it is.
 */
function closeBrackets(value) {
  const text = String(value || '')
  const open = (text.match(/[([{]/g) || []).length
  const close = (text.match(/[)\]}]/g) || []).length
  if (open <= close) return value
  return text.replace(/\s*[([{][^)\]}]*$/, '').trim() || undefined
}

/** Whether every word of `text` already appears among the shown fields. */
function saysOnly(text, shown) {
  const known = new Set(Object.values(shown).flatMap(tokens).map(w => w.toLowerCase()))
  const words = tokens(text).filter(w => w.length > 1)
  return words.length > 0 && words.every(w => known.has(w.toLowerCase()))
}

function leftoverOf(title, shown) {
  const known = new Set(Object.values(shown).flatMap(tokens).map(w => w.toLowerCase()))
  // Reported as typed. "URGENT" is shouted for a reason, and lowercasing it
  // would quietly edit the one thing here that exists to be read literally.
  const left = tokens(title).filter(word => word.length > 1 && !known.has(word.toLowerCase()))
  return left.length ? left.join(' ') : undefined
}
