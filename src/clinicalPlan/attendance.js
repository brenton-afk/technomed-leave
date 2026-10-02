// ─── Cases we are told about but not wanted at ───────────────────────────────
// A hospital will book a case onto our calendar as a courtesy — the surgeon is
// one of ours, the navigation is one we support — and say on the booking that
// we are not needed in the room:
//
//   Brainlab F2F Not required
//
// It is genuinely useful to have those in the portal. Knowing a case is on
// changes how the day reads even when nobody from here is going: it is why a
// theatre is busy, why a surgeon is unavailable, and it is the booking somebody
// rings about later.
//
// What it must not do is look like a case we are attending. Before this, one of
// those read as an ordinary booking with a BRAINLAB badge on it — which on
// every other card means we are there with navigation — and the only thing
// saying otherwise was a line of grey text under the kit. That is the wrong way
// round: "nobody needs to go" is the most important fact on the card and it was
// the quietest thing on it.

/**
 * Ways the team and the hospitals write it.
 *
 * Deliberately anchored on an explicit marker — F2F, face to face, rep,
 * attendance — rather than on "not required" alone. That phrase turns up about
 * all sorts of things on a booking ("image intensifier not required", "second
 * tray not required") and reading any of them as "nobody go" would keep
 * somebody away from a case that needed them. The failure here has to be
 * towards attending.
 */
const NOT_NEEDED = [
  // "Brainlab F2F Not required", "F2F not req'd", "F2F — not required"
  /\b(?:f2f|face\s*[-–to]*\s*face)\b[^.\n]{0,20}?\bnot\s+req(?:uired|'?d)?\b/i,
  // "No F2F required", "no F2F"
  /\bno\s+f2f\b/i,
  // "F2F: no", "F2F - N"
  /\bf2f\s*[:–—-]\s*(?:no|n|not\s+required)\b/i,
  // Said about the person rather than the meeting.
  /\b(?:rep|attendance|technomed)\b[^.\n]{0,20}?\bnot\s+req(?:uired|'?d)?\b/i,
  /\bno\s+rep\s+req(?:uired|'?d)?\b/i
]

/** Whether a booking says we are not wanted in the room. */
export function attendanceNotRequired(text) {
  const haystack = String(text || '')
  if (!haystack.trim()) return false
  return NOT_NEEDED.some(pattern => pattern.test(haystack))
}

/**
 * What the card says about it.
 *
 * Short, because it goes on a badge. "Not required" on its own reads as though
 * something else was not required — the kit, the navigation — so it names us.
 */
export const NOT_REQUIRED_LABEL = 'We are not needed'
