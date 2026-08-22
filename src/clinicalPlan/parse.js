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

// `Vanderheim MARINER + E4 CAGES - Gupta` → the split is on the LAST " - ",
// because a kit can itself contain a hyphen.
export function parseCaseTitle(title) {
  const raw = String(title == null ? '' : title).trim()
  if (!raw) return null

  const separator = /\s+[-–—]\s+/g
  let lastIndex = -1, lastLength = 0, match
  while ((match = separator.exec(raw)) !== null) {
    lastIndex = match.index
    lastLength = match[0].length
  }
  if (lastIndex === -1) return null

  const left = raw.slice(0, lastIndex).trim()
  const right = raw.slice(lastIndex + lastLength).trim()

  const surgeon = normaliseSurgeon(right)
  if (!surgeon) return null // no known surgeon → not a surgical case

  const leftTokens = left.split(/\s+/)
  if (leftTokens.length < 2) return null // needs a patient AND a kit/procedure

  const patient = sanitisePatient(leftTokens[0])
  if (!patient) return null

  const procedure = stripIdentifiers(leftTokens.slice(1).join(' '))
  if (!procedure) return null

  return { patient, procedure, surgeon }
}

export function isSurgicalCase(title) {
  return parseCaseTitle(title) !== null
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
