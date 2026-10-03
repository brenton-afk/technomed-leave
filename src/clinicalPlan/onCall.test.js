import { describe, it, expect } from 'vitest'
import {
  whoIsOnCall, weekendHours, onCallHoursFor, totalHours, WEEKEND_HOURS
} from './onCall.js'

// A weekend on call runs 17:00 Friday to 07:00 Monday — 62 hours. Two weekends
// each in turn, Brent then Ben then Mat, and two on six off once Aimee joins
// in January 2027.
//
// The rotation is deliberately not computed. The roster lives in the calendar
// and that is where it gets amended when somebody swaps or falls ill. A cycle
// worked out from a start date would be right until the first swap and then
// confidently wrong for weeks, with nobody checking it because it does not
// look like the sort of thing that needs checking.

describe('whose weekend it is', () => {
  it('reads the name off the entry', () => {
    expect(whoIsOnCall('Brent on call')?.firstName).toBe('Brent')
    expect(whoIsOnCall('Ben on call')?.firstName).toBe('Ben')
    expect(whoIsOnCall('On call - Mat')?.firstName).toBe('Mat')
    expect(whoIsOnCall('on-call: Aimee')?.firstName).toBe('Aimee')
  })

  it('takes the surname too', () => {
    expect(whoIsOnCall('Cassidy on call')?.firstName).toBe('Ben')
  })

  it('takes the names people are also called', () => {
    // Matthew is Mat, and somebody will write Matt.
    expect(whoIsOnCall('Matt on call')?.firstName).toBe('Mat')
  })

  it('is nobody when the entry names nobody', () => {
    // Must not invent a staff member called "On".
    expect(whoIsOnCall('On call')).toBe(null)
    expect(whoIsOnCall('On call roster')).toBe(null)
  })

  it('is nobody when the entry is not about on-call at all', () => {
    expect(whoIsOnCall('Ben annual leave')).toBe(null)
    expect(whoIsOnCall('Call Dubey about Thursday')).toBe(null)
  })
})

describe('what a weekend puts on each day', () => {
  // Friday 2 October 2026 is a Friday.
  const SPREAD = { '2026-10-02': 7, '2026-10-03': 24, '2026-10-04': 24, '2026-10-05': 7 }

  it('runs Friday evening to Monday morning', () => {
    expect(weekendHours('2026-10-02')).toEqual(SPREAD)
  })

  it('comes to 62 hours', () => {
    expect(totalHours(weekendHours('2026-10-02'))).toBe(62)
    expect(WEEKEND_HOURS).toBe(62)
  })

  it('finds the weekend from any day of it', () => {
    // An entry written against the Saturday is the same shift.
    for (const day of ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']) {
      expect(weekendHours(day), day).toEqual(SPREAD)
    }
  })

  it('puts Monday with the weekend behind it', () => {
    // The shift ends at seven that morning, so Monday belongs to the Friday
    // before it and not to the Friday coming.
    expect(weekendHours('2026-10-05')['2026-10-02']).toBe(7)
  })

  it('ends at 07:00 Monday whether or not it is a public holiday', () => {
    // There is no special case, and that is the point — confirmed with Brent.
    expect(weekendHours('2026-10-02')['2026-10-05']).toBe(7)
  })

  it('is nothing for a date that is not one', () => {
    expect(weekendHours('')).toEqual({})
    expect(weekendHours('not a date')).toEqual({})
  })
})

describe('a person\'s on-call hours over a fortnight', () => {
  const FORTNIGHT = Array.from({ length: 14 }, (_, i) => {
    const d = new Date('2026-09-28T00:00:00Z')   // Monday
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString().slice(0, 10)
  })

  it('fills the days of the weekend they were on', () => {
    const hours = onCallHoursFor(
      [{ title: 'Ben on call', date: '2026-10-02' }],
      { email: 'ben@technomed.com.au' }, FORTNIGHT)
    expect(totalHours(hours)).toBe(62)
    expect(hours['2026-10-03']).toBe(24)
  })

  it('leaves out somebody else\'s weekend', () => {
    const hours = onCallHoursFor(
      [{ title: 'Brent on call', date: '2026-10-02' }],
      { email: 'ben@technomed.com.au' }, FORTNIGHT)
    expect(hours).toEqual({})
  })

  it('does not pay one weekend twice when two entries describe it', () => {
    // A Friday entry and a Saturday entry are the same shift.
    const hours = onCallHoursFor([
      { title: 'Ben on call', date: '2026-10-02' },
      { title: 'Ben on call', date: '2026-10-03' }
    ], { email: 'ben@technomed.com.au' }, FORTNIGHT)
    expect(totalHours(hours)).toBe(62)
  })

  it('counts two weekends in a row, which is the roster', () => {
    // 117, not 124. The fortnight ends Sunday 11 October, so the second
    // weekend's Monday morning — seven hours — falls into the next one and is
    // paid there. Two whole weekends would be 124; this is two weekends minus
    // the tail that has not happened yet by the time the timesheet is filed.
    const hours = onCallHoursFor([
      { title: 'Ben on call', date: '2026-10-02' },
      { title: 'Ben on call', date: '2026-10-09' }
    ], { email: 'ben@technomed.com.au' }, FORTNIGHT)
    expect(totalHours(hours)).toBe(117)
    expect(hours['2026-10-11']).toBe(24)
    expect(hours['2026-10-12']).toBeUndefined()
  })

  it('only pays the part of a weekend inside the fortnight', () => {
    // A weekend straddling the boundary is paid in two halves, each in the
    // fortnight it falls in — which is what the calendar dates already say.
    const endsFriday = ['2026-10-02']
    const hours = onCallHoursFor(
      [{ title: 'Ben on call', date: '2026-10-02' }],
      { email: 'ben@technomed.com.au' }, endsFriday)
    expect(hours).toEqual({ '2026-10-02': 7 })
  })

  it('is nothing when nobody was on call', () => {
    expect(onCallHoursFor([], { email: 'ben@technomed.com.au' }, FORTNIGHT)).toEqual({})
    expect(onCallHoursFor(null, { email: 'ben@technomed.com.au' }, FORTNIGHT)).toEqual({})
  })
})
