// ─── The patient label, covered by the portal (Brent, 26 Nov 2026) ───────────
// "No the label should not be visible anywhere. The first name, surname of the
// patient and the surgeon name need to be kept for all forms. Ok if the UR
// number is also kept. For DTBV allograft forms we need this information PLUS
// the DOB and the sex of the patient. Patient data should be treated with
// absolute confidentiality and destroyed permanently after scanning and
// redaction."
//
// Staff used to put the TechnoMed card over the hospital's patient label
// before photographing a form. Now the reader says where every patient
// identifier is on each page (`labels`), the phone paints a solid block over
// each one — into the pixels, not a layer on top — and prints in the biggest
// block only what is kept: the patient's first name and surname, the UR
// number and the surgeon; on a DTBV allograft form, the date of birth and sex
// as well. Only the covered page is ever filed in Dropbox or sent. The
// photograph with the label showing stays in the phone's memory while the
// person checks the covering, and is dropped once the scan is filed or
// abandoned. First name, UR, date of birth and sex are never stored by the
// portal: they exist only as print on the covered page.
//
// Pure: shared by api/usage/agent.js (reading) and the phone (painting).

/** What the reader is asked for, appended to the usage and resupply prompts. */
export const REDACTION_PROMPT = `

PATIENT LABEL — the page will be filed and sent with every patient identifier covered, so say where they are.
Return "labels": every area on the page showing patient identification — the hospital's printed patient ID label or sticker (name, UR / MRN, date of birth, sex, address, Medicare number, barcode), any addressograph imprint, and any handwritten patient name, UR, date of birth or address — as {"page": n, "x": left, "y": top, "w": width, "h": height}. "page" is 1 for the first image you were given; x, y, w and h are fractions from 0 to 1 of that image's width and height. Enclose each whole area with a little room to spare. Do NOT include implant stickers, the hospital's logo or printed headings, or the surgeon's or rep's names. Return [] when there are none.
Return "patientLabel": {"firstName": "", "surname": "", "ur": "", "dob": "YYYY-MM-DD", "sex": "M, F or as printed"} read from the patient ID label. These are printed back onto the covered page and nowhere else — this is the only place the first name, UR, date of birth or sex may be returned. Empty strings for anything not legible.
Return "dtbvPages": the page numbers that are the DTBV (Donor Tissue Bank of Victoria) allograft / tissue recipient form, or [].`

/** The JSON fields the prompt adds, for the shape the prompts spell out. */
export const REDACTION_FIELDS = `,
  "labels": [{ "page": 1, "x": 0, "y": 0, "w": 0, "h": 0 }],
  "patientLabel": { "firstName": "", "surname": "", "ur": "", "dob": "", "sex": "" },
  "dtbvPages": []`

const PAD_X = 0.02
const PAD_Y = 0.015
const MIN_W = 0.06
const MIN_H = 0.03
const MAX_BOXES = 10

const num = v => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const clamp01 = n => Math.min(1, Math.max(0, n))
const str = v => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim()

/**
 * One box as the reader gave it → a padded box inside the page, or null.
 * Percentages (a reader answering 0–100) are taken as such.
 */
export function cleanBox(raw, { pad = true } = {}) {
  if (!raw || typeof raw !== 'object') return null
  let [x, y, w, h] = [num(raw.x), num(raw.y), num(raw.w ?? raw.width), num(raw.h ?? raw.height)]
  if ([x, y, w, h].some(v => v == null) || w <= 0 || h <= 0) return null
  if (Math.max(x, y, w, h) > 1.5) {
    if (Math.max(x + w, y + h) > 101) return null
    x /= 100; y /= 100; w /= 100; h /= 100
  }
  if (pad) {
    x -= PAD_X; y -= PAD_Y; w += 2 * PAD_X; h += 2 * PAD_Y
  }
  if (w < MIN_W) { x -= (MIN_W - w) / 2; w = MIN_W }
  if (h < MIN_H) { y -= (MIN_H - h) / 2; h = MIN_H }
  const x0 = clamp01(x), y0 = clamp01(y)
  const x1 = clamp01(x + w), y1 = clamp01(y + h)
  if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return null
  const r = v => Math.round(v * 10000) / 10000
  return { x: r(x0), y: r(y0), w: r(x1 - x0), h: r(y1 - y0) }
}

/** Page numbers (1-based) → valid 0-based indices. */
function pageIndices(value, pageCount) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= pageCount).map(n => n - 1))]
}

const LABEL_FIELDS = ['firstName', 'surname', 'ur', 'dob', 'sex']

/** The kept details, first legible value of each across the readings. */
export function mergeLabel(labels) {
  const out = {}
  for (const f of LABEL_FIELDS) out[f] = str(labels.map(l => l?.[f]).find(v => str(v)) || '').slice(0, 60)
  return out
}

/**
 * The covering for a scan, from its readings.
 *   readings   one per page when each page was read alone (`perPage`), or one
 *              reading of every page at once
 * → { pages: [{ boxes, dtbv }], label: { firstName, surname, ur, dob, sex } }
 */
export function redactionFrom(readings, pageCount, { perPage = true } = {}) {
  const pages = Array.from({ length: pageCount }, () => ({ boxes: [], dtbv: false }))
  const list = Array.isArray(readings) ? readings : [readings]
  list.forEach((reading, i) => {
    for (const raw of Array.isArray(reading?.labels) ? reading.labels : []) {
      // A page read alone is that page, whatever number the reader put on it.
      const index = perPage ? i : (num(raw?.page) ?? 1) - 1
      const box = cleanBox(raw)
      if (box && pages[index] && pages[index].boxes.length < MAX_BOXES) pages[index].boxes.push(box)
    }
    const dtbv = perPage
      ? (Array.isArray(reading?.dtbvPages) && reading.dtbvPages.length > 0 ? [i] : [])
      : pageIndices(reading?.dtbvPages, pageCount)
    for (const p of dtbv) if (pages[p]) pages[p].dtbv = true
  })
  return { pages, label: mergeLabel(list.map(r => r?.patientLabel)) }
}

/** "1956-04-03" → "03/04/1956"; anything else as it was read. */
export function dobWords(dob) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(dob))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : str(dob)
}

/**
 * What is printed in place of the label. Every form: the patient's first name
 * and surname, the UR where there is one, the surgeon. A DTBV allograft form:
 * the date of birth and sex as well.
 */
export function stampLines(label = {}, surgeon = '', { dtbv = false } = {}) {
  const name = [str(label.firstName), str(label.surname).toUpperCase()].filter(Boolean).join(' ')
  const lines = []
  lines.push(`Patient: ${name || '—'}`)
  if (str(label.ur)) lines.push(`UR: ${str(label.ur)}`)
  if (dtbv) {
    lines.push(`DOB: ${dobWords(label.dob) || '—'}  ·  Sex: ${str(label.sex) || '—'}`)
  }
  lines.push(`Surgeon: ${str(surgeon) || '—'}`)
  return lines
}

/** The box the kept details are printed in: the biggest one on the page. */
export function stampBoxIndex(boxes = []) {
  let best = -1, area = -1
  boxes.forEach((b, i) => { const a = b.w * b.h; if (a > area) { area = a; best = i } })
  return best
}

/** Pages whose covering a person must look at: nothing was found on them. */
export function pagesToCheck(redaction) {
  return (redaction?.pages || []).map((p, i) => (p.boxes.length ? -1 : i)).filter(i => i >= 0)
}

/** The version of covering the server insists on before filing or sending. */
export const REDACTION_VERSION = 'v1'
