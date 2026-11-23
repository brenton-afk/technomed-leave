import { findNavigation } from './systems.js'
import { STAFF } from '../staffConfig.js'

// ─── What a case is billed to Brainlab (Brent, 22 Nov 2026) ──────────────────
// "I want the portal to be tracking our case attendances from a Brainlab point
// of view … build a fool proof system where by when the bookings are entered
// into the portal with the relevant navigation, the portal can auto generate
// the Brainlab invoice."
//
// The rules, as Brent set them out:
// - RHH: an attended AIRO case is $300; an attended navigation case — Curve,
//   Varioguide, EM (ENT) — is $250. Non-F2F cases are tracked, not billed.
// - Calvary: the theatre techs run the navigation, so nothing is billed —
//   except the Varioguide stereotactic needle biopsies, which we attend for the
//   biopsy arm and bill at $250.
// - Anything else is only billed when the booking says so in its own line
//   ("Brainlab billing: AIRO" / "… Navigation" / "… Not billed"),
//   which always wins — e.g. Dubey asking for us at a Calvary posterior fossa.
//
// Checked against every Brainlab invoice in Xero from June 2024 to October
// 2026 and Toni's Brainlab booking document (see brainlabBilling.test.js).
// Pure: no dates, no network.

export const RATES = { airo: 300, nav: 250 }
export const KIND_LABEL = { airo: 'AIRO', nav: 'Navigation' }
// What the invoice line ends with, as every invoice since 2024 has written it.
export const INVOICE_TAG = { airo: 'AIRO', nav: 'CURVE' }

// At RHH the bill follows the kind of surgery, as Toni's key on the Brainlab
// booking document has it: "Cranial = Curve (unless Ibbett stereotactic VP
// shunt = AIRO), Spine = AIRO, Max Fax = AIRO, ENT = Curve" — and the booking
// rarely names the platform ("T12-L2 Fixation", "VP shunt insertion").
//
// Spine and max fax are AIRO: any instrumentation, fixation, fusion or
// decompression of the spine, and facial fracture work (the post-op spin).
const SPINE = /\b[ctls]\d{1,2}\b|\b(?:spin(?:e|al)|thoracic|lumbar|cervical|sacr\w*|scoliosis|kyphosis|occipit\w*[\s-]*cervical|costotransvers\w*|vertebr\w*|lamin\w*|facetectomy|pedicle|psf|[pt]lif|fixation|fusion|instrumentation|construct|hardware)\b/i
const MAX_FAX = /\bzmc\b|zygom|orbital|\borbit\b|le\s*fort|lefort|midface|mid\s*face|\boz\s+lift|\bmandib|naso[\s-]*(?:ethmoid|maxill)|nasomaxill|gillies|parotid|facial\s+fracture|max\s*fax|maxfax|\boms\b/i
const PELVIS_SCREWS = /\bsij\b|\bsi[\s-]?joint|sacro[\s-]?iliac|\bsi\s+screw|pelvi\w*|acetab\w*|\bfemur\b|femoral|\bfemur\b/i
// Cranial and ENT are navigation: the Curve, Varioguide, EM.
const CRANIAL = /crani\w*|\bshunt\b|\bavm\b|arteriovenous|\blesion\b|tumou?r|glioma|meningioma|metasta\w*|biops|stereotac|pituitar|prolactinoma|trans\s*sphenoid|transphenoid|sphenoid\w*|\bburr\s*hole|ventric\w*|\bdbs\b|cranial\s+registration|vario\s*guide|\bcurve\b|neuro\s*nav/i
const ENT = /\bent\b|\bfess\b|sinus\w*|sinonasal|skull\s*base|\bem\b|electromagnetic|\bkick\b/i
// Ibbett's stereotactic VP shunts are AIRO (Toni's key).
const BIOPSY = /biops/i
const REMOVAL = /\bremov(?:al|e)\b|\br\/o\b|\bromw\b/gi
const GOING_IN = /\b(?:fixation|fusion|psf|plif|tlif|insert\w*|instrumentation|extension|revision|re-?instrument\w*)\b/i
const ANTERIOR_ONLY = /\b(?:acdf|accf|alif|olif|xlif|llif|corpectom\w*|anterior|disc\s*replacement|arthroplasty|discectomy)\b/i
const SHUNT = /\bshunt\b/i
// Screws, a fixation or a fusion in the spine.
const SCREWS_IN = /pedicle|lat(?:eral|\.)?\s*mass|\bpsf\b|(?:^|[^a-z])[pt]lif|\bs2ai\b|(?:\b[ctls]\d{1,2}\b|spin\w*|thoracic|lumbar|cervical|posterio\w*)[^\n]{0,60}\b(?:fixation|fusion|screws?|instrumentation)\b|\b(?:fixation|fusion|screws?)\b[^\n]{0,30}\b[ctls]\d{1,2}\b/i

/** The booking's own Brainlab line: 'airo' | 'nav' | 'none' | null (not said). */
export function brainlabLabel(value) {
  const v = String(value || '').trim().toLowerCase()
  if (!v) return null
  if (/^(?:not\s+billed|no|none)\b/.test(v)) return 'none'
  if (/^airo\b/.test(v)) return 'airo'
  if (/^(?:navigation|nav|curve|varioguide|em)\b/.test(v)) return 'nav'
  return null
}

const site = h => {
  const s = String(h || '').toUpperCase()
  if (/RHH|ROYAL\s+HOBART/.test(s)) return 'RHH'
  if (/CLV|CALVARY|LENAH/.test(s)) return 'CLV'
  return ''
}

/**
 * What this case is billed to Brainlab if we attend it.
 * { kind: 'airo' | 'nav' | null, why, said } — `said` when the booking's own
 * Brainlab line decided it.
 */
export function brainlabService({ hospital, surgeon = '', procedure = '', kit = '', notes = '', brainlab = '' } = {}) {
  const said = brainlabLabel(brainlab)
  if (said) return { kind: said === 'none' ? null : said, why: 'Written on the booking', said: true }
  const where = site(hospital)
  const text = `${procedure}\n${kit}`
  const all = `${text}\n${notes}`
  if (where === 'CLV') {
    if (/vario\s*guide/i.test(all) || (BIOPSY.test(text) && /stereotac|needle|burr\s*hole|vario/i.test(all))) {
      return { kind: 'nav', why: 'Varioguide biopsy at Calvary' }
    }
    return { kind: null, why: 'Calvary — the theatre techs run the navigation' }
  }
  if (where !== 'RHH') return { kind: null, why: 'Not an RHH or Calvary case' }
  const nav = findNavigation(all)
  // A platform written on the booking decides first.
  if (/\bairo\b/i.test(all)) return { kind: 'airo', why: 'AIRO written on the booking' }
  if (/vario\s*guide|\bcurve\b/i.test(text) && !nav.includes('AIRO')) return { kind: 'nav', why: 'Curve / Varioguide on the booking' }
  // A removal alone puts nothing in to navigate (Aug and Sep 2026: two
  // removals attended, neither on the invoice).
  if (REMOVAL.test(text) && !GOING_IN.test(text.replace(REMOVAL, ' '))) return { kind: null, why: 'Removal only — not a Brainlab case' }
  // Screws in the spine or pelvis outrank every cranial word: "PSF for an L1
  // tumour", "stereotactic SI screw fixation" are AIRO cases.
  if (nav.includes('AIRO') || SCREWS_IN.test(text) || PELVIS_SCREWS.test(text)) return { kind: 'airo', why: 'Spine / screws (AIRO)' }
  // VP shunts: AIRO only when Ibbett is the surgeon, navigation otherwise
  // (Brent, 22 Nov 2026).
  if (SHUNT.test(text)) return /ibbett/i.test(surgeon)
    ? { kind: 'airo', why: 'Ibbett VP shunt (AIRO)' }
    : { kind: 'nav', why: 'VP shunt (navigation)' }
  if (MAX_FAX.test(text)) return { kind: 'airo', why: 'Max fax (AIRO spin)' }
  // ENT (the EM) at $300, as billed through 2025 (Brent, 22 Nov 2026: "if ENT
  // has historically been billed at $300 I'm happy with that").
  if (ENT.test(text)) return { kind: 'airo', why: 'ENT navigation — billed at $300' }
  if (CRANIAL.test(text)) return { kind: 'nav', why: 'Cranial navigation' }
  // An operation from the front alone — ACDF, ALIF, corpectomy — is not a
  // Brainlab case (October 2026: ten attended ACDFs and corpectomies, none on
  // the invoice). AIRO is for posterior screws unless the booking says AIRO.
  if (ANTERIOR_ONLY.test(text)) return { kind: null, why: 'Anterior operation — not a Brainlab case' }
  if (SPINE.test(text)) return { kind: 'airo', why: 'Spine (AIRO)' }
  if (nav.length) return { kind: 'nav', why: 'Navigation on the booking' }
  return { kind: null, why: 'No navigation on the booking' }
}

// ─── An operation that takes no implant system ───────────────────────────────
// "With stereotactic needle biopsies requiring Varioguide, I don't want the
// portal to ask if we need a system like Signus" (Brent, 22 Nov 2026). The
// booking forms fold the system buttons away behind "+ Add a system" for these.
const NO_IMPLANT = /biops|burr\s*hole|\bshunt\b|crani(?:otomy|ectomy)|\bavm\b|arteriovenous|glioma|meningioma|pituitar|prolactinoma|trans\s*sphenoid|transphenoid|sphenoid|\bfess\b|sinus|sinonasal|vario\s*guide|cranial\s+registration|\bdbs\b/i

/** Whether this operation is one that takes no implant system of ours. Pure. */
export function noImplantSystem(operation) {
  const t = String(operation || '')
  return NO_IMPLANT.test(t) && !SCREWS_IN.test(t) && !SPINE_IMPLANT.test(t)
}
const SPINE_IMPLANT = /\b(?:acdf|alif|cage|plate|rods?|screws?|fixation|fusion|disc\s+replacement)\b/i

// ─── The month's invoice ─────────────────────────────────────────────────────

// Who on the booking is one of us. A title's bracket also carries "(no
// attendance)" and "(TM not required)", which are not people (August 2026).
const OURS = new Set(STAFF.flatMap(s => [s.firstName, s.name, ...(s.aka || [])]).filter(Boolean).map(n => n.toLowerCase()))
export const whoAttended = reps => (reps || []).filter(r => OURS.has(String(r).trim().toLowerCase()))

const pad = n => String(n).padStart(2, '0')
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']

/** "NOVEMBER 2026 Clinical Support" — the reference every invoice since 2024 has used. */
export function invoiceReference(month) {
  const [y, m] = String(month).split('-').map(Number)
  return `${MONTHS[m - 1]} ${y} Clinical Support`
}

/** "23.11.26" — the surgery date as the invoices write it. */
export function invoiceDate(date) {
  const [y, m, d] = String(date).split('-').map(Number)
  return `${d}.${m}.${String(y).slice(2)}`
}

const HOSPITAL_WORDS = { RHH: 'RHH', CLV: 'Calvary Lenah Valley' }

/** One invoice line's description, in the invoices' own layout. */
export function invoiceLine(c, kind) {
  const op = String(c.procedure || '').replace(/\s*\((?:airo|curve)\)\s*/ig, ' ').trim()
  return [
    `Surgeon: ${c.surgeon || ''}`,
    `Patient: ${c.patient || ''}`,
    `Surgery Date: ${invoiceDate(c.date)}`,
    `Surgery: ${op} (${INVOICE_TAG[kind]})`,
    `Hospital: ${HOSPITAL_WORDS[site(c.hospital)] || c.hospital || ''}`
  ].join('\n')
}

/**
 * Sorts a month's bookings for the Brainlab invoice. Every booking with a
 * Brainlab service lands in exactly one list, so nothing is billed or missed
 * silently:
 * - bill: attended (a rep on the booking, or "we attended" decided), not No F2F;
 * - noF2F: tracked, not billed;
 * - ask: nobody marked as attended, or a case the rules are unsure of (VP
 *   shunts) — the invoice waits until each is answered;
 * - notBilled: decided against, or cancelled.
 * `decisions` is { [eventId]: { attended?: bool, kind?: 'airo'|'nav'|'none' } }.
 */
export function sortMonth(cases, decisions = {}) {
  const out = { bill: [], noF2F: [], ask: [], notBilled: [] }
  for (const c of cases) {
    const service = brainlabService(c)
    const d = decisions[c.id] || {}
    const kind = d.kind ? (d.kind === 'none' ? null : d.kind) : service.kind
    if (!service.kind && !d.kind) continue
    const row = { ...c, kind, why: d.kind ? 'Chosen at month end' : service.why, suggested: service.kind }
    if (c.cancelled) { out.notBilled.push({ ...row, reason: 'Cancelled' }); continue }
    if (!kind) { out.notBilled.push({ ...row, reason: d.kind ? 'Marked not billed' : service.why }); continue }
    if (c.notRequired) { out.noF2F.push(row); continue }
    const attended = d.attended ?? (whoAttended(c.reps).length ? true : undefined)
    if (attended === false) { out.notBilled.push({ ...row, reason: 'Not attended' }); continue }
    if (attended === undefined) { out.ask.push({ ...row, question: 'attended' }); continue }
    if (service.check && !d.kind) { out.ask.push({ ...row, question: 'kind' }); continue }
    out.bill.push({ ...row, amount: RATES[kind], line: invoiceLine(c, kind) })
  }
  const byDate = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.surgeon).localeCompare(String(b.surgeon))
  for (const k of Object.keys(out)) out[k].sort(byDate)
  const net = out.bill.reduce((n, r) => n + r.amount, 0)
  return { ...out, net, gst: Math.round(net * 10) / 100, total: Math.round(net * 110) / 100 }
}

export const monthBounds = month => {
  const [y, m] = String(month).split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` }
}

// ─── The Varioguide on the kit line, at both hospitals ───────────────────────
// "I want Kit to pre-populate for Calvary Varioguide/Needle Biopsies as
// Varioguide 2.0" (Brent, 22 Nov 2026); then (23 Nov 2026): "at RHH it is
// Varioguide 1.0 and at Calvary it is Varioguide 2.0. These systems must be
// recognised for both hospitals automatically." The biopsy arm is each
// hospital's own Brainlab set, so no supply is written — it is navigation,
// never asked where it comes from.
export const VARIOGUIDE_AT = { CLV: 'Varioguide 2.0', RHH: 'Varioguide 1.0' }
export const VARIOGUIDE = VARIOGUIDE_AT.CLV

/**
 * The Varioguide a booking needs — "Varioguide 2.0" at Calvary, "Varioguide
 * 1.0" at RHH — or '' when it is not a Varioguide case: the word Varioguide
 * anywhere on it, or a biopsy that says stereotactic, needle or burr hole.
 * Pure.
 */
export function varioguideFor({ hospital, procedure = '', kit = '', notes = '' } = {}) {
  const name = VARIOGUIDE_AT[site(hospital)]
  if (!name) return ''
  const text = `${procedure}\n${kit}`
  const yes = /vario\s*guide/i.test(`${text}\n${notes}`)
    || (BIOPSY.test(procedure) && /stereotac|needle|burr\s*hole/i.test(`${procedure}\n${notes}`))
  return yes ? name : ''
}

/** Whether this is a Calvary Varioguide / stereotactic needle biopsy. Pure. */
export function isCalvaryVarioguide(booking = {}) {
  return site(booking.hospital) === 'CLV' && Boolean(varioguideFor(booking))
}

/** The kit line with the hospital's Varioguide on it, for a biopsy that has none. */
export function kitWithVarioguide({ hospital, procedure = '', kit = '', notes = '' } = {}) {
  const line = String(kit || '').trim()
  const name = varioguideFor({ hospital, procedure, kit: line, notes })
  if (/vario\s*guide/i.test(line) || !name) return String(kit || '')
  return line ? `${line} / ${name}` : name
}
