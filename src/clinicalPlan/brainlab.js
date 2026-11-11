import { isNavigationOnly } from './systems.js'
import { parseKitSupplies, formatKitSupplies } from './kitSupply.js'

// ─── Brainlab navigation, as a button rather than as kit text ────────────────
// The choice the booking forms offer, and the kit wording each one writes —
// which is what every badge and colour downstream reads. Shared by New booking
// and the bookings inbox so the two write the same thing.
//
// "AIRO doesn't need to transcribe into the booking from the email, just needs
// to automatically tap the AIRO button in the booking. The transcription of
// AIRO is not necessary in the kit list." — Brent, 2 Nov 2026. An email's
// "AIRO" or "Spinal Brainlab" becomes the button, pre-selected, and comes off
// the kit line the person reads and edits.

// AIRO always comes with the Curve cart; the Curve can be used on its own.
export const BRAINLAB = ['AIRO + Curve', 'Curve only', 'Other']
export const BRAINLAB_KIT = { 'AIRO + Curve': 'BRAINLAB AIRO & CURVE', 'Curve only': 'BRAINLAB CURVE', Other: 'BRAINLAB' }

/**
 * Which button the email's own words amount to, or ''.
 *
 * Only what is written. findNavigation also infers AIRO from the system — a
 * Mariner case is an AIRO case for the badge — and pressing the button on that
 * basis would put navigation on a booking whose email never asked for it.
 */
export function navigationChoice(text) {
  const t = String(text || '')
  if (/\bairo\b/i.test(t)) return 'AIRO + Curve'
  if (/\bcurve\b/i.test(t)) return 'Curve only'
  if (/\b(?:brain\s*lab|blabs|vario\s*guide|navigation)\b/i.test(t)) return 'Other'
  return ''
}

/**
 * The kit line without its navigation-only entries. "Mariner MIS / AIRO" →
 * "Mariner MIS". An entry that also names a system stays whole: that is a kit
 * somebody has to produce (see isNavigationOnly).
 */
export function kitWithoutNavigation(kit) {
  const entries = parseKitSupplies(kit)
  if (!entries.length) return String(kit || '')
  const kept = entries.filter(e => !isNavigationOnly(e.system))
  return kept.length === entries.length ? String(kit || '') : formatKitSupplies(kept)
}

/** The kit line to write: the systems, then the navigation button's wording. */
export function kitWithNavigation(kit, choice) {
  return [String(kit || '').trim(), choice ? BRAINLAB_KIT[choice] : ''].filter(Boolean).join(' + ')
}

// ─── AIRO on every RHH pedicle-screw and lateral-mass case (Brent, 11 Nov 2026)
// "All Pedicle screw and lateral mass cases at RHH should have auto AIRO
// booked and not rely on someone tapping it." Every such case in July to
// October was billed to Brainlab as AIRO; October's invoice could not be
// checked from the bookings because five of them had nothing on them saying so.
//
// Posterior screw words decide: pedicle, lateral mass, PSF, PLIF, TLIF, S2AI,
// "posterior … fixation/fusion/screws", or a level range with fixation/screws
// when nothing says the operation is anterior. Not an SIJ screw, a posterior
// fossa craniotomy, an ACDF or a corpectomy, and not a screw removal alone.
// A booking that says "No AIRO" / "Brainlab not required" is left as written.

import { isRhh } from './etbs.js'

const POSTERIOR_SCREWS = /pedicle|lat(?:eral|\.)?\s*mass|\bpsf\b|\bplif\b|\btlif\b|\bs2ai\b|posterior\s+(?:\w+\s+){0,3}(?:fixation|fusion|screws?|instrumentation|stabili[sz]ation)/i
const ANTERIOR = /\b(?:acdf|alif|accf|olif|xlif|llif|anterior|corpectomy|discectomy|disc\s*replacement|arthroplasty)\b/i
const RANGE_FIXATION = /\b[CTLS]\d{1,2}\s*[-–/]\s*[CTLS]?\d{1,2}\b[^.\n]{0,40}\b(?:fixation|screws?|instrumentation)\b|\b(?:fixation|screws?)\b[^.\n]{0,20}\b[CTLS]\d{1,2}\s*[-–/]\s*[CTLS]?\d{1,2}\b/i
const REMOVAL = /\bremov(?:al|e)\b|\br\/o\b/i
const PUTTING_IN = /\b(?:fixation|fusion|psf|plif|tlif|insert|instrumentation|extension)\b/i
const OPTED_OUT = /\bno\s+(?:airo|brain\s*lab|navigation)\b|\b(?:airo|brain\s*lab|navigation)\s+(?:is\s+)?not\s+(?:required|needed|req'?d)\b/i
const HAS_NAVIGATION = /\b(?:airo|curve|brain\s*lab|blabs?|vario\s*guide)\b/i

/** Whether the operation puts screws into pedicles or lateral masses. Pure. */
export function isPedicleOrLateralMass(procedure) {
  const text = String(procedure || '')
  if (!text.trim()) return false
  if (REMOVAL.test(text) && !PUTTING_IN.test(text.replace(REMOVAL, ''))) return false
  if (POSTERIOR_SCREWS.test(text)) return true
  if (ANTERIOR.test(text)) return false
  return RANGE_FIXATION.test(text)
}

/** Whether this booking should carry AIRO without anyone tapping it. */
export function needsAutoAiro({ hospital, procedure, kit, notes } = {}) {
  if (!isRhh(hospital)) return false
  if (OPTED_OUT.test(`${procedure || ''}\n${kit || ''}\n${notes || ''}`)) return false
  return isPedicleOrLateralMass(procedure)
}

/**
 * The kit line with AIRO added where the rule says so and nothing names
 * navigation yet. Anything already there — "BRAINLAB CURVE", a No F2F
 * Brainlab — is left exactly as it is.
 */
export function kitWithAutoAiro({ hospital, procedure, kit, notes } = {}) {
  const line = String(kit || '')
  if (HAS_NAVIGATION.test(line) || !needsAutoAiro({ hospital, procedure, kit, notes })) return line
  return kitWithNavigation(line, 'AIRO + Curve')
}
