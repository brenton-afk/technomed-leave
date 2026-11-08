// ─── ETBS (Brent, 8 Nov 2026) ────────────────────────────────────────────────
// Extra information about an RHH case, shown on the case card beside the list
// place: "No ETBS is just extra information I want to show on the case tab like
// the list order arrows." Not navigation and not billed.
//
// Kept on the booking itself as an "ETBS: Yes" line in the description, like
// "List:" — so the calendar is the record and the phone and desktop read the
// same thing. Offered for RHH bookings only.

export const isRhh = hospital => /\b(?:rhh|royal\s+hobart)\b/i.test(String(hospital || ''))

/** Whether a labelled "ETBS:" value says yes. */
export function etbsFrom(value) {
  return /^\s*(?:y|yes|true|1|✓)\b/i.test(String(value || ''))
}
