// ─── Usage case normalisation ─────────────────────────────────────────────────
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

// {Patient Surname}_{DDMMYYYY}_{Surgeon Surname}_{Procedure}_{Hospital}
export function buildFolderName({ patientSurname, date, surgeonSurname, procedure, hospital }) {
  return [
    safeSegment(patientSurname) || 'UnknownPatient',
    ddmmyyyy(date) || 'UnknownDate',
    safeSegment(surgeonSurname) || 'UnknownSurgeon',
    safeSegment(procedure) || 'Procedure',
    safeSegment(hospital) || 'Hospital'
  ].join('_')
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
function normaliseItem(raw, index) {
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

// Builds the full case from the extraction payload plus the signed-in rep.
export function normaliseCase(extracted, { repName, repEmail }) {
  const patientSurname = surnameOf(extracted.patientSurname) ||
    str(extracted.patientSurname)
  const surgeonSurname = surnameOf(extracted.surgeonName)
  const date = normaliseDate(extracted.date)
  const hospital = normaliseHospital(extracted.hospital)
  const procedure = str(extracted.procedure || extracted.procedureDescription)

  const items = (Array.isArray(extracted.items) ? extracted.items : [])
    .map(normaliseItem)
    .filter(it => it.productName || it.referenceCode || it.lotNumber)

  const caseDetails = {
    patientSurname,
    patientFirstName: str(extracted.patientFirstName),
    patientUrNumber: str(extracted.patientUrNumber || extracted.urNumber),
    surgeonName: str(extracted.surgeonName),
    surgeonSurname,
    date,
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
    folderName: buildFolderName({ patientSurname, date, surgeonSurname, procedure, hospital }),
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
    hospital,
    procedure,
    items,
    folderName: buildFolderName({ patientSurname, date, surgeonSurname, procedure, hospital }),
    monthFolder: monthFolder(date)
  }
}
