// ─── Away: paid, but not available for cases (Brent, 24 Nov 2026) ───────────
// "How should staff enter something like Mat being at a training event into
// the portal? It's not a task … He's not on leave as he'll be paid for his
// time there, but he is also not available for cases." Then: "Leave the colour
// of the away as the same colour as leave as that flags it in the same way for
// the team … That can also cover RDOs."
//
// An Away entry is written to the Staff Leave calendar in the leave colour
// (Grape), so everything that already treats leave as "not here" — the day's
// chip, the team leader sheet — treats it the same way. It is never a leave
// application: nothing goes to Xero and the person's balance is untouched;
// they enter their hours on their timesheet as a normal day.
//
// Pure: shared by the screen and api/_away.js.

import { STAFF } from '../staffConfig.js'

/** Who may add and remove Away entries: Brent, Erin and Toni. */
export const AWAY_EDITOR_EMAILS = ['brenton@technomed.com.au', 'erin@technomed.com.au', 'toni@technomed.com.au']

export const mayAddAway = (email, list = AWAY_EDITOR_EMAILS) =>
  list.map(e => e.toLowerCase()).includes(String(email || '').toLowerCase())

/** The kinds offered as buttons; anything else is typed. */
export const AWAY_REASONS = ['Training day', 'RDO', 'Conference', 'Course']

/** The words a title carries after the dash, so the calendar reads it plainly. */
export function awayWords(reason) {
  const r = String(reason || '').trim().replace(/\s+/g, ' ').slice(0, 60)
  if (!r) return 'Away'
  if (/^rdo$/i.test(r)) return 'RDO'
  return `Away · ${r}`
}

/** "Mat — Away · Training day" — the title on the Staff Leave calendar. */
export const awayTitle = (person, reason) => `${person.firstName} — ${awayWords(reason)}`

/**
 * Read back off an entry's title: null when it is not an Away entry,
 * else the short word for the chip ("Away" or "RDO") and the reason.
 */
export function readAwayTitle(title) {
  const t = String(title || '')
  const m = t.match(/—\s*(?:Away(?:\s*·\s*(.+))?|(RDO))\s*$/i)
  if (!m) return null
  if (m[2]) return { word: 'RDO', reason: 'RDO' }
  return { word: 'Away', reason: (m[1] || '').trim() }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Checks what the sheet sent. Returns { error } or the clean entry.
 * All day across a run of days, or set hours on one day.
 */
export function cleanAway(body = {}) {
  const person = STAFF.find(s => s.email.toLowerCase() === String(body.email || '').toLowerCase())
  if (!person) return { error: 'Choose who is away.' }
  const from = String(body.from || '')
  const to = String(body.to || from)
  if (!DAY.test(from) || !DAY.test(to)) return { error: 'Choose the day.' }
  if (to < from) return { error: 'The last day is before the first.' }
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000
  if (span > 31) return { error: 'An away entry can be at most a month long.' }
  const reason = String(body.reason || '').trim().replace(/\s+/g, ' ').slice(0, 60)
  if (!reason) return { error: 'Say why — Training day, RDO, or type it.' }
  const allDay = body.allDay !== false
  let start = ''
  let end = ''
  if (!allDay) {
    if (from !== to) return { error: 'Set hours are for one day. Use All day for several.' }
    start = String(body.start || '')
    end = String(body.end || '')
    if (!HHMM.test(start) || !HHMM.test(end)) return { error: 'Give the start and finish times.' }
    if (end <= start) return { error: 'The finish is before the start.' }
  }
  const note = String(body.note || '').trim().slice(0, 300)
  return { person, from, to, allDay, start, end, reason, note }
}

const nextDay = d => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }

/** The Google Calendar event for an entry. Hobart wall-clock for set hours. */
export function awayEvent(entry, byName = '') {
  const { person, from, to, allDay, start, end, reason, note } = entry
  return {
    summary: awayTitle(person, reason),
    description: [
      `Employee: ${person.name}`,
      `Away: ${reason}`,
      'Not leave — paid as a normal working day, but not available for cases.',
      ...(note ? ['', note] : []),
      '',
      `Added in the TechnoMed Portal${byName ? ` by ${byName}` : ''}`
    ].join('\n'),
    start: allDay ? { date: from } : { dateTime: `${from}T${start}:00`, timeZone: 'Australia/Hobart' },
    end: allDay ? { date: nextDay(to) } : { dateTime: `${from}T${end}:00`, timeZone: 'Australia/Hobart' },
    colorId: '3',
    transparency: 'transparent',
    extendedProperties: { private: { tmAway: '1', tmAwayEmail: person.email } }
  }
}

/** "Thu 26 Nov", "Thu 26 – Fri 27 Nov", "Thu 26 Nov · 08:00–12:00" */
export function awayWhen(e) {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const f = d => { const x = new Date(`${d}T12:00:00Z`); return `${DAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}` }
  const days = e.from === e.to ? f(e.from) : `${f(e.from)} – ${f(e.to)}`
  return e.allDay === false ? `${days} · ${e.start}–${e.end}` : days
}
