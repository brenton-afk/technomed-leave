// ─── From a booking to the right preference card ─────────────────────────────
// "A button on the booking for each case next to where it says List order that
// takes you to a surgeon preferences page. For example if the booking is
// Ibbett-Dakota-ACDF it takes you to the Dakota Preference card automatically,
// rather than having to browse through and find the appropriate card."
//
// The booking already knows both halves. It names the surgeon, and it names
// the system — that is what the title is parsed into — so the app can open the
// card instead of making somebody find it. Finding it is the whole cost: it is
// done at half past seven in the morning, in a corridor, by somebody who is
// carrying a tray.

/** Surgeons with a section in the preferences guide. Ids are `p-<name>`. */
export const PREFERENCE_SECTIONS = [
  'thani', 'ibbett', 'gupta', 'jpw', 'fowler', 'atallah', 'dubey'
]

/**
 * The anchor in the surgeon preferences guide for this surgeon, or null.
 *
 * Null rather than a guess. Opening the guide at the top is a reasonable
 * answer for a surgeon with no card; opening it at somebody else's card is
 * not, and the two are one typo apart.
 */
export function preferenceAnchor(surgeon) {
  const name = String(surgeon || '').trim().toLowerCase()
  if (!name) return null
  return PREFERENCE_SECTIONS.includes(name) ? `p-${name}` : null
}

/**
 * The theatre guide a booking's system corresponds to, or null.
 *
 * Matched on the slug and the name, because a booking says "Dakota" and the
 * guide is called "Dakota ACDF" with the slug `dakota`. Longest first, so
 * "REFORM POCT" is not beaten to it by a shorter guide whose name happens to
 * appear inside the booking text.
 */
export function guideForBooking(surgicalCase, guides = []) {
  const haystack = [surgicalCase?.system, surgicalCase?.operation, surgicalCase?.kit]
    .filter(Boolean).join(' ').toLowerCase()
  if (!haystack) return null

  const scored = guides
    .filter(g => g.slug && g.name && !g.restricted)
    .map(g => {
      const slug = String(g.slug).toLowerCase()
      // The distinctive part of the name: "Dakota ACDF" matches on "dakota",
      // and matching on "acdf" would pair every cervical case with it.
      const first = String(g.name).toLowerCase().split(/[\s·+]+/)[0]
      const hit = [slug, first].find(term => term.length > 3 && haystack.includes(term))
      return hit ? { guide: g, length: hit.length } : null
    })
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)

  return scored.length ? scored[0].guide : null
}

/**
 * Everything the preferences button should offer for a booking.
 *
 * Two different questions, and a booking usually answers both: how this
 * surgeon likes the room set up, and how this system goes together. Returned
 * together so the button can be one tap when there is one answer and a choice
 * when there are two.
 */
export function preferencesFor(surgicalCase, guides = []) {
  const anchor = preferenceAnchor(surgicalCase?.surgeon)
  const guide = guideForBooking(surgicalCase, guides)
  return {
    surgeon: anchor ? { surgeon: surgicalCase.surgeon, anchor } : null,
    guide: guide || null,
    any: Boolean(anchor || guide)
  }
}
