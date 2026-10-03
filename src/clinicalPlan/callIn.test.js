import { describe, it, expect } from 'vitest'
import {
  extraDoubleTime, isAttendableCase, isOutOfHours, callInsFor, COVERED_HOURS
} from './callIn.js'

const ev = (id, summary, description, startsAt, location = 'RHH') => ({
  id, summary, description, location, start: { dateTime: startsAt }
})

describe('what the allowance covers, and what it does not', () => {
  // The flat allowance covers the first five hours. Past that, every hour or
  // part thereof is double the ordinary rate.
  it('is nothing for a call-in inside five hours', () => {
    expect(extraDoubleTime(2)).toBe(0)
    expect(extraDoubleTime(5)).toBe(0)
  })

  it('counts a part hour as a whole one', () => {
    // Somebody dragged out of bed at two in the morning is not being asked to
    // account for the twenty minutes.
    expect(extraDoubleTime(5.25)).toBe(1)
    expect(extraDoubleTime(6)).toBe(1)
    expect(extraDoubleTime(6.1)).toBe(2)
    expect(extraDoubleTime(8)).toBe(3)
  })

  it('covers five hours, which is the rule', () => {
    expect(COVERED_HOURS).toBe(5)
  })

  it('is nothing for a figure that is not one', () => {
    expect(extraDoubleTime(null)).toBe(0)
    expect(extraDoubleTime('ages')).toBe(0)
    expect(extraDoubleTime(-2)).toBe(0)
  })
})

describe('what counts as a case somebody could be called in to', () => {
  it('takes a real booking', () => {
    expect(isAttendableCase(ev('a', 'Hays DAKOTA - Ibbett',
      'Surg: Ibbett\nPt: Hays', '2026-10-10T20:00:00+11:00'))).toBe(true)
  })

  it('leaves out the list order reminder', () => {
    // The loudest example. It is a standing reminder for the team leader to
    // ring the hospitals, it sits on the calendar every weekday, and nobody
    // has ever been called in to one.
    expect(isAttendableCase(ev('b', 'List Order', '', '2026-10-08T16:30:00+11:00'))).toBe(false)
    expect(isAttendableCase(ev('b', 'Daily list order call', '', '2026-10-08T16:30:00+11:00'))).toBe(false)
  })

  it('leaves out the other things on the calendar', () => {
    for (const title of ['Team meeting', 'Ben annual leave', 'Spine logistics', 'Handover']) {
      expect(isAttendableCase(ev('c', title, '', '2026-10-10T20:00:00+11:00')), title).toBe(false)
    }
  })

  it('leaves out an all-day entry', () => {
    expect(isAttendableCase({ id: 'd', summary: 'Hays DAKOTA - Ibbett', start: { date: '2026-10-10' } }))
      .toBe(false)
  })
})

describe('when a case is worth asking about', () => {
  it('is out of hours in the evening', () => {
    expect(isOutOfHours(ev('a', 'x', '', '2026-10-08T20:00:00+11:00'))).toBe(true)
  })

  it('is out of hours early in the morning', () => {
    expect(isOutOfHours(ev('a', 'x', '', '2026-10-08T05:00:00+11:00'))).toBe(true)
  })

  it('is any time at the weekend', () => {
    expect(isOutOfHours(ev('a', 'x', '', '2026-10-10T10:00:00+11:00'))).toBe(true)
  })

  it('is not an ordinary weekday case', () => {
    expect(isOutOfHours(ev('a', 'x', '', '2026-10-08T09:00:00+11:00'))).toBe(false)
  })
})

describe('whose call-in it is', () => {
  const BEN = { email: 'ben@technomed.com.au', firstName: 'Ben' }
  const AIMEE = { email: 'aimee@technomed.com.au', firstName: 'Aimee' }
  const DAYS = ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']
  const SATURDAY_CASE = ev('c1', 'Hays DAKOTA - Ibbett (Ben)',
    'Surg: Ibbett\nPt: Hays', '2026-10-10T20:00:00+11:00')
  const ON_CALL = [{ title: 'Ben on call', date: '2026-10-09' }]

  it('offers it to the rep who is recorded as having attended', () => {
    const found = callInsFor([SATURDAY_CASE], BEN, DAYS, { onCallEntries: ON_CALL })
    expect(found).toHaveLength(1)
    expect(found[0].reason).toBe('you are down as the rep')
  })

  it('does not offer somebody else\'s case to a colleague', () => {
    // Four people deciding whether it was them, and at least three wrong.
    expect(callInsFor([SATURDAY_CASE], AIMEE, DAYS, { onCallEntries: ON_CALL })).toEqual([])
  })

  it('offers an unattributed case to whoever was on call', () => {
    const noRep = ev('c2', 'Hays DAKOTA - Ibbett', 'Surg: Ibbett\nPt: Hays',
      '2026-10-10T20:00:00+11:00')
    const found = callInsFor([noRep], BEN, DAYS, { onCallEntries: ON_CALL })
    expect(found).toHaveLength(1)
    expect(found[0].reason).toBe('your on-call weekend')
  })

  it('does not offer an unattributed case to somebody not on call', () => {
    const noRep = ev('c2', 'Hays DAKOTA - Ibbett', 'Surg: Ibbett\nPt: Hays',
      '2026-10-10T20:00:00+11:00')
    expect(callInsFor([noRep], AIMEE, DAYS, { onCallEntries: ON_CALL })).toEqual([])
  })

  it('never offers the list order reminder to anybody', () => {
    const listOrder = ev('c3', 'List Order', '', '2026-10-10T16:30:00+11:00')
    expect(callInsFor([listOrder], BEN, DAYS, { onCallEntries: ON_CALL })).toEqual([])
  })

  it('leaves out a case outside the pay period', () => {
    const later = ev('c4', 'Hays DAKOTA - Ibbett (Ben)', 'Surg: Ibbett\nPt: Hays',
      '2026-10-24T20:00:00+11:00')
    expect(callInsFor([later], BEN, DAYS, { onCallEntries: ON_CALL })).toEqual([])
  })

  it('leaves out an ordinary weekday case the rep attended', () => {
    // Being the rep on a Tuesday morning is the job, not a call-in.
    const weekday = ev('c5', 'Hays DAKOTA - Ibbett (Ben)', 'Surg: Ibbett\nPt: Hays',
      '2026-10-09T09:00:00+11:00')
    expect(callInsFor([weekday], BEN, DAYS, { onCallEntries: ON_CALL })).toEqual([])
  })
})
