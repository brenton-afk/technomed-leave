import { detectDistributor, distributorName, DISTRIBUTORS } from './_distributors.js'
import { parseFolderName } from './_usageCase.js'

// ─── Resupply (Brent, 6 Nov 2026: "go ahead with the scanner for resupply") ──
// After a usage goes to a distributor, the stock comes back: a delivery
// docket or packing slip with the box, or — E4's habit — a photo of the
// resupply in reply to the usage email. Today each one is filed by hand in
// the usage case's own Dropbox folder as "{Surname} {Distributor} resupply.pdf"
// ("partial … resupply 2" when it comes in parts), and whether everything used
// has come back is in somebody's head.
//
// This reads the document, finds the usage case it replaces, says product by
// product what was used, what has come back and what is still owed, and files
// it the way the team already does. Resupplied stock carries new lot numbers,
// so the match is by product code, never by lot. The new lot is kept — it is
// what the shelf now holds.
//
// Patient data: only a surname, as on the usage side. Nothing read is logged.

export const RESUPPLY_PROMPT = `You are reading a resupply document sent to TechnoMed, a surgical implant distributor in Tasmania, by one of its suppliers after implants were used in a case. It may be a delivery docket, packing slip, consignment replenishment note, sales order, or simply a photo of the resupplied items showing their labels.

Extract:
- the supplier (company) as printed;
- the document number (docket, delivery, sales order, consignment or invoice number) and the document date;
- the case it replaces, from any reference on it: the patient's SURNAME only, the surgeon, the hospital (CLV for Calvary, RHH for Royal Hobart), the surgery date, any reference in the form "Surname_DDMMYYYY_Surgeon_Procedure_Hospital", and any PO or customer reference;
- every line supplied: catalogue / reference code, description, lot or serial number, quantity supplied, and any quantity marked back-ordered or to follow.

Do NOT extract the patient's first name, UR number, date of birth or any other identifier — the surname is the only patient identifier this system holds. Never invent a value: return an empty string for anything not legible. If you are unsure of a line, set "confidence" to "low".

Return ONLY a JSON object (no markdown fences, no commentary) of exactly this shape:
{
  "supplier": "",
  "documentNumber": "",
  "documentDate": "YYYY-MM-DD, or the raw text if you cannot resolve it",
  "patientSurname": "",
  "surgeon": "",
  "hospital": "CLV or RHH or empty string",
  "surgeryDate": "YYYY-MM-DD or raw text or empty",
  "caseReference": "",
  "poReference": "",
  "lines": [
    { "referenceCode": "", "description": "", "lotNumber": "", "quantity": "1", "backordered": "0", "confidence": "high | medium | low" }
  ]
}`

const str = v => (v == null ? '' : String(v)).trim()

/** A product code reduced to what identifies it: letters and digits, upper case. */
export function codeKey(code) {
  return str(code).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function count(value, fallback) {
  const m = /\d+/.exec(str(value))
  if (!m) return fallback
  const n = Number(m[0])
  return Number.isFinite(n) && n >= 0 && n < 1000 ? n : fallback
}

/** A date as YYYY-MM-DD, from that or from Australian day-first text. */
export function isoDate(value) {
  const s = str(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s)
  if (!m) return ''
  const year = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

/** What the model read, typed and tidied. Never invents a field. */
export function normaliseResupply(raw = {}) {
  const lines = (Array.isArray(raw.lines) ? raw.lines : [])
    .map((l, i) => ({
      id: `line-${i}`,
      referenceCode: str(l.referenceCode || l.code || l.ref),
      description: str(l.description || l.productName),
      lotNumber: str(l.lotNumber || l.lot || l.serial),
      quantity: count(l.quantity, 1),
      backordered: count(l.backordered, 0),
      unsure: str(l.confidence).toLowerCase() === 'low'
    }))
    .filter(l => l.referenceCode || l.description)
  const text = [raw.supplier, ...lines.map(l => `${l.description} ${l.referenceCode}`)].join(' ')
  const distributorKey = detectDistributor(raw.supplier) || detectDistributor(text)
  const reference = str(raw.caseReference)
  const folder = reference ? parseFolderName(reference) : null
  return {
    distributorKey: distributorKey || null,
    distributor: distributorKey ? distributorName(distributorKey) : str(raw.supplier),
    supplier: str(raw.supplier),
    documentNumber: str(raw.documentNumber),
    documentDate: isoDate(raw.documentDate),
    patientSurname: str(raw.patientSurname) || (folder?.recognised ? folder.patientSurname : ''),
    surgeon: str(raw.surgeon) || (folder?.recognised ? folder.surgeonSurname : ''),
    hospital: /^(CLV|RHH)$/i.test(str(raw.hospital)) ? str(raw.hospital).toUpperCase() : (folder?.hospital || ''),
    surgeryDate: isoDate(raw.surgeryDate) || (folder?.recognised ? folder.date : ''),
    caseReference: reference,
    poReference: str(raw.poReference),
    lines
  }
}

const DAY = 86400000
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)
const same = (a, b) => str(a).toLowerCase() === str(b).toLowerCase() && str(a) !== ''

/** The usage items a distributor supplied on a case. */
export function itemsFor(record, distributorKey) {
  return (record?.items || []).filter(i => !i.excluded
    && (!distributorKey || i.distributorKey === distributorKey
      // Boost comes back from Device's Boost desk; either key is the same company.
      || (distributorKey === 'device' && i.distributorKey === 'device_boost')
      || (distributorKey === 'device_boost' && i.distributorKey === 'device')))
}

/**
 * Which saved usage cases this document could be resupplying, best first.
 *
 * The folder name in a reference is the strongest sign (it is how the usage
 * email was titled, and distributors reply to it), then the surname, then the
 * surgery date, then product codes in common. A case with none of the
 * distributor's items is never offered.
 */
export function candidateCases(resupply, records, { limit = 5 } = {}) {
  const lines = resupply.lines || []
  // Device's Boost dockets name no patient (Erin, 10 Nov 2026: the case was
  // never offered). With no name on the paper, the distributor's cases from
  // the weeks before the docket are offered by date, nearest first.
  const unnamed = !resupply.caseReference && !resupply.patientSurname
  const scored = records.map(record => {
    const items = itemsFor(record, resupply.distributorKey)
    if (!items.length) return null
    let score = 0
    const why = []
    if (resupply.caseReference && same(record.folderName, resupply.caseReference.replace(/\.\w+$/, ''))) {
      score += 10; why.push('reference')
    }
    if (same(record.patientSurname, resupply.patientSurname)) { score += 6; why.push('surname') }
    if (resupply.surgeryDate && record.date === resupply.surgeryDate) { score += 3; why.push('date') }
    if (resupply.surgeon && same(record.surgeonSurname, resupply.surgeon)) { score += 1; why.push('surgeon') }
    if (resupply.hospital && record.hospital === resupply.hospital) score += 1
    const shared = pairLines(items, lines).size
    if (shared) { score += Math.min(4, shared); why.push(`${shared} code${shared === 1 ? '' : 's'}`) }
    // A resupply comes after the case, usually within a few weeks.
    let near = false
    if (resupply.documentDate && record.date) {
      const gap = daysBetween(record.date, resupply.documentDate)
      if (gap < -2) score -= 5
      else if (gap <= 21) { score += 2; near = true }
      else if (gap > 45) score -= 3
    }
    if (near && unnamed && !why.includes('date')) why.push('recent case')
    const named = why.includes('reference') || why.includes('surname')
    if (!named && !shared && !(unnamed && near)) return null
    return { record, score, why }
  }).filter(Boolean)
  return scored.sort((a, b) => b.score - a.score || String(b.record.date).localeCompare(String(a.record.date))).slice(0, limit)
}

/** Usage cases whose surname, surgeon or folder name contains what was typed. */
export function findCases(query, records, { limit = 8 } = {}) {
  const q = str(query).toLowerCase()
  if (q.length < 2) return []
  return records
    .filter(r => [r.patientSurname, r.surgeonSurname, r.folderName].some(v => str(v).toLowerCase().includes(q)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, limit)
}

// ─── Codes that are the same product written differently (10 Nov 2026) ─────
// Mat's Shoreline resupply read "2 still owed" when everything had come back:
// the usage held "85-6509" and "SEA-85-09" (as read off the stickers) and the
// docket printed the full catalogue codes. An exact match missed both. A code
// read short, or with or without the maker's prefix, is still the same product.

const digitsOf = k => k.replace(/[^0-9]/g, '')

/** How closely two product codes agree: 0 (not the same) up to 3 (identical). */
export function codeMatch(a, b) {
  const x = codeKey(a), y = codeKey(b)
  if (!x || !y) return 0
  if (x === y) return 3
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  if (short.length >= 5 && (long.startsWith(short) || long.endsWith(short))) return 2
  const dx = digitsOf(x), dy = digitsOf(y)
  if (dx.length >= 5 && dx === dy) return 2
  if (short.length >= 6 && long.includes(short)) return 1
  const [ds, dl] = dx.length <= dy.length ? [dx, dy] : [dy, dx]
  if (ds.length >= 5 && dl.startsWith(ds)) return 1
  return 0
}

const WORD = /[a-z0-9.]+/g
const STOP = new Set(['the', 'and', 'with', 'for', 'x', 'mm', 'of', 'set', 'kit'])
const wordsOf = t => new Set((str(t).toLowerCase().match(WORD) || []).filter(w => w.length > 1 && !STOP.has(w)))

/** Same product by description, for a line or item with no usable code. */
function describedAlike(a, b) {
  const x = wordsOf(a), y = wordsOf(b)
  if (!x.size || !y.size) return false
  let shared = 0
  for (const w of x) if (y.has(w)) shared++
  return shared >= 2 && shared / Math.min(x.size, y.size) >= 0.6
}

/**
 * Pairs each document line with the used item it resupplies, best match first:
 * identical codes, then a code read short or with a prefix, then (only where a
 * code is missing) the description. Each line goes to one item.
 */
export function pairLines(items, lines) {
  const pairs = new Map()           // line index -> item index
  const scored = []
  lines.forEach((l, li) => items.forEach((it, ii) => {
    let score = codeMatch(it.referenceCode, l.referenceCode) * 10
    if (!score && (!codeKey(it.referenceCode) || !codeKey(l.referenceCode))
      && describedAlike(it.productName || it.description, l.description)) score = 5
    if (score) scored.push({ li, ii, score })
  }))
  scored.sort((a, b) => b.score - a.score)
  for (const { li, ii } of scored) if (!pairs.has(li)) pairs.set(li, ii)
  return pairs
}

/**
 * Product by product: used on the case, already resupplied, on this document,
 * and still owed. Lines on the document that the case did not use are listed
 * apart — a consignment top-up or a substitute, for a person to look at.
 */
export function compareResupply(record, distributorKey, lines, earlier = []) {
  const items = itemsFor(record, distributorKey)

  // One row a product: the same code used twice is one row with both counted.
  const rows = []
  const rowOf = []
  items.forEach((item, i) => {
    const k = codeKey(item.referenceCode)
    const existing = k && rows.find(r => r.codeKey === k)
    if (existing) { existing.used += Number(item.quantity) || 1; rowOf[i] = existing; return }
    const row = {
      key: k || `item:${item.id || i}`,
      codeKey: k,
      referenceCode: item.referenceCode,
      product: item.productName || item.description || item.referenceCode,
      used: Number(item.quantity) || 1,
      before: 0,
      now: 0
    }
    rows.push(row); rowOf[i] = row
  })

  const tally = (docLines, field) => {
    const pairs = pairLines(items, docLines)
    const unmatched = []
    docLines.forEach((l, li) => {
      const ii = pairs.get(li)
      if (ii === undefined) { unmatched.push(l); return }
      rowOf[ii][field] += Number(l.quantity) || 0
    })
    return unmatched
  }
  tally(earlier.flatMap(e => e.lines || []), 'before')
  const extras = tally(lines, 'now')

  for (const r of rows) { r.owing = Math.max(0, r.used - r.before - r.now); delete r.codeKey }
  const sum = f => rows.reduce((n, r) => n + r[f], 0)
  return {
    rows,
    extras,
    totals: { used: sum('used'), before: sum('before'), now: sum('now'), owing: sum('owing') }
  }
}

const SHORT_NAMES = {
  signus: 'Signus', device: 'Device', device_boost: 'Boost', e4: 'E4',
  kt: 'KT', globus: 'Globus', dtbv: 'DTBV'
}

/**
 * The filed name, the way the team already names them:
 * "Curtain E4 resupply.pdf", "Housego partial Device resupply 2.pdf".
 */
export function resupplyFileName({ patientSurname, distributorKey, partial, n }) {
  const who = str(patientSurname).replace(/[\\/:*?"<>|]/g, '') || 'Case'
  const company = SHORT_NAMES[distributorKey] || DISTRIBUTORS[distributorKey]?.name || 'Supplier'
  const number = n > 1 || partial ? ` ${n}` : ''
  return `${who} ${partial ? 'partial ' : ''}${company} resupply${number}.pdf`
}
