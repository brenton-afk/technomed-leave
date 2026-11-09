// ─── Usage case normalisation ─────────────────────────────────────────────────
import { itemGaps } from '../src/usageItemCheck.js'
import { surnameFromField } from '../src/clinicalPlan/parse.js'
import { findSystems } from '../src/clinicalPlan/systems.js'
// Turns whatever the vision extraction returned into a normalised case record:
// distributors resolved by our own rules, peripherals dropped, uncertain rows
// flagged, and the Dropbox folder name derived. Deliberately does not trust the
// model's own distributor guess — DISTRIBUTOR_RULES is the authority.
import { detectDistributor, distributorName, isExcludedProduct } from './_distributors.js'

const HOSPITALS = { CLV: 'CLV', RHH: 'RHH' }

function str(v) {
  return typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim())
}

// "Smith", "Dr Andrew Thani", "THANI A" → the surname, for folder paths.
export function surnameOf(fullName) {
  const cleaned = str(fullName)
    .replace(/\b(dr|mr|mrs|ms|miss|prof|professor|a\/prof|assoc)\b\.?/gi, '')
    .replace(/[^A-Za-z\s'-]/g, ' ')
    .trim()
  if (!cleaned) return ''
  const parts = cleaned.split(/\s+/)
  // "SURNAME, First" is common on printed labels.
  if (str(fullName).includes(',')) return titleCase(parts[0])
  return titleCase(parts[parts.length - 1])
}

function titleCase(word) {
  if (!word) return ''
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

// YYYY-MM-DD → DDMMYYYY for the folder name.
export function ddmmyyyy(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(isoDate))
  if (!m) return ''
  return `${m[3]}${m[2]}${m[1]}`
}

export function monthFolder(isoDate) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(str(isoDate))
  if (!m) return ''
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  const monthName = months[parseInt(m[2], 10) - 1]
  return monthName ? `${monthName} ${m[1]}` : ''
}

// Dropbox and Windows both choke on these, and the folder name doubles as the
// email subject, so keep it to a safe, predictable character set.
function safeSegment(value) {
  return str(value)
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ /g, '-')
}

// ─── The procedure as a label, not a description (Brent, 5 Nov 2026) ─────────
// "You don't need a full op description including hyphens. Just use the
// keywords/acronyms: PLIF, ACDF, Fixation, TLIF, ALIF, Boost UF." A folder
// called Smith_05112026_Thani_C5-6-anterior-cervical-discectomy-and-fusion_CLV
// is a line nobody can scan in Dropbox. Every keyword the operation (or, for
// Boost, the implants used) mentions, in this order, joined by "+".
const PROCEDURE_KEYWORDS = [
  ['ACDF', /\bacdf\b|anterior\s+cervical\s+disc\w*(\s+(and|&|\+))?\s+fusion/i],
  ['ALIF', /\balif\b|anterior\s+lumbar\s+interbody/i],
  ['PLIF', /\bplif\b|posterior\s+lumbar\s+interbody/i],
  ['TLIF', /\btlif\b|transforaminal/i],
  ['Fixation', /fixation|\bfixate|\bpsf\b|pedicle\s+screw|instrument(ed|ation)|stabili[sz]ation|posterior\s+(spinal\s+)?fusion|percutaneous\s+screw/i],
  ['Boost UF', /\bboost\b|ultrafib/i]
]
const LEVEL = /^[CTLS]\d{1,2}([-/]?[CTLS]?\d{1,2})*$/i

export function procedureLabel(procedure, items = []) {
  const text = str(procedure)
  const used = items.map(i => `${i?.productName || ''} ${i?.referenceCode || ''}`).join(' ')
  const found = PROCEDURE_KEYWORDS
    .filter(([name, re]) => re.test(text) || (name === 'Boost UF' && /\bboost\b|ultrafib|ABT-AB/i.test(used)))
    .map(([name]) => name)
  if (found.length) return found.join('+')
  // Nothing on the list: an acronym the form used (XLIF, OLIF…), else the
  // first two words — short either way, never the whole description.
  const words = text.replace(/[^A-Za-z0-9/ -]/g, ' ').split(/\s+/).filter(w => w && !LEVEL.test(w))
  const acronym = words.find(w => /^[A-Z]{3,6}$/.test(w))
  return acronym || words.slice(0, 2).join(' ')
}

const BOOST_ITEM = /\bboost\b|ultrafib|ABT-AB/i

/**
 * The case's name as one distributor should see it (Toni, 9 Nov 2026: the
 * Shoreline usage went to Device titled "…_Boost-UF_RHH" — Boost was on the
 * form but not in Device's sheet). The folder name stays the case's identity
 * in Dropbox; the email subject and attachment names say what is in *this*
 * distributor's sheet: the operation, Boost UF only if their items are Boost,
 * and the systems their items name — "Boyd_09112026_Fowler_ACDF+Shoreline_RHH".
 */
export function nameForDistributor(folderName, procedure, items = []) {
  const name = str(folderName)
  const parts = name.split('_')
  const at = parts.findIndex(p => /^\d{8}$/.test(p))
  if (at < 1 || parts.length < at + 3) return name
  // A "_2" on the end (a second case that day) stays on the end.
  const suffix = /^\d{1,2}$/.test(parts[parts.length - 1]) ? [parts.pop()] : []
  if (parts.length < at + 4) return name
  const surgeon = parts[at + 1]
  const hospital = parts[parts.length - 1]

  const used = items.map(i => `${i?.productName || ''} ${i?.referenceCode || ''}`).join(' ')
  const boost = BOOST_ITEM.test(used)
  const ops = PROCEDURE_KEYWORDS
    .filter(([label, re]) => label !== 'Boost UF' && re.test(str(procedure)))
    .map(([label]) => label)
  const systems = findSystems(items.map(i => i?.productName || '').join(' | '))
    .map(s => s.name)
    .filter(s => !(boost && /boost/i.test(s)))
  const label = [...new Set([...ops, ...(boost ? ['Boost UF'] : []), ...systems])].join('+')
  if (!label) return name
  return [...parts.slice(0, at + 2), safeSegment(label), hospital, ...suffix].join('_')
}

// {Patient Surname}_{DDMMYYYY}_{Surgeon Surname}_{Procedure}_{Hospital}
export function buildFolderName({ patientSurname, date, surgeonSurname, procedure, hospital, items }) {
  return [
    safeSegment(patientSurname) || 'UnknownPatient',
    ddmmyyyy(date) || 'UnknownDate',
    safeSegment(surgeonSurname) || 'UnknownSurgeon',
    safeSegment(procedureLabel(procedure, items)) || 'Procedure',
    safeSegment(hospital) || 'Hospital'
  ].join('_')
}

/**
 * A case folder name, read back into its parts.
 *
 * The inverse of buildFolderName, for showing a patient's history as cases
 * rather than as a column of underscores. The folder name is the only record
 * of what a filed case *was* — Dropbox holds no metadata of ours — so this is
 * how the app knows that a 2024 folder was Thani doing an ACDF at the RHH.
 *
 * Deliberately forgiving. These folders go back years; some were filed by
 * hand before the app existed, some have a procedure with an underscore in it,
 * and a strict parser would simply hide them. Anything unrecognisable comes
 * back with `recognised: false` and its raw name, because a case the app
 * cannot parse still has to be findable — that is the whole point of a
 * patient history.
 */
export function parseFolderName(name) {
  const raw = str(name)
  const bare = raw.replace(/_(?:Usage[_-]?Sheet|Scan)\.\w+$/i, '')
  const parts = bare.split('_')
  const unknown = {
    recognised: false, raw, patientSurname: '', date: '',
    surgeonSurname: '', procedure: '', hospital: ''
  }
  if (parts.length < 2) return unknown

  // The date is the anchor: it is the one field with a fixed shape, so it is
  // found rather than counted to. A procedure containing an underscore then
  // cannot shift every field after it along by one, which is what counting
  // would do.
  const at = parts.findIndex(p => /^\d{8}$/.test(p))
  if (at < 1) return { ...unknown, patientSurname: parts[0] || '' }

  const d = parts[at]
  const iso = `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}`
  // A folder named with a date that is not a date — 31022026, 99999999 — is
  // not a case we can place in time, and saying "31 Feb" would be worse than
  // saying nothing. Built from the parts and checked for coming back out the
  // same, because Date rolls 31 February over into 3 March rather than
  // refusing it, and a case would file itself under the wrong month.
  const [yy, mm, dd] = iso.split('-').map(Number)
  const made = new Date(Date.UTC(yy, mm - 1, dd))
  const real = mm >= 1 && mm <= 12
    && made.getUTCFullYear() === yy
    && made.getUTCMonth() === mm - 1
    && made.getUTCDate() === dd

  const rest = parts.slice(at + 1)
  return {
    recognised: true,
    raw,
    patientSurname: parts.slice(0, at).join(' '),
    date: real ? iso : '',
    surgeonSurname: rest[0] ? rest[0].replace(/-/g, ' ') : '',
    // Everything between the surgeon and the hospital is the procedure, so an
    // underscore in it survives instead of eating the hospital.
    //
    // Dashes are left alone here, unlike the surgeon and the hospital. At
    // filing time safeSegment turns both spaces and slashes into dashes, so
    // "C5/6 ACDF" is already "C5-6-ACDF" on disk and the difference is gone.
    // Turning them back into spaces would render it "C5 6 ACDF", which reads
    // as a different operation — the same class of mistake as dropping the
    // "+/-" from Pt Quintrell's. Faithful to the folder name beats tidy.
    procedure: rest.slice(1, -1).join(' '),
    hospital: rest.length > 1 ? rest[rest.length - 1].replace(/-/g, ' ') : ''
  }
}

function parseQuantity(raw) {
  const s = str(raw)
  if (!s) return { quantity: 1, uncertain: true }
  // Handles "x1", "×3", "3", "Qty 2", "1 (one)".
  const m = /(\d+)/.exec(s.replace(/[×✕✖]/g, 'x'))
  if (!m) return { quantity: 1, uncertain: true }
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n < 1 || n > 99) return { quantity: 1, uncertain: true }
  return { quantity: n, uncertain: false }
}

function normaliseHospital(raw) {
  const s = str(raw).toUpperCase()
  if (HOSPITALS[s]) return s
  if (/CALVARY|LENAH/.test(s)) return 'CLV'
  if (/ROYAL|HOBART|\bRHH\b/.test(s)) return 'RHH'
  return ''
}

function normaliseDate(raw) {
  const s = str(raw)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // DD/MM/YYYY or DD-MM-YY — Australian order, which is what the forms use.
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s)
  if (m) {
    const day = m[1].padStart(2, '0')
    const month = m[2].padStart(2, '0')
    const year = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${year}-${month}-${day}`
  }
  return ''
}

// One extracted row → one normalised line item.
export function normaliseItem(raw, index) {
  const productName = str(raw.productName || raw.product || raw.systemName)
  const referenceCode = str(raw.referenceCode || raw.ref || raw.catalogueCode)
  const lotNumber = str(raw.lotNumber || raw.lot)
  const description = str(raw.description)
  const size = str(raw.size || raw.dimensions)
  const rebateCode = str(raw.rebateCode)
  const modelDistributor = str(raw.distributor || raw.manufacturer)
  const notes = str(raw.notes)

  const searchText = [productName, referenceCode, description, modelDistributor].join(' ')
  const excluded = isExcludedProduct(productName, description, modelDistributor)
  const distributorKey = detectDistributor(searchText)
  const { quantity, uncertain: quantityUncertain } = parseQuantity(raw.quantity)

  // Anything the model was unsure of, anything we could not route, and anything
  // missing a product name goes to review. The rep confirms before it is sent.
  const reasons = []
  if (raw.manualReview === true || raw.needsReview === true) reasons.push('flagged by extraction')
  if (str(raw.confidence).toLowerCase() === 'low') reasons.push('low confidence')
  if (!productName) reasons.push('no product name read')
  if (!distributorKey && !excluded) reasons.push('distributor not identified')
  if (quantityUncertain) reasons.push('quantity unclear')
  // A line a distributor cannot resupply from (Brent, 9 Nov 2026): no product
  // code, or a rod or screw with no size. See src/usageItemCheck.js.
  if (!excluded) reasons.push(...itemGaps({ productName, description, size, referenceCode }))

  return {
    id: `item-${index}`,
    distributorKey: distributorKey || null,
    distributor: distributorKey ? distributorName(distributorKey) : '',
    productName,
    referenceCode,
    lotNumber,
    description,
    size,
    quantity,
    rebateCode,
    notes,
    handwritten: raw.handwritten === true,
    excluded,
    manualReview: !excluded && reasons.length > 0,
    reviewReasons: reasons
  }
}

/**
 * A date typed by the device, trusted only as far as it is plausible.
 *
 * The client sends its own local date because the server has none: Vercel runs in
 * UTC, and for most of a Hobart evening "today" there is already tomorrow here.
 * It arrives from the request, though, so it is checked rather than believed — it
 * ends up in the folder name and on the emailed sheet, and a garbage value would
 * file a case somewhere nobody would find it again.
 */
function plausibleScanDate(raw) {
  const date = normaliseDate(raw)
  if (!date) return ''
  const asTime = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(asTime)) return ''
  const now = Date.now()
  // A day either side for timezones, and no further: this is meant to be today.
  if (asTime > now + 36 * 3600e3) return ''
  if (asTime < now - 36 * 3600e3) return ''
  return date
}

/**
 * Builds the full case from the extraction payload plus the signed-in rep.
 *
 * `scanDate` is the date on the device doing the scanning, and it is what the
 * surgery date becomes. A form is scanned in theatre or straight after, so today
 * is a better assumption than a handwritten date read off a photograph — those
 * come back misread often enough that the folder name, which is derived from the
 * date, was the thing most often wrong.
 *
 * What the form says is kept as `dateOnForm` rather than thrown away. Where the
 * two disagree the rep is told, because a genuine mismatch means either the scan
 * is late or the date was misread, and only they can say which.
 */
export function normaliseCase(extracted, { repName, repEmail, scanDate }) {
  // The whole surname. surnameOf keeps the *last* word, which is right for a
  // surgeon written "Dr Andrew Thani" and wrong for a patient: "Van der Berg"
  // was filed in Dropbox as "Berg". See surnameFromField.
  const patientSurname = surnameFromField(extracted.patientSurname) ||
    str(extracted.patientSurname)
  const surgeonSurname = surnameOf(extracted.surgeonName)
  const dateOnForm = normaliseDate(extracted.date)
  const scanned = plausibleScanDate(scanDate)
  const date = scanned || dateOnForm
  const hospital = normaliseHospital(extracted.hospital)
  const procedure = str(extracted.procedure || extracted.procedureDescription)

  const items = (Array.isArray(extracted.items) ? extracted.items : [])
    .map(normaliseItem)
    .filter(it => it.productName || it.referenceCode || it.lotNumber)
    // Not TechnoMed's (Floseal, TachoSil, Gelfoam, other haemostats): left off
    // the scan entirely rather than listed as excluded for the rep to scroll past.
    .filter(it => !isExcludedProduct(it.productName, it.description, it.referenceCode))

  const caseDetails = {
    // Pages of the scan that are a Boost tracking form (1-based), sent to the
    // Boost team on their own and left off every distributor's copy of the scan.
    boostTrackingPages: (Array.isArray(extracted.boostTrackingPages) ? extracted.boostTrackingPages : [])
      .map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 20),
    patientSurname,
    // Surname only, deliberately. The first name and the UR number used to be
    // read off the label and kept here, which put a hospital MRN into Redis,
    // onto the review screen and into the workbook emailed to distributors.
    // The app needs a surname — for the folder name, the email subject and the
    // review screen — and nothing else identifies a patient to us.
    surgeonName: str(extracted.surgeonName),
    surgeonSurname,
    date,
    // Where the date came from, and what the form said, so the review screen can
    // point out a disagreement rather than quietly overwriting one.
    dateSource: scanned ? 'scan' : (dateOnForm ? 'form' : 'none'),
    dateOnForm,
    // What was filled in without being asked, so a later edit is distinguishable
    // from the original assumption.
    dateSuggested: date,
    hospital,
    procedure,
    // The signed-in user is the authority on who scanned it; what the form says
    // is kept only as a cross-check for the rep.
    repName: str(repName) || str(extracted.repName),
    repNameOnForm: str(extracted.repName),
    repEmail: str(repEmail)
  }

  const missing = []
  if (!patientSurname) missing.push('patient surname')
  if (!date) missing.push('date')
  if (!surgeonSurname) missing.push('surgeon')
  if (!hospital) missing.push('hospital')
  if (!procedure) missing.push('procedure')

  return {
    ...caseDetails,
    folderName: buildFolderName({ patientSurname, date, surgeonSurname, procedure, hospital, items }),
    monthFolder: monthFolder(date),
    items,
    missingFields: missing,
    needsReview: missing.length > 0 || items.some(i => i.manualReview)
  }
}

// Re-derives folder name and distributor labels after the rep edits the review
// screen, so a corrected surname or product flows through to Dropbox and email.
export function recomputeCase(caseRecord) {
  const patientSurname = str(caseRecord.patientSurname)
  const surgeonSurname = str(caseRecord.surgeonSurname) || surnameOf(caseRecord.surgeonName)
  const date = normaliseDate(caseRecord.date)
  const hospital = normaliseHospital(caseRecord.hospital)
  const procedure = str(caseRecord.procedure)

  const items = (caseRecord.items || []).map((it, i) => {
    const key = it.distributorKey && it.distributorKey !== 'null' ? it.distributorKey : null
    return {
      ...it,
      id: it.id || `item-${i}`,
      distributorKey: key,
      distributor: key ? distributorName(key) : '',
      quantity: parseQuantity(it.quantity).quantity,
      excluded: it.excluded === true,
      manualReview: it.manualReview === true
    }
  })

  return {
    ...caseRecord,
    patientSurname,
    surgeonSurname,
    date,
    // Carried through rather than recomputed. Once the rep has edited the date
    // this is a record of where it started, and re-deriving it here would claim
    // the device set a value the rep typed.
    dateSource: caseRecord.date && caseRecord.date !== caseRecord.dateSuggested ? 'edited' : caseRecord.dateSource,
    dateOnForm: caseRecord.dateOnForm || '',
    hospital,
    procedure,
    items,
    folderName: buildFolderName({ patientSurname, date, surgeonSurname, procedure, hospital, items }),
    monthFolder: monthFolder(date)
  }
}
