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

  it('puts Toni in the office on her days only, and never guesses Erin\'s (Brent, 28 Nov 2026)', () => {
    // Wed 25 Nov: one of Toni's days. Erin's days vary — no default.
    let rows = whosWhere({ date: D, day })
    expect(row(rows, 'Toni')).toMatchObject({ kind: 'office', source: 'default' })
    expect(row(rows, 'Erin').kind).toBe(null)
    // Tue 24 Nov and Fri 27 Nov: not Toni's days.
    for (const date of ['2026-11-24', '2026-11-27']) {
      rows = whosWhere({ date, day: {} })
      expect(row(rows, 'Toni').kind).toBe(null)
      expect(row(rows, 'Erin').kind).toBe(null)
    }
    // A status Erin adds still shows.
    rows = whosWhere({ date: D, day, entries: [{ email: 'erin@technomed.com.au', kind: 'office', from: D, to: D, at: '2026-11-24T00:00:00Z' }] })
    expect(row(rows, 'Erin')).toMatchObject({ kind: 'office' })
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

describe('Not working (Brent, 26 Nov 2026)', () => {
  const entry = { email: 'toni@technomed.com.au', kind: 'notworking', from: D, to: D, allDay: true, at: '2026-11-25T01:00:00Z' }

  it('takes the place of the office default, and of theatre from the bookings', () => {
    const rows = whosWhere({ date: D, day, entries: [entry, { ...entry, email: 'ben@technomed.com.au' }] })
    expect(row(rows, 'Toni')).toMatchObject({ kind: 'notworking', short: 'OFF', where: 'Not working', source: 'added' })
    expect(row(rows, 'Ben')).toMatchObject({ kind: 'notworking' })
  })

  it('is its own group on the whole-team page', () => {
    const groups = groupWhosWhere(whosWhere({ date: D, day, entries: [entry] }))
    expect(groups.find(g => g.key === 'notworking').rows.map(r => r.person.firstName)).toEqual(['Toni'])
  })
})

// Brent, 27 Nov 2026: "a work from home office day option".
describe('working from home', async () => {
  const { noteStatus, WHO_KINDS } = await import('./whosWhere.js')
  const { STATUS_KINDS, awayWords } = await import('./away.js')
  it('is a status anyone can add, kept off the leave calendar', () => {
    const k = STATUS_KINDS.find(s => s.id === 'wfh')
    expect(k.calendar).toBe(false)
    expect(awayWords('', 'wfh')).toBe('Working from home')
    expect(WHO_KINDS.wfh.tag).toBe('WFH')
  })
  it('a calendar note saying WFH sets it', () => {
    expect(noteStatus({ firstName: 'Toni' }, [{ title: 'Toni - WFH' }]).kind).toBe('wfh')
    expect(noteStatus({ firstName: 'Toni' }, [{ title: 'Toni - TM office' }]).kind).toBe('office')
  })
})

// Brent, 27 Nov 2026: "The portal is not saving our locations in the team tabs
// when we change them." The change was saved, but a calendar Training / Away /
// RDO answer always beat it, so the strip kept showing the old one.
describe('a change made in the portal is the answer for that day', () => {
  const training = [{ email: 'aimee@technomed.com.au', days: [D], why: { [D]: 'Training' } }]
  const trainingEntry = { id: 'cal1', kind: 'training', email: 'aimee@technomed.com.au', from: '2026-11-23', to: '2026-11-27', allDay: true, where: 'Melbourne', at: '2026-11-20T01:00:00Z' }
  const theatre = { id: 's9', kind: 'theatre', email: 'aimee@technomed.com.au', from: D, to: D, allDay: true, where: 'RHH', at: '2026-11-27T01:00:00Z' }

  it('Training on the calendar, then changed to Theatre for the day', () => {
    expect(row(whosWhere({ date: D, day, away: training, entries: [trainingEntry, theatre] }), 'Aimee'))
      .toMatchObject({ kind: 'theatre', source: 'added' })
    // The other days of the training stay training.
    const next = '2026-11-26'
    expect(row(whosWhere({ date: next, day: { date: next }, away: [{ ...training[0], days: [next], why: { [next]: 'Training' } }], entries: [trainingEntry, theatre] }), 'Aimee'))
      .toMatchObject({ kind: 'training' })
  })

  it('Training typed straight into Google, then changed in the portal', () => {
    expect(row(whosWhere({ date: D, day, away: training, entries: [theatre] }), 'Aimee'))
      .toMatchObject({ kind: 'theatre' })
  })

  it('Office changed to Working from home: the newer one wins', () => {
    const office = { id: 'o', kind: 'office', email: 'toni@technomed.com.au', from: D, to: D, allDay: true, at: '2026-11-27T01:00:00Z' }
    const wfh = { ...office, id: 'w', kind: 'wfh', at: '2026-11-27T02:00:00Z' }
    expect(row(whosWhere({ date: D, day, entries: [wfh, office] }), 'Toni')).toMatchObject({ kind: 'wfh' })
  })

  it('Training saved in the portal shows at once, before the calendar is read again', () => {
    const saved = { ...trainingEntry, from: D, to: D, at: '2026-11-27T03:00:00Z' }
    expect(row(whosWhere({ date: D, day, entries: [saved] }), 'Aimee')).toMatchObject({ kind: 'training', where: 'Melbourne' })
  })

  it('approved leave from the leave form is never hidden by an older office status', () => {
    const leave = [{ email: 'toni@technomed.com.au', days: [D], why: { [D]: 'Leave' } }]
    const office = { id: 'o', kind: 'office', email: 'toni@technomed.com.au', from: D, to: D, allDay: true, at: '2026-11-27T01:00:00Z' }
    expect(row(whosWhere({ date: D, day, away: leave, entries: [office] }), 'Toni')).toMatchObject({ kind: 'leave' })
  })
})
