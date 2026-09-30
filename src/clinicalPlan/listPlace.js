// ─── Where we are on the hospital's list ─────────────────────────────────────
// The hospital rings about four o'clock the afternoon before and reads out the
// running order. What comes back is not "our cases, in order" — it is the whole
// theatre list, most of which is nothing to do with us:
//
//   Mr JPW, Thursday, RHH
//     1. PLIF — KT Medical kit, their rep, we are not needed
//     2. Thompson — ours, so about one o'clock
//
// The first thing built here let the team move our own cases past each other,
// which cannot say that at all. Thompson is our only case at RHH that day, so
// there is nothing to move it past, and the fact that matters — second up,
// behind something we are not at, so nobody drives in for eight o'clock — had
// nowhere to live.
//
// So the fact is recorded against the case:
//
//   · which number we are on that hospital's list
//   · whether it is the morning list or the afternoon list
//   · when we are wanted, if anybody said
//   · what is ahead of us, in words, when it explains the wait
//
// Written into the booking's own notes as one labelled line, the same as every
// other field. The calendar is the record; there is no second copy of the
// running order to disagree with it, and the line reads plainly in Google for
// anybody looking there rather than at the app.

/** The sessions a list runs in. A day can have both, with different orders. */
export const SESSIONS = [
  { id: 'morning', label: 'Morning', short: 'AM' },
  { id: 'afternoon', label: 'Afternoon', short: 'PM' }
]

const SESSION_IDS = SESSIONS.map(s => s.id)

/** 1 → "1st". The team says "first up", "second up"; the card should too. */
export function ordinal(n) {
  const number = Number(n)
  if (!Number.isInteger(number) || number < 1) return ''
  // 11th, 12th and 13th break the pattern the last digit would otherwise give.
  const teens = number % 100
  if (teens >= 11 && teens <= 13) return `${number}th`
  return `${number}${({ 1: 'st', 2: 'nd', 3: 'rd' })[number % 10] || 'th'}`
}

/** Nothing recorded at all, which is the normal state until somebody rings. */
const EMPTY = place => !place
  || (!place.position && !place.session && !place.from && !place.ahead)

const SEPARATOR = ' · '

/**
 * The one line that goes in the booking's notes.
 *
 * Deliberately readable rather than compact. Half the team reads these bookings
 * in Google Calendar on a phone rather than in the app, and a packed field of
 * codes would be worse for them than the WhatsApp message this replaces.
 */
export function formatListPlace(place) {
  if (EMPTY(place)) return ''
  const parts = []
  if (place.position) parts.push(ordinal(place.position))
  if (place.session) {
    parts.push(SESSIONS.find(s => s.id === place.session)?.label.toLowerCase() || '')
  }
  if (place.from) parts.push(`from ${place.from}`)
  if (place.ahead) parts.push(place.ahead)
  return parts.filter(Boolean).join(SEPARATOR)
}

/**
 * Reads that line back.
 *
 * Forgiving about what it is given, because the line is meant to be editable by
 * hand in Google — somebody typing "List: 2nd, afternoon" should not lose it for
 * using a comma. Anything that cannot be placed is kept whole as `ahead`, which
 * is where free words belong, rather than dropped.
 */
export function parseListPlace(line) {
  const text = String(line || '').trim()
  if (!text) return null

  const place = { position: null, session: null, from: '', ahead: '' }
  const leftovers = []

  // Split on what this writes, and on the commas somebody types instead. Not
  // on dashes: "after a PLIF — KT Medical, not ours" is one explanation, and
  // breaking it at the dash rewrote the words the team had chosen.
  for (const raw of text.split(/\s*[·|;]\s*|,\s+/)) {
    const part = raw.trim()
    if (!part) continue

    // "2nd", "2nd on the list", or a bare "2".
    const position = /^(\d{1,2})(?:st|nd|rd|th)?(?:\s+(?:on\s+the\s+list|up))?$/i.exec(part)
    if (position && !place.position) {
      place.position = Number(position[1])
      continue
    }

    const session = SESSIONS.find(s =>
      new RegExp(`^(?:${s.id}|${s.short}|${s.id}\\s+list)$`, 'i').test(part))
    if (session && !place.session) {
      place.session = session.id
      continue
    }

    const from = /^(?:from|at|about|approx\.?|around)\s+(.+)$/i.exec(part)
    if (from && !place.from) {
      place.from = from[1].trim()
      continue
    }

    leftovers.push(part)
  }

  place.ahead = leftovers.join(', ')
  return EMPTY(place) ? null : place
}

/**
 * Tidies whatever came off a form into what gets stored.
 *
 * A position of nought or a session nobody offers is dropped rather than
 * corrected — a running order the app quietly invented is worse than a blank
 * one, because nobody would know to check it.
 */
export function cleanListPlace(given = {}) {
  const position = Number(given.position)
  const place = {
    position: Number.isInteger(position) && position >= 1 && position <= 40 ? position : null,
    session: SESSION_IDS.includes(given.session) ? given.session : null,
    from: String(given.from || '').trim().slice(0, 20),
    ahead: String(given.ahead || '').trim().slice(0, 120)
  }
  return EMPTY(place) ? null : place
}

/**
 * How the card says it.
 *
 * The position leads, because it is the part that decides what time somebody
 * gets out of bed. The words about what is ahead are returned separately: they
 * are an explanation, not part of the fact, and they read as a second line.
 *
 * @returns {{headline: string, ahead: string}|null}
 */
export function describeListPlace(place) {
  if (EMPTY(place)) return null
  const bits = []
  if (place.position) bits.push(`${ordinal(place.position)} on the list`)
  if (place.session) bits.push(SESSIONS.find(s => s.id === place.session)?.short || '')
  if (place.from) bits.push(`from ${place.from}`)
  return { headline: bits.filter(Boolean).join(SEPARATOR), ahead: place.ahead || '' }
}

/**
 * Cases in the order the lists run.
 *
 * Morning before afternoon, then by position, then by whatever order they were
 * already in. A case nobody has rung about yet falls in behind the ones they
 * have — a known place is worth more than an assumed one — and keeps its order
 * among the other unplaced cases. Nothing known at all counts as the morning,
 * which is where a list starts and where the day was laid out before any of
 * this existed.
 */
export function bySession(cases = []) {
  const rank = c => {
    const place = c?.listPlace
    const session = place?.session === 'afternoon' ? 1 : 0
    return [place?.session ? session : 0, place?.position || Number.MAX_SAFE_INTEGER]
  }
  return cases
    .map((c, index) => ({ c, index, rank: rank(c) }))
    .sort((a, b) =>
      a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.index - b.index)
    .map(entry => entry.c)
}

const LIST_LINE = /^\s*list\s*[:\-–]\s*.*$/gim

/**
 * Puts the line into a booking's notes, replacing whatever was there.
 *
 * Appended rather than written at the top. The notes open with the labelled
 * fields the team has typed for years — Surg, Pt, Hosp — and pushing a line
 * above them would rearrange every booking in Google for a fact that changes
 * daily. Passing nothing takes the line out, which is how a list order given
 * wrongly gets undone.
 */
export function withListPlace(description, place) {
  const body = String(description || '').replace(/\r\n?/g, '\n')
    .replace(LIST_LINE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const line = formatListPlace(place)
  if (!line) return body
  return body ? `${body}\nList: ${line}` : `List: ${line}`
}
