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

/**
 * Who may add and remove entries. Since the who's-where strip (Brent, 25 Nov
 * 2026: "Everyone can add a status") that is anyone on the staff list; the
 * list argument is kept for the server's AWAY_EDITORS override.
 */
export const AWAY_EDITOR_EMAILS = ['brenton@technomed.com.au', 'erin@technomed.com.au', 'toni@technomed.com.au']

export const mayAddAway = (email, list = null) => {
  const e = String(email || '').toLowerCase()
  if (list) return list.map(x => x.toLowerCase()).includes(e)
  return STAFF.some(s => s.email.toLowerCase() === e)
}

/** The kinds offered as buttons on Away; anything else is typed. */
export const AWAY_REASONS = ['Training day', 'RDO', 'Conference', 'Course']

/**
 * The five statuses of the who's-where strip (option B, Brent 25 Nov 2026).
 * Training, Away and Leave go on the Staff Leave calendar in the leave colour
 * — "not here" for everything that reads leave; Theatre and Office are kept
 * by the portal only. Theatre also comes by itself from the bookings, and
 * Office is the default for Erin and Toni.
 */
export const STATUS_KINDS = [
  { id: 'theatre', label: 'Theatre', hint: 'Covering cases at a hospital', calendar: false },
  { id: 'office', label: 'Office', hint: 'TechnoMed office day', calendar: false },
  { id: 'training', label: 'Training / travel', hint: 'Courses, trips, conferences', calendar: true },
  { id: 'away', label: 'Away', hint: 'Out, not on leave — an RDO, a day off site', calendar: true },
  { id: 'leave', label: 'Leave', hint: 'Shows as "Leave" only — the reason stays in Xero', calendar: true }
]
export const kindOf = id => STATUS_KINDS.find(k => k.id === id) || STATUS_KINDS[3]

/** The words a title carries after the dash, so the calendar reads it plainly. */
export function awayWords(reason, kind = 'away') {
  const r = String(reason || '').trim().replace(/\s+/g, ' ').slice(0, 60)
  if (kind === 'leave') return 'Leave'
  if (kind === 'training') return r ? `Training · ${r}` : 'Training'
  if (kind === 'office') return 'Office'
  if (kind === 'theatre') return r ? `Theatre · ${r}` : 'Theatre'
  if (!r) return 'Away'
  if (/^rdo$/i.test(r)) return 'RDO'
  return `Away · ${r}`
}

/** "Mat — Away · Training day" — the title on the Staff Leave calendar. */
export const awayTitle = (person, reason, kind = 'away') => `${person.firstName} — ${awayWords(reason, kind)}`

/**
 * Read back off an entry's title: null when it is not one of ours, else the
 * short word for the chip ("Away", "RDO", "Training", "Leave") and the reason.
 */
export function readAwayTitle(title) {
  const t = String(title || '')
  const m = t.match(/—\s*(?:Away(?:\s*·\s*(.+))?|(RDO)|Training(?:\s*·\s*(.+))?|(Leave))\s*$/i)
  if (!m) return null
  if (m[2]) return { word: 'RDO', reason: 'RDO' }
  if (m[4]) return { word: 'Leave', reason: 'Leave' }
  if (/—\s*Training/i.test(t)) return { word: 'Training', reason: (m[3] || '').trim() }
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
  if (!person) return { error: 'Choose who.' }
  const kind = STATUS_KINDS.some(k => k.id === body.kind) ? body.kind : 'away'
  const from = String(body.from || '')
  const to = String(body.to || from)
  if (!DAY.test(from) || !DAY.test(to)) return { error: 'Choose the day.' }
  if (to < from) return { error: 'The last day is before the first.' }
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000
  if (span > 31) return { error: 'An entry can be at most a month long.' }
  const reason = String(body.reason || '').trim().replace(/\s+/g, ' ').slice(0, 60)
  if (kind === 'away' && !reason) return { error: 'Say why — Training day, RDO, or type it.' }
  const where = String(body.where || '').trim().replace(/\s+/g, ' ').slice(0, 60)
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
  return { person, kind, from, to, allDay, start, end, reason: kind === 'leave' ? '' : reason, where, note }
}

const nextDay = d => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }

/** The Google Calendar event for an entry. Hobart wall-clock for set hours. */
export function awayEvent(entry, byName = '') {
  const { person, from, to, allDay, start, end, reason, note, where } = entry
  const kind = entry.kind || 'away'
  const words = kind === 'training' ? (where || reason) : reason
  const lines = kind === 'leave'
    ? [`Employee: ${person.name}`, 'Leave — the request itself goes through the Leave form.']
    : [
        `Employee: ${person.name}`,
        kind === 'training' ? `Training / travel${where ? `: ${where}` : ''}${reason && reason !== where ? ` · ${reason}` : ''}` : `Away: ${reason}`,
        'Not leave — paid as a normal working day, but not available for cases.'
      ]
  return {
    summary: awayTitle(person, words, kind),
    description: [
      ...lines,
      ...(note ? ['', note] : []),
      '',
      `Added in the TechnoMed Portal${byName ? ` by ${byName}` : ''}`
    ].join('\n'),
    start: allDay ? { date: from } : { dateTime: `${from}T${start}:00`, timeZone: 'Australia/Hobart' },
    end: allDay ? { date: nextDay(to) } : { dateTime: `${from}T${end}:00`, timeZone: 'Australia/Hobart' },
    colorId: '3',
    transparency: 'transparent',
    extendedProperties: { private: { tmAway: '1', tmAwayEmail: person.email, tmStatus: kind } }
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
