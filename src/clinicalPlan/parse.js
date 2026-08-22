// ─── Event parsing ────────────────────────────────────────────────────────────
// Surgical cases are titled `<Patient surname> <KIT> - <Surgeon>`. Everything
// else on the bookings calendar is a non-case item.
//
// Privacy (§10) is enforced here, at the boundary: identifiers are stripped as
// events are parsed, so nothing beyond a surname is ever stored in a WeekPlan,
// cached, exported or rendered — regardless of what a calendar event contains.

export const SURGEON_KEYS = [
  'Hannan', 'Dubey', 'Thani', 'Fowler', 'Ibbett', 'JPW', 'Gupta', 'Atallah', 'Garg'
]

const SURGEON_LOOKUP = new Map(SURGEON_KEYS.map(k => [k.toLowerCase(), k]))

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
  const token = beforeComma.split(/\s+/)[0] || ''
  const letters = token.replace(/[^A-Za-z'’\-]/g, '')
  if (!letters) return ''
  return letters.charAt(0).toUpperCase() + letters.slice(1)
}

export function normaliseSurgeon(raw) {
  const cleaned = stripIdentifiers(raw).replace(/^(dr|mr|mrs|ms|prof|professor|a\/prof)\b\.?/i, '').trim()
  if (!cleaned) return null
  const direct = SURGEON_LOOKUP.get(cleaned.toLowerCase())
  if (direct) return direct
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
const SEPARATOR = /\s*[-–—:]\s*/g

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

  const words = String(caseText || '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return null

  // Inference from colour alone is only allowed where the first word actually
  // reads like a surname, so "Theatre 3 list" does not become a patient.
  if (surgeonSource === 'colour' && !looksLikeSurname(words[0])) return null

  const patient = sanitisePatient(words[0])
  if (!patient) return null

  return {
    patient,
    procedure: stripIdentifiers(words.slice(1).join(' ')),
    surgeon,
    surgeonSource
  }
}

export function isSurgicalCase(title, hint) {
  return parseCaseTitle(title, hint) !== null
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
  OFFSITE: 'OFFSITE'
}

// Hospital from the event's location, falling back to its description. An
// unrecognised but non-empty location is passed through, since Hospital is an
// open string type.
export function detectHospital(location, description, { caseEvent = true } = {}) {
  const haystack = `${location || ''} ${description || ''}`
  if (/\brhh\b|royal\s*hobart/i.test(haystack)) return HOSPITALS.RHH
  if (/calvary|lenah/i.test(haystack)) return HOSPITALS.CALVARY
  if (/offsite|off-site/i.test(haystack)) return HOSPITALS.OFFSITE
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
