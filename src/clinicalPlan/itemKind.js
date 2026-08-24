// ─── What a non-case booking actually is ─────────────────────────────────────
// The bookings calendar carries more than theatre lists: approved leave (written
// there by this app), internal meetings, on-call and rostered hours, reminders.
// All of it was drawn the same way — a title and a time — so a week's worth of
// planning information read as one undifferentiated list, and the things that
// change what a day *asks* of the team were indistinguishable from the things
// that do not.
//
// This says which is which, once, so the calendar and the plan cannot disagree.
// Kept separate from the case reader in parse.js: that answers "is this a
// surgical case and what is in it", and this only runs on what is left.

/**
 * Order is the whole design. First match wins, so the more specific patterns
 * come first — "Annual Leave" is leave rather than a reminder even though a
 * leave note often says "due back", and "On call" is hours rather than a meeting
 * even when it is written as a handover.
 */
const KINDS = [
  {
    kind: 'leave',
    label: 'Leave',
    // Written by this app's own approval path as "{Name} — Annual Leave" in
    // Grape, so the colour is the reliable half and the words are the fallback
    // for leave somebody entered by hand.
    match: /\b(?:annual leave|personal leave|sick leave|carer'?s leave|toil|leave|a\/l)\b/i,
    colourName: 'grape'
  },
  {
    kind: 'hours',
    label: 'Hours',
    // Who is available, and when. This is the layer people plan a week around
    // and it had no visual identity at all.
    match: /\b(?:on ?call|rostered|roster|shift|hours|wfh|working from home|day off|rdo|in (?:nsa|office|melbourne|sydney|launceston|burnie))\b/i
  },
  {
    kind: 'meeting',
    label: 'Meeting',
    match: /\b(?:meeting|catch ?up|handover|review|1:1|one[- ]on[- ]one|training|in[- ]?service|conference|workshop|webinar|call)\b/i
  },
  {
    kind: 'reminder',
    label: 'Reminder',
    match: /\b(?:remind(?:er)?|due|deadline|order|reorder|follow[- ]?up|chase|submit|expiry|expires)\b/i
  }
]

/**
 * @param {{title?: string, summary?: string, description?: string, colourName?: string}} item
 * @returns {{kind: string, label: string}} `kind: 'other'` when nothing matches,
 *          which is deliberate: an unrecognised booking is shown as itself rather
 *          than forced into a category it may not belong to.
 */
export function classifyItem(item = {}) {
  const text = `${item.title || item.summary || ''}\n${item.description || ''}`
  const colour = String(item.colourName || '').toLowerCase()

  // Grape is this app's own leave colour, so it settles the question before any
  // wording does — a leave entry titled only with a name still reads as leave.
  if (colour === 'grape') return { kind: 'leave', label: 'Leave' }

  for (const candidate of KINDS) {
    if (candidate.match.test(text)) return { kind: candidate.kind, label: candidate.label }
  }
  return { kind: 'other', label: 'Other' }
}

/** Every kind, for a legend. Cases are not in here — they are the default. */
export const ITEM_KINDS = [...KINDS.map(({ kind, label }) => ({ kind, label })),
  { kind: 'other', label: 'Other' }]
