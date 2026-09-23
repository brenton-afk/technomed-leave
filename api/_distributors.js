// ─── Distributor routing for surgeon usage ────────────────────────────────────
// Which distributor a line item belongs to, who gets emailed about it, and what
// never belongs on a usage sheet at all. This is the module to edit when a
// distributor changes contacts or TechnoMed picks up a new system.

import { STAFF } from '../src/staffConfig.js'

export const DISTRIBUTORS = {
  signus: {
    name: 'Signus',
    to: ['j.hanson@signus.com.au', 'a.polites@signus.com.au']
  },
  device: {
    name: 'Device Technologies',
    to: ['dl_spine_marketing@device.com.au', 'ortho@device.com.au']
  },
  device_boost: {
    name: 'Device Technologies Boost Allograft',
    to: ['boost@device.com.au', 'dl_spine_marketing@device.com.au', 'ortho@device.com.au']
  },
  e4: {
    name: 'E4 Surgical',
    to: ['admin@e4surgical.com', 'eland@e4surgical.com']
  },
  kt: {
    name: 'KT Medical',
    to: ['kt@ktmedical.com.au', 'ben@ktmedical.com.au']
  },
  globus: {
    name: 'Nuvasive/Globus',
    to: ['customeraccounts@globusmedical.com', 'jlagoon@globusmedical.com', 'cmkenzie@globusmedical.com']
  },
  dtbv: {
    name: 'Donor Tissue Bank of Victoria',
    to: ['dtbv.utilisation@vifm.org', 'kt@ktmedical.com.au', 'ben@ktmedical.com.au']
  }
}

// ─── Booking notifications ────────────────────────────────────────────────────
// Telling a distributor a case is booked is NOT asking them for a loan set, and
// the two must not be run together. Device said as much directly: a stream of
// booking notices would be read as a stream of loan requests and they could not
// keep up with either.
//
// So this is a separate list from the usage one above, with separate addresses —
// which is not tidiness. The addresses genuinely differ: Device's usage mail goes
// to dl_spine_marketing and ortho, while anything about a booking goes to the
// product managers. Wiring bookings to the usage list would have emailed the
// wrong people at every distributor.
//
// `notifyOnBooking: false` means exactly that — they are told nothing when a
// booking lands, and hear from us only about usage, or when a person decides a
// loan set is actually needed.
export const BOOKING_NOTIFY = {
  signus: {
    name: 'Signus',
    notifyOnBooking: true,
    to: ['j.hanson@signus.com.au', 'a.polites@signus.com.au']
  },
  e4: {
    name: 'E4 Surgical',
    notifyOnBooking: true,
    to: ['e4@e4surgical.com', 'bookings@e4surgical.com', 'eland@e4surgical.com']
  },
  atec: {
    name: 'ATEC Spine',
    notifyOnBooking: true,
    to: ['mcharlston@atecspine.com', 'Jpark@atecspine.com']
  },
  // Told about usage, never about a booking — by their own request.
  device: { name: 'Device Technologies', notifyOnBooking: false },
  // No booking notifications: tissue is ordered against a case, not stocked for
  // one, so a booking notice would be noise.
  dtbv: { name: 'Donor Tissue Bank of Victoria', notifyOnBooking: false },
  device_boost: { name: 'Device Technologies Boost Allograft', notifyOnBooking: false },
  globus: { name: 'Nuvasive/Globus', notifyOnBooking: false },
  kt: { name: 'KT Medical', notifyOnBooking: false }
}

// Not a distributor — a neurophysiology service booked alongside certain cases.
// Kept here because the booking flow has to reach them the same way.
export const NEUROPHYS = {
  name: 'Neurophys',
  to: ['info@neurophys.com.au']
}

/**
 * Which systems belong to which distributor.
 *
 * Replaces guessing from a product-name pattern, which was written for usage
 * line items — where the text is whatever is printed on an implant sticker — and
 * is too loose for routing a booking. "KT Lonestar" matched nothing at all, and
 * "Diplomat + E4" matched Signus and silently dropped the E4 request.
 *
 * Confirmed by Brent, 23 September. Deliberately not exhaustive: a system that
 * is not here produces "no distributor recognised", which is a question in the
 * review queue rather than a wrong email.
 */
export const SYSTEM_DISTRIBUTOR = [
  { key: 'signus', pattern: /\b(?:athlet|ascot|diplomat|mobis|cylox)\b/i },
  { key: 'device', pattern: /\b(?:mariner|shoreline)\b/i },
  // A bare "E4" counts: the RHH lists write "Diplomat + E4", meaning Diplomat
  // from Signus alongside E4 cages. Without it that booking routes to Signus
  // alone and the E4 half is silently lost.
  { key: 'e4', pattern: /\b(?:global\s*bmd\s*(?:plif|alif)|dakota(?:\s*acdf)?|reform(?:\s*cervical)?|e4)\b/i }
]

/**
 * Every distributor a booking's kit line names — not just the first.
 *
 * "Diplomat + E4" is two systems from two companies, and returning one of them
 * loses a request nobody knows is missing. Each gets its own notification naming
 * only its own kit.
 */
export function distributorsForKit(...fields) {
  const haystack = fields.filter(Boolean).join(' ')
  if (!haystack.trim()) return []
  return SYSTEM_DISTRIBUTOR.filter(rule => rule.pattern.test(haystack)).map(rule => rule.key)
}

/** TechnoMed's own stock — a real answer, not a failure to match. */
export function isOwnStock(...fields) {
  return /\btechno\s*med\b/i.test(fields.filter(Boolean).join(' '))
}

// Not a staff member — a shared mailbox, so it has no roster entry to carry.
const ADMIN_MAILBOX = 'admin@technomed.com.au'

// CC'd on every usage email. The sender is removed at send time so nobody is
// CC'd on their own message.
//
// Read off the roster rather than written out again here. It was a hardcoded list
// of five addresses, which is one of two places a clinical rep's email was
// written down — so correcting someone's address in staffConfig.js would have
// left them silently off every usage email, with nothing failing anywhere.
export const CLINICAL_TEAM_CC = [
  ...STAFF.filter(s => s.isClinicalTeam).map(s => s.email),
  ADMIN_MAILBOX
]

// Haemostatic agents and other peripherals are recorded by the hospital on the
// same form but are never TechnoMed implants — they must not reach a sheet.
const EXCLUDED_PRODUCT_PATTERNS = [
  /flo\s*seal/i,
  /surgicel/i,
  /spongistan/i,
  /gelfoam/i,
  /tisseel/i,
  /arista/i,
  /bone\s*wax/i,
  /haemostat|hemostat/i
]

// Ordered most-specific-first: BOOST must beat the generic Device match, and
// the allograft rules must beat a bare "global" hit.
const DISTRIBUTOR_RULES = [
  { key: 'device_boost', pattern: /\bboost\b/i },
  { key: 'dtbv', pattern: /\bcbm\b|donor\s*tissue|\bdtbv\b|allograft/i },
  { key: 'signus', pattern: /signus|diplomat|athlet|ascot|mobis/i },
  { key: 'device', pattern: /mariner|shoreline|device\s*tech/i },
  { key: 'e4', pattern: /dakota|reform|e4\s*global|\be4\b|\bbmd\b|global\s*biomedica/i },
  { key: 'kt', pattern: /kt\s*medical|\bktm\b/i },
  { key: 'globus', pattern: /nuvasive|globus/i }
]

export function isExcludedProduct(...fields) {
  const haystack = fields.filter(Boolean).join(' ')
  return EXCLUDED_PRODUCT_PATTERNS.some(p => p.test(haystack))
}

// Resolves a line item to a distributor key from its product text. Returns null
// when nothing matches, which sends the item to manual review rather than
// guessing a distributor and emailing the wrong company.
export function detectDistributor(...fields) {
  const haystack = fields.filter(Boolean).join(' ')
  if (!haystack.trim()) return null
  for (const rule of DISTRIBUTOR_RULES) {
    if (rule.pattern.test(haystack)) return rule.key
  }
  return null
}

export function distributorName(key) {
  return DISTRIBUTORS[key]?.name || 'Unidentified'
}

// CC list for one sender: the clinical team minus the sender themselves.
export function ccFor(senderEmail) {
  const sender = (senderEmail || '').toLowerCase().trim()
  return CLINICAL_TEAM_CC.filter(e => e.toLowerCase() !== sender)
}

// Groups items by distributor so one email goes to each company with only
// their own products. Items that are excluded, unresolved, or still awaiting
// manual review are held back — they must never be emailed out.
export function groupByDistributor(items) {
  const groups = new Map()
  for (const item of items) {
    if (item.excluded) continue
    if (item.manualReview) continue
    if (!item.distributorKey || !DISTRIBUTORS[item.distributorKey]) continue
    if (!groups.has(item.distributorKey)) groups.set(item.distributorKey, [])
    groups.get(item.distributorKey).push(item)
  }
  return groups
}
