import { describe, it, expect } from 'vitest'
import {
  resolveDefaultWeek, weekWindowFor, stepWeek, zoneAbbrev, zoneOffsetMs,
  formatWeekRange, formatDayHeading, formatClock, formatTimeRange, mondayOf,
  parseDateStr, addCivilDays, TZ
} from './week.js'

// Midday Hobart on a given August 2026 date. August is AEST (UTC+10), so
// 02:00Z is 12:00 local — safely away from any midnight boundary.
const middayAug = day => new Date(Date.UTC(2026, 7, day, 2, 0))

describe('resolveDefaultWeek', () => {
  // Mon 24 Aug 2026 → Sun 30 Aug 2026.
  const cases = [
    ['Monday', 24, '2026-08-24', '2026-08-30'],
    ['Tuesday', 25, '2026-08-24', '2026-08-30'],
    ['Wednesday', 26, '2026-08-24', '2026-08-30'],
    ['Thursday', 27, '2026-08-24', '2026-08-30'],
    ['Friday', 28, '2026-08-31', '2026-09-06'],
    ['Saturday', 29, '2026-08-31', '2026-09-06'],
    ['Sunday', 30, '2026-08-31', '2026-09-06']
  ]

  it.each(cases)('on %s the default week is %s → %s', (_name, day, start, end) => {
    const w = resolveDefaultWeek(middayAug(day))
    expect(w.startDate).toBe(start)
    expect(w.endDate).toBe(end)
  })

  it('always spans exactly 7 days, Monday to Sunday', () => {
    for (let day = 24; day <= 30; day++) {
      const w = resolveDefaultWeek(middayAug(day))
      expect(w.days).toHaveLength(7)
      expect(formatDayHeading(w.days[0]).startsWith('Monday')).toBe(true)
      expect(formatDayHeading(w.days[6]).startsWith('Sunday')).toBe(true)
    }
  })

  it('flips forward on Friday and stays there until the next Monday', () => {
    const thursday = resolveDefaultWeek(middayAug(27)).startDate
    const friday = resolveDefaultWeek(middayAug(28)).startDate
    const sunday = resolveDefaultWeek(middayAug(30)).startDate
    const nextMonday = resolveDefaultWeek(new Date(Date.UTC(2026, 7, 31, 2, 0))).startDate

    expect(friday).not.toBe(thursday)
    expect(sunday).toBe(friday)
    // Monday's current week is the week Friday had been showing.
    expect(nextMonday).toBe(friday)
  })
})

describe('Hobart daylight saving', () => {
  // Hobart moves on the first Sunday in October (forward) and the first Sunday
  // in April (back). In 2026 those are 4 October and 5 April.
  it('is AEDT before, and AEST from, the April transition', () => {
    expect(zoneAbbrev(new Date('2026-04-04T04:00:00Z'))).toBe('AEDT')
    expect(zoneAbbrev(new Date('2026-04-05T04:00:00Z'))).toBe('AEST')
    expect(zoneOffsetMs(new Date('2026-04-04T04:00:00Z')) / 3600000).toBe(11)
    expect(zoneOffsetMs(new Date('2026-04-05T04:00:00Z')) / 3600000).toBe(10)
  })

  it('is AEST before, and AEDT from, the October transition', () => {
    expect(zoneAbbrev(new Date('2026-10-03T04:00:00Z'))).toBe('AEST')
    expect(zoneAbbrev(new Date('2026-10-04T04:00:00Z'))).toBe('AEDT')
  })

  it('resolves a clean Mon–Sun week across the April transition', () => {
    // The week containing Sun 5 April 2026 starts Mon 30 March.
    const w = weekWindowFor('2026-04-05')
    expect(w.startDate).toBe('2026-03-30')
    expect(w.endDate).toBe('2026-04-05')
    expect(w.days).toHaveLength(7)
    // Both bounds are true local midnight / end-of-day despite the shift.
    expect(w.start.toISOString()).toBe('2026-03-29T13:00:00.000Z') // 00:00 AEDT
    expect(w.end.toISOString()).toBe('2026-04-05T13:59:59.999Z')   // 23:59 AEST
  })

  it('resolves a clean Mon–Sun week across the October transition', () => {
    const w = weekWindowFor('2026-10-04')
    expect(w.startDate).toBe('2026-09-28')
    expect(w.endDate).toBe('2026-10-04')
    expect(w.start.toISOString()).toBe('2026-09-27T14:00:00.000Z') // 00:00 AEST
    expect(w.end.toISOString()).toBe('2026-10-04T12:59:59.999Z')   // 23:59 AEDT
  })

  it('steps weeks by exactly 7 calendar days through a transition', () => {
    // Stepping must not drift by an hour, which naive ms arithmetic would.
    const before = weekWindowFor('2026-03-30')
    const after = stepWeek(before.startDate, 1)
    expect(after.startDate).toBe('2026-04-06')
    expect(after.days).toHaveLength(7)
  })

  it('a default week resolved on the transition day is still Mon–Sun', () => {
    const onTransition = new Date('2026-10-04T02:00:00Z') // Sunday, Hobart
    const w = resolveDefaultWeek(onTransition)
    expect(formatDayHeading(w.days[0]).startsWith('Monday')).toBe(true)
    expect(w.days).toHaveLength(7)
    // Sunday → next week.
    expect(w.startDate).toBe('2026-10-05')
  })
})

describe('week helpers', () => {
  it('finds the Monday of any day', () => {
    expect(mondayOf(parseDateStr('2026-08-30'))).toEqual({ year: 2026, month: 8, day: 24 })
    expect(mondayOf(parseDateStr('2026-08-24'))).toEqual({ year: 2026, month: 8, day: 24 })
  })

  it('steps calendar days without DST drift', () => {
    expect(addCivilDays({ year: 2026, month: 4, day: 4 }, 1)).toEqual({ year: 2026, month: 4, day: 5 })
    expect(addCivilDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({ year: 2027, month: 1, day: 1 })
  })

  it('formats a week range, collapsing a shared month', () => {
    expect(formatWeekRange('2026-08-24', '2026-08-30')).toBe('24 – 30 August 2026')
    expect(formatWeekRange('2026-08-31', '2026-09-06')).toBe('31 August – 6 September 2026')
    expect(formatWeekRange('2026-12-28', '2027-01-03')).toBe('28 December 2026 – 3 January 2027')
  })

  it('formats clock times in 12-hour lowercase', () => {
    expect(formatClock('2026-08-24T10:00:00+10:00')).toBe('10:00am')
    expect(formatClock('2026-08-24T13:30:00+10:00')).toBe('1:30pm')
    expect(formatClock('2026-08-24T00:15:00+10:00')).toBe('12:15am')
    expect(formatClock('2026-08-24T12:00:00+10:00')).toBe('12:00pm')
  })

  it('formats a time range as the document does', () => {
    expect(formatTimeRange('2026-08-24T10:00:00+10:00', '2026-08-24T11:00:00+10:00'))
      .toBe('10:00am–11:00am')
  })

  it('uses Australia/Hobart as the anchor timezone', () => {
    expect(TZ).toBe('Australia/Hobart')
  })
})
