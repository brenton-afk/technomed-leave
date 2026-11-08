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
export const BRAINLAB_KIT = { 'AIRO + Curve': 'BRAINLAB AIRO & CURVE', 'Curve only': 'BRAINLAB CURVE', ETBS: 'BRAINLAB ETBS', Other: 'BRAINLAB' }

// ETBS is offered at RHH only (Brent, 8 Nov 2026). It sits before Other.
const RHH_ONLY = ['ETBS']
const isRhh = hospital => /\b(?:rhh|royal\s+hobart)\b/i.test(String(hospital || ''))

/** The navigation buttons for a hospital: ETBS joins them at RHH. */
export function brainlabOptions(hospital) {
  return isRhh(hospital) ? ['AIRO + Curve', 'Curve only', 'ETBS', 'Other'] : BRAINLAB
}

/** A choice still on offer at this hospital, else '' (ETBS left behind on a move to Calvary). */
export function brainlabFor(choice, hospital) {
  return choice && (!RHH_ONLY.includes(choice) || isRhh(hospital)) ? choice : ''
}

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
