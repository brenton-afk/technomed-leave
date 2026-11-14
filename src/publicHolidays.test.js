import { describe, it, expect } from 'vitest'
import { holidaysIn, publicHoliday, easterSunday } from './publicHolidays.js'

describe('Hobart public holidays', () => {
  it('knows Easter', () => {
    expect(easterSunday(2026)).toBe('2026-04-05')
    expect(easterSunday(2027)).toBe('2027-03-28')
  })
  it('2026 as gazetted', () => {
    expect(Object.keys(holidaysIn(2026)).sort()).toEqual([
      '2026-01-01', '2026-01-26', '2026-02-09', '2026-03-09', '2026-04-03', '2026-04-06',
      '2026-04-25', '2026-06-08', '2026-10-22', '2026-12-25', '2026-12-28'
    ])
  })
  it('moves Christmas off a weekend (2027: Sat and Sun)', () => {
    expect(publicHoliday('2027-12-27')).toBe('Christmas Day')
    expect(publicHoliday('2027-12-28')).toBe('Boxing Day')
    expect(publicHoliday('2027-12-25')).toBe('')
  })
  it('a plain day is not a holiday', () => {
    expect(publicHoliday('2026-11-17')).toBe('')
  })
})

import { weekendHours } from './clinicalPlan/onCall.js'

describe('on call over public holidays (Brent, 14 Nov 2026)', () => {
  it('an ordinary weekend is still 62 hours', () => {
    expect(weekendHours('2026-11-13')).toEqual({ '2026-11-13': 7, '2026-11-14': 24, '2026-11-15': 24, '2026-11-16': 7 })
  })
  it('a long weekend runs to 07:00 Tuesday', () => {
    // King's Birthday, Mon 8 Jun 2026
    expect(weekendHours('2026-06-05')).toEqual({ '2026-06-05': 7, '2026-06-06': 24, '2026-06-07': 24, '2026-06-08': 24, '2026-06-09': 7 })
  })
  it('Easter is Thursday evening to Tuesday morning, from any day of it', () => {
    const easter = { '2026-04-02': 7, '2026-04-03': 24, '2026-04-04': 24, '2026-04-05': 24, '2026-04-06': 24, '2026-04-07': 7 }
    expect(weekendHours('2026-04-03')).toEqual(easter)
    expect(weekendHours('2026-04-02')).toEqual(easter)
    expect(weekendHours('2026-04-07')).toEqual(easter)
  })
  it('a midweek holiday is the evening before to the morning after', () => {
    // Show Day, Thu 22 Oct 2026
    expect(weekendHours('2026-10-22')).toEqual({ '2026-10-21': 7, '2026-10-22': 24, '2026-10-23': 7 })
  })
})
