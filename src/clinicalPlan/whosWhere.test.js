import { describe, it, expect } from 'vitest'
import { whosWhere, groupWhosWhere, WHO_PEOPLE } from './whosWhere.js'

// Option B (Brent, 25 Nov 2026): Theatre from the bookings, planned reps
// count; Office the default for Erin and Toni; away, training and leave from
// the calendar; leave shows as "Leave" only.
const D = '2026-11-25'
const day = { date: D, casesByHospital: [
  { hospital: 'Calvary Lenah Valley', cases: [{ patient: 'Davis', surgeon: 'JPW', planned: ['Ben'] }] },
  { hospital: 'Royal Hobart Hospital', cases: [{ patient: 'Jones', surgeon: 'Fowler', rep: 'Mat' }, { patient: 'X', surgeon: 'Y', rep: 'Aimee', cancelled: true }] }
] }
const row = (rows, name) => rows.find(r => r.person.firstName === name)

describe("who's where", () => {
  it('reads theatre off the bookings — planned and attended — and ignores a cancelled case', () => {
    const rows = whosWhere({ date: D, day })
    expect(row(rows, 'Ben')).toMatchObject({ kind: 'theatre', where: 'Calvary', source: 'bookings' })
    expect(row(rows, 'Mat')).toMatchObject({ kind: 'theatre', where: 'RHH' })
    expect(row(rows, 'Aimee').kind).toBe(null)
  })

  it('puts Erin and Toni in the office unless something says otherwise', () => {
    const rows = whosWhere({ date: D, day })
    expect(row(rows, 'Erin')).toMatchObject({ kind: 'office', source: 'default' })
    expect(row(rows, 'Toni')).toMatchObject({ kind: 'office' })
  })

  it('lets the calendar win: leave says only Leave, training its place', () => {
    const away = [
      { email: 'ben@technomed.com.au', days: [D], why: { [D]: 'Leave' } },
      { email: 'aimee@technomed.com.au', days: [D], why: { [D]: 'Training' } },
      { email: 'toni@technomed.com.au', days: [D], why: { [D]: 'RDO' } }
    ]
    const entries = [{ id: 'a', kind: 'training', email: 'aimee@technomed.com.au', from: D, to: D, allDay: true, where: 'Melbourne', reason: '' }]
    const rows = whosWhere({ date: D, day, away, entries })
    expect(row(rows, 'Ben')).toMatchObject({ kind: 'leave', short: 'LEAVE', where: 'On leave' })
    expect(row(rows, 'Aimee')).toMatchObject({ kind: 'training', where: 'Melbourne', short: 'MELBOURNE' })
    expect(row(rows, 'Toni')).toMatchObject({ kind: 'away', short: 'RDO' })
  })

  it('says why someone is away from the calendar alone (Mat at a conference)', () => {
    const away = [{ email: 'mat@technomed.com.au', days: [D], why: { [D]: 'Away' }, reason: { [D]: 'Conference' } }]
    expect(row(whosWhere({ date: D, day, away }), 'Mat')).toMatchObject({ kind: 'away', where: 'Away · Conference', short: 'CONFERENCE' })
  })

  it('a status somebody added beats the bookings and the default', () => {
    const entries = [{ id: 's1', kind: 'office', email: 'mat@technomed.com.au', from: D, to: D, allDay: true, at: '2026-11-25T01:00:00Z' }]
    expect(row(whosWhere({ date: D, day, entries }), 'Mat')).toMatchObject({ kind: 'office', source: 'added' })
  })

  it('groups for the whole-team page, "no entry" last', () => {
    const groups = groupWhosWhere(whosWhere({ date: D, day }))
    expect(groups.map(g => g.key)).toEqual(['theatre', 'office', 'none'])
    expect(WHO_PEOPLE.length).toBeGreaterThan(4)
  })
})
