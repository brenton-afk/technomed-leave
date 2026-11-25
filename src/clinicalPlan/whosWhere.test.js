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

import { noteStatus } from './whosWhere.js'
describe('a calendar note says where someone is (Brent, 25 Nov 2026)', () => {
  const toni = { firstName: 'Toni' }
  const aimee = { firstName: 'Aimee' }
  it('reads "Toni - TM office" as the office', () => {
    expect(noteStatus(toni, [{ title: 'Toni - TM office' }])).toMatchObject({ kind: 'office', where: 'TechnoMed office' })
  })
  it('reads "Aimee - Brainlab Training MELB" as training', () => {
    expect(noteStatus(aimee, [{ title: 'Aimee - Brainlab Training MELB' }])).toMatchObject({ kind: 'training', where: 'Brainlab Training MELB' })
  })
  it('leaves other people and other notes alone', () => {
    expect(noteStatus(toni, [{ title: 'List Order' }, { title: 'Aimee - office' }])).toBeNull()
  })
})

import { otherItemsWorthListing } from './whosWhere.js'
describe('the Team sheet lists only what who\'s where does not already say', () => {
  it('drops notes about people, leave and the daily List Order call', () => {
    const items = [
      { title: 'Toni - TM office' }, { title: 'Aimee - Brainlab Training MELB' },
      { title: 'List Order', time: '4:00pm–4:30pm' }, { title: 'Ben - ANNUAL LEAVE', kind: 'leave' },
      { title: 'Signus product in-service' }
    ]
    expect(otherItemsWorthListing(items, [{ firstName: 'Toni' }, { firstName: 'Aimee' }]).map(i => i.title)).toEqual(['Signus product in-service'])
  })
})
