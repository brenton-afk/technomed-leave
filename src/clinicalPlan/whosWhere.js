// ─── Who's where (option B, Brent 25 Nov 2026) ───────────────────────────────
// One answer per person per day, for the strip of avatars on Cases and the
// whole-team page. Brent's answers: Theatre comes by itself from the bookings —
// a planned rep counts as well as the rep who attended; Office is the default
// for Erin and Toni; away, training and leave come from the Staff Leave
// calendar; anyone can add a status; leave shows as "Leave" only.
//
// Pure: the plan, the portal's own status entries and the staff list in, a
// row per person out. The order a status wins in:
//   Leave  >  Away / RDO  >  Training  >  a status someone added  >
//   Theatre from the bookings  >  Office for Erin and Toni  >  nothing.

import { STAFF } from '../staffConfig.js'

/** Who appears: everyone who files a timesheet or is on the clinical team. */
export const WHO_PEOPLE = STAFF.filter(s => s.hasTimesheets || s.isClinicalTeam)

/** Office unless anything says otherwise (Brent, 25 Nov 2026). */
export const OFFICE_BY_DEFAULT = ['erin@technomed.com.au', 'toni@technomed.com.au']

export const WHO_KINDS = {
  theatre: { label: 'Theatre', tag: 'THEATRE' },
  office: { label: 'Office', tag: 'OFFICE' },
  training: { label: 'Training / travel', tag: 'TRAINING' },
  away: { label: 'Away', tag: 'AWAY' },
  leave: { label: 'Leave', tag: 'LEAVE' }
}

export const initialsOf = person => {
  const parts = String(person.name || person.firstName || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return (parts[0] || '?').slice(0, 2).toUpperCase()
}

const namesOf = person => [person.firstName, person.name, ...(person.aka || [])]
  .filter(Boolean).map(n => n.toLowerCase())

/** Is this person named on the booking — attended or planned? */
function onCase(person, c) {
  const names = namesOf(person)
  const said = [
    ...String(c.rep || '').split(/[/,&+]| and /i),
    ...(Array.isArray(c.planned) ? c.planned : String(c.planned || '').split(/[/,&+]/))
  ].map(s => String(s || '').trim().toLowerCase()).filter(Boolean)
  return said.some(s => names.includes(s))
}

const shortHospital = h => {
  const t = String(h || '')
  if (/calvary/i.test(t)) return 'Calvary'
  if (/royal hobart|\brhh\b/i.test(t)) return 'RHH'
  if (/\blgh\b|launceston/i.test(t)) return 'LGH'
  return t
}

const covers = (e, date) => e.from <= date && e.to >= date

/** "All day", or "08:00–12:00". */
const whenOf = e => (e && e.allDay === false && e.start ? `${e.start}–${e.end}` : 'All day')

/**
 * The day for every person. `day` is a day of the week plan (its
 * casesByHospital), `away` the plan's whoIsAway, `entries` the portal's status
 * records. Each row: { person, initials, kind, short, where, when, note,
 * entry, source } — kind null when nothing is known.
 */
export function whosWhere({ date, day, away = [], entries = [], people = WHO_PEOPLE } = {}) {
  const cases = (day?.casesByHospital || [])
    .flatMap(g => (g.cases || []).map(c => ({ ...c, hospital: c.hospital || g.hospital })))
    .filter(c => !c.cancelled && !c.notRequired)

  return people.map(person => {
    const email = person.email.toLowerCase()
    const base = { person, initials: initialsOf(person), kind: null, short: '', where: '', when: '', note: '', entry: null, source: null }
    const mine = entries.filter(e => String(e.email || '').toLowerCase() === email && covers(e, date))
    const entryOf = kind => mine.find(e => (e.kind || 'away') === kind) || null

    // The calendar's answer: leave, away, RDO or training.
    const off = away.find(a => String(a.email || '').toLowerCase() === email && (a.days || []).includes(date))
    if (off) {
      const word = off.why?.[date] || 'Leave'
      if (word === 'Leave') {
        const e = entryOf('leave')
        return { ...base, kind: 'leave', short: 'LEAVE', where: 'On leave', when: whenOf(e), entry: e, source: 'calendar' }
      }
      const said = off.reason?.[date] || ''
      if (word === 'Training') {
        const e = entryOf('training')
        const where = e?.where || e?.reason || said
        return { ...base, kind: 'training', short: (where || 'TRAINING').toUpperCase().slice(0, 9), where: where || 'Training / travel', when: whenOf(e), note: [e?.reason && e.reason !== where ? e.reason : '', e?.note].filter(Boolean).join(' · '), entry: e, source: 'calendar' }
      }
      const e = entryOf('away')
      const why = e?.reason || said
      return { ...base, kind: 'away', short: word === 'RDO' ? 'RDO' : (why ? why.toUpperCase().slice(0, 12) : 'AWAY'), where: word === 'RDO' ? 'RDO' : (why ? `Away · ${why}` : 'Away'), when: whenOf(e), note: e?.note || '', entry: e, source: 'calendar' }
    }

    // A status somebody added in the portal (Theatre, Office), newest first.
    const own = [...mine].filter(e => ['theatre', 'office'].includes(e.kind)).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]
    if (own) {
      const isTheatre = own.kind === 'theatre'
      return {
        ...base, kind: own.kind, short: isTheatre ? 'THEATRE' : 'OFFICE',
        where: own.where || (isTheatre ? 'Theatre' : 'TechnoMed office'), when: whenOf(own), note: own.note || '',
        entry: own, source: 'added'
      }
    }

    // Theatre, read off the bookings: attended or planned.
    const theirs = cases.filter(c => onCase(person, c))
    if (theirs.length) {
      const places = [...new Set(theirs.map(c => shortHospital(c.hospital)).filter(Boolean))]
      const note = theirs.map(c => [c.patient, c.surgeon].filter(Boolean).join(' · ')).filter(Boolean).join('; ')
      return { ...base, kind: 'theatre', short: places.length === 1 ? places[0].toUpperCase().slice(0, 9) : 'THEATRE', where: places.join(' & ') || 'Theatre', when: 'All day', note, source: 'bookings', cases: theirs.length }
    }

    if (OFFICE_BY_DEFAULT.includes(email)) {
      return { ...base, kind: 'office', short: 'OFFICE', where: 'TechnoMed office', when: 'All day', source: 'default' }
    }
    return base
  })
}

/** The whole-team page's groups, in the mock-up's order. */
export function groupWhosWhere(rows) {
  const order = [
    ['theatre', 'Theatre'], ['office', 'Office'], ['training', 'Training / travel'],
    ['off', 'Away / leave'], ['none', 'No entry']
  ]
  const keyOf = r => (!r.kind ? 'none' : (r.kind === 'away' || r.kind === 'leave') ? 'off' : r.kind)
  return order.map(([key, label]) => ({ key, label, rows: rows.filter(r => keyOf(r) === key) }))
    .filter(g => g.rows.length)
}
