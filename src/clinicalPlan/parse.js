import { findSystems, findLoanSets, systemWords, findNavigation } from './systems.js'
import { parseLabelledDescription, parseKitField, hospitalCode } from './labelledFields.js'
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

  const drop = new Set([
    ...systemWords(context),
    ...String(system || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
    // Loan sets belong on the kit line. Left in, they appeared on both.
    ...findLoanSets(context).join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  ])

  const kept = trimJoiners(
    stripSupply(text).split(/\s+/).filter(word => {
      const bare = word.toLowerCase().replace(/[^a-z0-9]/g, '')
      return bare && !drop.has(bare)
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
export function readBooking(title, description, { colourSurgeon } = {}) {
  const everything = `${title || ''}\n${description || ''}`
  // Labelled fields first. Where the team has written "Surgeon: Fowler" there is
  // nothing to infer, and inference was only ever a way of coping without them.
  const raw = parseLabelledDescription(description)
  // Identifiers are stripped on the way out of every labelled value, not only the
  // patient one. A UR number in "Patient:" was already handled; a date of birth
  // typed into "Procedure:" was not, and went straight to the screen.
  const labelled = Object.fromEntries(
    Object.entries(raw).map(([field, value]) => [field, stripIdentifiers(value)]))
  const kitField = parseKitField(labelled.kit)
  const fromTitle = parseCaseTitle(title, { colourSurgeon })

  const patient = sanitisePatient(labelled.patient) || fromTitle?.patient
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

  const system = isLabelled
    // Even here the title can have the better wording: "Kit: Mariner set" beside
    // a title reading MARINER is the same system in worse words.
    ? (kitField.system && !addsNothingTo(kitField.system, inferred.system)
      ? kitField.system : (inferred.system || kitField.system))
    : (inferred.system || kitField.system)
  const supply = kitField.type || inferred.supply

  return {
    patient,
    surgeon,
    surgeonSource: normaliseSurgeon(labelled.surgeon) ? 'label'
      : (fromTitle?.surgeonSource || undefined),
    // A labelled procedure is trusted as written, beyond having the system and
    // supply lifted out of it so they cannot appear twice.
    operation: cleanOperation(labelled.procedure, { system, context: everything })
      || inferred.operation,
    system,
    supply,
    // A labelled booking has said everything on the system line already.
    kit: isLabelled ? undefined : inferred.kit,
    hospital: hospitalCode(labelled.hospital),
    navigation: findNavigation(everything).join(' + ') || undefined
  }
}
