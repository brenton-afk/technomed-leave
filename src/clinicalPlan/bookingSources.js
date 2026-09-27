// ─── Where bookings come from ────────────────────────────────────────────────
// Three places send cases to bookings@technomed.com.au, and they overlap on
// purpose. Knowing which is which decides how a duplicate is handled and — more
// importantly — what the app is allowed to say back.

export const BOOKING_SOURCES = [
  {
    id: 'rhh',
    label: 'RHH theatre lists',
    hospital: 'RHH',
    from: [/@ths\.tas\.gov\.au$/i],
    // One email, a whole week, as a pasted theatre-list table: seven cases
    // across four days is normal. It also carries patient first names and dates
    // of birth, which must be stripped at the door and never stored.
    shape: 'batch',
    carriesIdentifiers: true
  },
  {
    id: 'cns',
    label: 'CNS',
    hospital: 'CLV',
    // Two domains, one practice. The bookings desk writes from cnstas.com.au,
    // while the theatre lists come from tasmanianspineservice.com.au — found by
    // reading the mailbox rather than by asking, and easy to miss because the
    // lists are the ones that matter most.
    from: [/@cnstas\.com\.au$/i, /@tasmanianspineservice\.com\.au$/i],
    shape: 'single',
    // Usually arrives before Calvary's own copy. That is the whole reason this
    // source was added — see the note below.
    oftenFirst: true
  },
  {
    id: 'calvary',
    label: 'Calvary',
    hospital: 'CLV',
    from: [/@calvarycare\.org\.au$/i],
    shape: 'single'
  }
]

// ─────────────────────────────────────────────────────────────────────────────
// WHY CNS AND CALVARY BOTH SEND, AND WHAT NOT TO DO ABOUT IT
//
// CNS was added as a second source because Calvary's bookings sometimes arrived
// incomplete, or late on a Friday after the coordinator had gone home. It works:
// the CNS copy usually lands first and is often the more complete of the two.
//
// The coordinator at Calvary does not know we already have those bookings.
//
// So the duplicate handling here is not only a data question. **Nothing the app
// generates may reveal to Calvary that a booking was already known.** In
// practice:
//
//   · Never auto-reply or acknowledge an inbound booking email.
//   · Never tell a sender their booking is a duplicate.
//   · Never copy a hospital on a distributor request, a loan request or any
//     other message whose timing would show when we first knew.
//   · A merged booking keeps quiet about where each half came from in anything
//     that leaves the building. Inside the app, say it plainly — the team needs
//     to know which source to trust for detail.
//
// This is a relationship, not a rule anyone can look up, and it is exactly the
// sort of thing that gets removed by someone tidying up who does not know why it
// is here. It is here because Brent said so on 23 September 2026, and because
// getting it wrong costs something no feature is worth.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Distributors are not a booking source ───────────────────────────────────
// When we book a case, the distributor sends back a confirmation — usually a
// calendar invite addressed to bookings@, which Google then adds to the
// bookings calendar all by itself. Globus/Nuvasive and Device Technologies both
// do it, every single time.
//
// That echo is not a booking. It is *our own booking coming back to us*, and
// treating it as new produces exactly one thing: a duplicate case sitting next
// to the real one, on the calendar the whole team reads and in the app. A
// duplicate is worse than it sounds — two entries for one patient is how a case
// gets prepared twice, or cancelled once and left standing once.
//
// So distributor mail is ignored, and ignored *by name* rather than by simply
// not being recognised. The difference matters: an unrecognised sender is
// reported as "left alone, might be a booking nobody told us about", which
// invites somebody to helpfully add the domain as a source later and recreate
// this problem. These are known, deliberate, and permanent exclusions.
//
// The same list filters the calendar feed, because the invites land there
// whether or not the app ever reads the mailbox.

export const DISTRIBUTOR_DOMAINS = [
  'device.com.au',        // Device Technologies
  'globusmedical.com',    // Globus / Nuvasive
  'signus.com.au',
  'e4surgical.com',
  'ktmedical.com.au',
  'atecspine.com',
  'neurophys.com.au',
  'vifm.org'              // Donor Tissue Bank
]

/**
 * Whether an address belongs to a distributor.
 *
 * Matched on the domain and on `.domain` beneath it, so a subdomain cannot slip
 * past, while `notdevice.com.au` does not match `device.com.au`.
 */
export function isDistributorEmail(address) {
  const at = String(address || '').trim().toLowerCase().split('@')[1]
  if (!at) return false
  return DISTRIBUTOR_DOMAINS.some(domain => at === domain || at.endsWith(`.${domain}`))
}

/** Which source an email came from, or null if it is not a booking source. */
export function sourceOf(fromAddress) {
  const address = String(fromAddress || '').trim().toLowerCase()
  if (!address) return null
  return BOOKING_SOURCES.find(source => source.from.some(p => p.test(address))) || null
}

/**
 * Whether the app may send anything at all to this address about a booking.
 *
 * A blanket no for every booking source. They are where cases come *from*, and
 * replying tells them what they just told us at best, and when we knew it at
 * worst. See the note above.
 */
export function mayNotifyAboutBooking(address) {
  return sourceOf(address) === null
}

/**
 * Whether two bookings are the same case.
 *
 * Surname, date and surgeon, as agreed. The CNS copy and the Calvary copy of one
 * case will differ in wording — different kit phrasing, one may have a theatre
 * number — but those three agree, and any two cases that genuinely share all
 * three on one day would be remarkable.
 *
 * Names are compared case-insensitively and surgeons through `normaliseSurgeon`
 * by the caller, so "PETERS-WILLKE" and "JPW" count as the same person.
 */
export function isSameBooking(a, b) {
  if (!a || !b) return false
  const same = (x, y) => String(x || '').trim().toLowerCase() === String(y || '').trim().toLowerCase()
  return Boolean(a.date) && a.date === b.date
    && same(a.patient, b.patient)
    && same(a.surgeon, b.surgeon)
}

/**
 * One booking from two copies of it, preferring whichever actually said
 * something.
 *
 * Neither source is authoritative: CNS is often more complete, but Calvary's
 * copy sometimes carries a detail CNS did not have. Taking the longer value
 * field by field keeps whatever was said rather than picking a winner.
 */
export function mergeBookings(existing, incoming) {
  const merged = { ...existing }
  for (const [key, value] of Object.entries(incoming || {})) {
    if (key === 'sources') continue
    const have = String(merged[key] || '').trim()
    const got = String(value || '').trim()
    if (!got) continue
    if (!have || got.length > have.length) merged[key] = value
  }
  // Kept for the team's benefit, and for nobody outside it.
  merged.sources = [...new Set([...(existing?.sources || []), ...(incoming?.sources || [])])]
  return merged
}
