// ─── The running order of a theatre list ─────────────────────────────────────
// The hospital settles the order of a day's list late the afternoon before. The
// team leader rings round at four or five, and posts what they are told to the
// WhatsApp group. This is that message, in the app, where the people who need it
// are already looking.
//
// What matters is *position*, not time. The hospital does not give times and the
// ones it gives move all day. What the position tells you is what you have to
// know by the evening before: whether one of ours is first up — somebody on site
// by half seven — or whether there is a craniotomy ahead of us and the morning
// is free.
//
// So this records the order and nothing else. No estimated start times, no
// arithmetic on typical durations. Those would be a guess, and a guess about
// what time to arrive is one people would act on.
//
// A list is a theatre, not a surgeon. Tomorrow at RHH, Kon is Fowler's case
// sitting on Dubey's list — normal, and unrepresentable if a list belongs to one
// surgeon.

/** Cases on the list that are not ours: another surgeon, another company. */
export const OTHER = 'other'
/** A booking of ours, matched to the calendar by its event id. */
export const OURS = 'ours'

/** The key a list is stored and looked up under. */
export function listKey(date, hospital, theatre) {
  const site = String(hospital || '').trim().toUpperCase() || 'UNKNOWN'
  const room = String(theatre || '').trim() || 'main'
  return `${date}:${site}:${room}`
}

/** "Theatre Number 11", "Th 11", "theatre 11" — whatever the booking says. */
export function theatreFrom(text) {
  const found = /\btheatre\s*(?:number\s*)?(\d{1,2})\b|\bth\s*(\d{1,2})\b/i.exec(String(text || ''))
  return found ? (found[1] || found[2]) : null
}

/**
 * The day's cases grouped into the lists they belong to.
 *
 * Grouped by hospital and theatre. A case whose theatre nobody wrote down goes
 * into that hospital's unnumbered list rather than being dropped — most Calvary
 * bookings never name a theatre, and a list nobody can see is worse than one
 * without a number on it.
 */
export function listsForDay(cases = []) {
  const lists = new Map()
  for (const c of cases) {
    if (c.cancelled) continue
    const theatre = c.theatre || theatreFrom(`${c.notes || ''} ${c.operation || ''}`)
    const key = listKey('', c.hospital, theatre)
    if (!lists.has(key)) {
      lists.set(key, { hospital: c.hospital, theatre: theatre || null, cases: [] })
    }
    lists.get(key).cases.push(c)
  }
  return [...lists.values()]
}

/**
 * One list's running order, as the screen needs it.
 *
 * Takes what was recorded and the day's actual bookings, and returns the order
 * with each of ours resolved back to its live booking. Resolving late rather
 * than storing a copy means a case that has since been edited — a kit changed,
 * a rep added — shows as it is now, not as it was at five o'clock yesterday.
 *
 * Bookings of ours that are not in the recorded order are appended, marked as
 * unplaced. A case added after the order was taken must not vanish because the
 * list was written before it existed.
 *
 * @param {{entries: Array}|null} recorded  what the team leader entered
 * @param {Array} cases  our bookings on that list today
 */
export function runningOrder(recorded, cases = []) {
  const byId = new Map(cases.map(c => [c.id, c]))
  const placed = []
  const seen = new Set()

  for (const entry of recorded?.entries || []) {
    if (entry.kind === OURS) {
      const booking = byId.get(entry.eventId)
      // A booking that has since been deleted or moved off this day. Dropped
      // rather than shown as a ghost — but the positions after it close up, so
      // the order still reads 1, 2, 3.
      if (!booking) continue
      seen.add(entry.eventId)
      placed.push({ kind: OURS, booking })
    } else {
      placed.push({ kind: OTHER, label: entry.label || 'Another case', note: entry.note || '' })
    }
  }

  const unplaced = cases.filter(c => !seen.has(c.id))
  return {
    entries: placed.map((e, i) => ({ ...e, position: i + 1 })),
    // Ours, added since the order was taken. Shown apart so it is obvious they
    // have no position rather than looking like they are last.
    unplaced,
    // Whether anyone has recorded anything at all for this list.
    recorded: Boolean(recorded?.entries?.length),
    updatedBy: recorded?.updatedBy || null,
    updatedAt: recorded?.updatedAt || null
  }
}

/**
 * Where our cases sit, in a sentence.
 *
 * The one thing the team reads first. "Ours are 2nd and 3rd up" answers the
 * evening's question — is anybody needed at half seven — without anybody having
 * to count down a list.
 */
export function summarise(order) {
  const ours = (order?.entries || [])
    .filter(e => e.kind === OURS)
    .map(e => e.position)
  if (!ours.length) return order?.recorded ? 'None of ours on this list' : null

  const ordinal = n => {
    const tens = n % 100
    if (tens >= 11 && tens <= 13) return `${n}th`
    return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`
  }

  if (ours[0] === 1) {
    // The case the whole exercise exists for. Said plainly and first.
    return ours.length === 1
      ? 'Ours is first up'
      : `Ours is first up, then ${ours.slice(1).map(ordinal).join(' and ')}`
  }
  const list = ours.map(ordinal)
  const last = list.pop()
  return `Ours ${list.length ? `${list.join(', ')} and ${last}` : last} up`
}

/** Whether one of ours leads the list — the reason anybody rings the hospital. */
export function oursFirstUp(order) {
  return (order?.entries || []).some(e => e.position === 1 && e.kind === OURS)
}
