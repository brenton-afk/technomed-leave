import { describe, it, expect } from 'vitest'
import { periodDeadline, isPeriodClosed, periodDue, NOON_MONDAY_FROM } from './_fortnight.js'
import { dueWords } from '../src/pages/PromptBanner.jsx'

// ─── Timesheets due Monday 12pm from the changeover (Erin, 19 Nov 2026) ─────
// "The 29 November pay run goes ahead as normal" — 16–29 Nov keeps Sunday.
// Hobart times written as UTC: AEDT is UTC+11.
const at = (hobart) => Date.parse(hobart + '+11:00')

describe('the deadline', () => {
  it('keeps Sunday for 16–29 Nov and moves to Monday noon from 30 Nov', () => {
    expect(NOON_MONDAY_FROM).toBe('2026-11-30')
    expect(periodDeadline('2026-11-16')).toMatchObject({ date: '2026-11-29', words: 'Sunday', noon: false })
    expect(periodDeadline('2026-11-30')).toMatchObject({ date: '2026-12-14', hour: 12, words: 'Monday 12pm', noon: true })
  })

  it('closes at the end of Sunday before, at noon Monday after', () => {
    expect(isPeriodClosed('2026-11-16', at('2026-11-29T23:30:00'))).toBe(false)
    expect(isPeriodClosed('2026-11-16', at('2026-11-30T00:10:00'))).toBe(true)
    expect(isPeriodClosed('2026-11-30', at('2026-12-14T11:59:00'))).toBe(false)
    expect(isPeriodClosed('2026-11-30', at('2026-12-14T12:00:00'))).toBe(true)
  })

  it('on the Monday morning, the timesheet owed is the fortnight just ended', () => {
    expect(periodDue(at('2026-12-14T09:00:00')).start).toBe('2026-11-30')
    expect(periodDue(at('2026-12-14T13:00:00')).start).toBe('2026-12-14')
    // The old Sunday deadline: Monday already belongs to the new fortnight.
    expect(periodDue(at('2026-11-30T09:00:00')).start).toBe('2026-11-30')
  })

  it('says when it is due', () => {
    expect(dueWords('2026-11-16', at('2026-11-23T11:00:00'))).toBe('Timesheet due Sunday')
    expect(dueWords('2026-11-16', at('2026-11-29T11:00:00'))).toBe('Timesheet due today')
    expect(dueWords('2026-11-30', at('2026-12-03T11:00:00'))).toBe('Timesheet due Monday 12pm')
    expect(dueWords('2026-11-30', at('2026-12-14T08:00:00'))).toBe('Timesheet due today by 12pm')
  })
})
