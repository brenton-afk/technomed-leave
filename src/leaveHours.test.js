import { describe, it, expect } from 'vitest'
import { leaveDays, totalHours, hoursByPayPeriod, cleanLeaveHours } from './leaveHours.js'
import { workPatternFor } from './staffConfig.js'

// ─── Task 14: leave in hours for part-time staff ────────────────────────────

const TONI = workPatternFor('toni@technomed.com.au')
const ERIN = workPatternFor('erin@technomed.com.au')

describe('Toni, Mon/Wed/Thu at 5.5', () => {
  it('Mon to Fri charges only her three working days', () => {
    const days = leaveDays('2026-11-02', '2026-11-06', TONI)
    expect(days.map(d => d.date)).toEqual(['2026-11-02', '2026-11-04', '2026-11-05'])
    expect(totalHours(days)).toBe(16.5)
  })

  it('Tue 27 Oct to Mon 2 Nov: 11h in the fortnight ending 1 Nov, 5.5h in the one ending 15 Nov', () => {
    const periods = hoursByPayPeriod(leaveDays('2026-10-27', '2026-11-02', TONI))
    expect(periods).toEqual([
      { start: '2026-10-19', end: '2026-11-01', hours: 11 },
      { start: '2026-11-02', end: '2026-11-15', hours: 5.5 }
    ])
  })

  it('a part day is one number changed', () => {
    const days = leaveDays('2026-11-04', '2026-11-04', TONI).map(d => ({ ...d, hours: 2.75 }))
    expect(totalHours(days)).toBe(2.75)
  })
})

describe('Erin, 24 hours a week on days that change', () => {
  it('offers every weekday at nothing for her to fill in', () => {
    const days = leaveDays('2026-11-02', '2026-11-08', ERIN)
    expect(days).toHaveLength(5)
    expect(totalHours(days)).toBe(0)
  })
})

describe('what the server accepts', () => {
  const range = { startDate: '2026-11-02', endDate: '2026-11-06' }
  it('keeps the days with hours, in order', () => {
    expect(cleanLeaveHours([{ date: '2026-11-04', hours: 5.5 }, { date: '2026-11-02', hours: '5.5' }, { date: '2026-11-03', hours: 0 }], range))
      .toEqual([{ date: '2026-11-02', hours: 5.5 }, { date: '2026-11-04', hours: 5.5 }])
  })
  it('refuses a day outside the leave, too many hours, or nothing at all', () => {
    expect(() => cleanLeaveHours([{ date: '2026-11-09', hours: 5 }], range)).toThrow(/outside/)
    expect(() => cleanLeaveHours([{ date: '2026-11-02', hours: 13 }], range)).toThrow(/between 0 and 12/)
    expect(() => cleanLeaveHours([{ date: '2026-11-02', hours: 0 }], range)).toThrow(/at least one day/)
  })
})
