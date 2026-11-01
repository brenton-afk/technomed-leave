// ─── Who entered a booking, and who has changed it since ─────────────────────
// "Entered by Brent" was appearing on bookings other people had entered.
//
// The line is written at the foot of a booking's notes, the way the team
// already wrote "Entered/amended by Brent" by hand. The bug was in what an
// *edit* did to a booking that had no line yet — every booking typed straight
// into Google Calendar, which is most of them. The save added "Entered by"
// with the editor's name, so the first person to touch a booking in the portal
// (very often Brent, recording who attended or where it sits on the list)
// became the person who entered it.
//
// Now an edit never claims to have entered anything. It records an amendment,
// with the date, and keeps whoever entered the booking — from the line, or
// from the event's private properties where the portal recorded it at
// creation (`tmEnteredBy`), so a line tidied away in Google does not lose it.
//
// There is no fallback name. Nobody known means nothing is written.

const LINE = /^(?:Entered|Amended) by [^\n]*$/mi

/** "1/11/2026" for a YYYY-MM-DD day — how the team writes dates in notes. */
function shortDate(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''))
  return m ? `${Number(m[3])}/${Number(m[2])}/${m[1]}` : ''
}

/** The name with any "(from email)" taken off, for comparing people. */
const bare = name => String(name || '').replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase()

/** Who the line says entered the booking, or null. */
export function enteredByOf(description) {
  const line = LINE.exec(String(description || ''))?.[0]
  const m = line && /^Entered by ([^·\n]+)/i.exec(line)
  return m ? m[1].trim() : null
}

/**
 * The creator's tag: "Toni", or "Toni (from email)" for a booking confirmed
 * out of the mailbox queue.
 */
export function creatorTag(name, { source } = {}) {
  const who = String(name || '').trim()
  if (!who) return ''
  return source === 'email' ? `${who} (from email)` : who
}

/**
 * The description with its attribution line written or updated.
 *
 * @param {string} description
 * @param {string} name        the signed-in person's first name; '' writes nothing
 * @param {object} opts
 * @param {boolean} [opts.created]   a new booking: "Entered by <name>"
 * @param {'email'} [opts.source]    confirmed from the email check
 * @param {string}  [opts.knownCreator] the creator recorded on the event
 * @param {string}  [opts.today]     YYYY-MM-DD in Hobart, for the amendment
 */
export function withAttribution(description, name, { created = false, source, knownCreator, today } = {}) {
  const who = String(name || '').trim()
  if (!who) return description
  const text = String(description || '').replace(/\r\n?/g, '\n').trimEnd()

  if (created) {
    const line = `Entered by ${creatorTag(who, { source })}`
    return LINE.test(text)
      ? text.replace(LINE, line)
      : `${text}${text ? '\n\n' : ''}${line}`
  }

  const creator = enteredByOf(text) || String(knownCreator || '').trim() || null
  const when = shortDate(today)
  const amended = `amended by ${who}${when ? ` ${when}` : ''}`

  const line = !creator
    ? `A${amended.slice(1)}`
    // Somebody amending their own booking is not two people.
    : bare(creator) === bare(who)
      ? `Entered by ${creator}`
      : `Entered by ${creator} · ${amended}`

  return LINE.test(text)
    ? text.replace(LINE, line)
    : `${text}${text ? '\n\n' : ''}${line}`
}
