// ─── The pre-operative workup, which is not our business ─────────────────────
// Hospital booking forms carry a block about getting the patient ready for
// theatre: bloods, an ECG, fasting, consent, the anaesthetic review. All of it
// matters enormously and none of it to us. Technomed brings implants and stands
// in the room; nothing in that block changes which tray is needed, when anybody
// arrives, or what is already in the patient.
//
// Left in, it is most of the booking. The two lines somebody actually needed —
// which cage, whether there is a construct already in there — end up below six
// lines about a full blood count, and a card nobody reads is worse than a card
// with less on it.
//
// Filtered where the booking is read rather than where it is written, so it
// cleans up the bookings already on the calendar as well as the next one. The
// text stays in Google exactly as the hospital sent it; the app simply does not
// repeat it.

const WORKUP = [
  // Bloods, by every name a form uses
  'bloods?', 'blood\\s*tests?', 'blood\\s*work', 'pathology', 'fbc', 'fbe',
  'u\\s*&?\\s*e', 'euc', 'lfts?', 'coags?', 'inr', 'aptt',
  'group\\s*(?:and|&)\\s*(?:hold|save)', 'cross\\s*match', 'g\\s*&\\s*h',
  // Cardiac and respiratory workup
  'ecg', 'ekg', 'echo(?:cardiogram)?', 'chest\\s*x-?ray', 'cxr', 'spirometry',
  // Getting them to theatre
  'fasting', 'nil\\s*by\\s*mouth', '\\bnbm\\b', 'bowel\\s*prep',
  'consent(?:ed|ing)?\\s*(?:form)?', 'pre-?\\s*admission', 'pre-?\\s*op\\s*clinic',
  'anaesthetic\\s*(?:review|assessment|clinic)', 'anaesthetist\\s*review',
  // Screening
  'covid\\s*(?:swab|test|screen)', 'mrsa\\s*screen', 'swabs?\\s*taken'
]

const IS_WORKUP = new RegExp(`\\b(?:${WORKUP.join('|')})\\b`, 'i')

/**
 * Things that look like workup but are ours.
 *
 * "Bloods" beside a cell saver, or an ECG lead that fouls the AIRO gantry, are
 * about the day in the room rather than the clinic before it. Rare, and the
 * cost of dropping one is a line the team needed, so they are kept.
 */
const STILL_OURS =
  /\b(?:kit|set|tray|loan|consignment|implant|cage|screw|airo|navigation|nav|curve|brainlab|rep|neurophys|cell\s*saver|order|deliver|resupply)\b/i

/**
 * Whether a line of a booking's notes is pre-operative workup and nothing else.
 *
 * Deliberately conservative. A line that mentions the workup *and* something of
 * ours is kept whole — half a note is worse than a note nobody needed, and the
 * team writes both in one sentence often enough to matter.
 */
export function isPreOpNoise(line) {
  const text = String(line || '').trim()
  if (!text) return false
  if (!IS_WORKUP.test(text)) return false
  if (STILL_OURS.test(text)) return false
  return true
}

/** The notes worth showing. */
export function withoutPreOpNoise(notes) {
  return (notes || []).filter(note => !isPreOpNoise(note))
}
