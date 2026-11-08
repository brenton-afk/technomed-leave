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

// Calendar audit, 8 Nov 2026: a dinner in a surgeon's colour read as a case.
it('a Christmas dinner, a party or a renewal reminder is never a case, and never "needs attention"', async () => {
  const { readBooking, isNotACase } = await import('./parse.js')
  expect(readBooking('TechnoMed Christmas Dinner', '', { colourSurgeon: 'Gupta' })).toBe(null)
  expect(isNotACase('Perioperative Christmas Party — Hobart Workers Club', '')).toBe(true)
  expect(isNotACase('REMINDER - MONDAY.COM renewal is 10 December 2026', '')).toBe(true)
  // A real booking with labelled fields stays a booking, whatever its title.
  expect(isNotACase('Christmas DIPLOMAT - Fowler', 'Surgeon: Fowler\nPatient: Christmas')).toBe(false)
  expect(readBooking('Nettlefold REFORM - Fowler', 'Surgeon: Fowler\nPatient: Nettlefold')?.patient).toBe('Nettlefold')
  const plan = buildWeekPlan([
    { id: 'd', summary: 'TechnoMed Christmas Dinner', description: '', colorId: '3', start: { dateTime: '2026-12-19T18:00:00+11:00' }, end: { dateTime: '2026-12-19T22:00:00+11:00' }, source: 'bookings' },
    { id: 'p', summary: 'Perioperative Christmas Party — Hobart Workers Club', description: '', start: { dateTime: '2026-11-21T18:00:00+11:00' }, end: { dateTime: '2026-11-21T22:00:00+11:00' }, source: 'bookings' }
  ], weekWindowFor('2026-11-16'))
  expect(plan.days.flatMap(d => d.needsAttention)).toEqual([])
  const plan2 = buildWeekPlan([{ id: 'd', summary: 'TechnoMed Christmas Dinner', description: '', colorId: '3', start: { dateTime: '2026-12-19T18:00:00+11:00' }, end: { dateTime: '2026-12-19T22:00:00+11:00' }, source: 'bookings' }], weekWindowFor('2026-12-14'))
  expect(plan2.days.flatMap(d => (d.casesByHospital || []).flatMap(g => g.cases))).toEqual([])
})
