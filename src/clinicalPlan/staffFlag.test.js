import { it, expect } from 'vitest'
import { buildWeekPlan } from './buildWeekPlan.js'
import { weekWindowFor } from './week.js'

// Brent, 8 Nov 2026: "Put Ben's appointment this coming Wednesday at the top of
// the page so we see it in the morning."
it('a staff appointment that rules out an early start is flagged at the top of its day', () => {
  const ev = { id: 'a', summary: 'Ben - APPOINTMENT 9am (not available for an early start)', description: '',
    start: { dateTime: '2026-11-11T09:00:00+11:00' }, end: { dateTime: '2026-11-11T10:00:00+11:00' }, source: 'leave' }
  const plan = buildWeekPlan([ev], weekWindowFor('2026-11-09'))
  const wed = plan.days.find(d => d.date === '2026-11-11')
  expect(wed.flags.some(f => /APPOINTMENT/.test(f.text) && f.kind === 'recurringStaffing' && f.boxed)).toBe(true)
  expect(plan.away).toEqual([])
})
