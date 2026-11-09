import { describe, it, expect } from 'vitest'
import { inSituReason } from './priorImplants.js'
import { buildWeekPlan } from './buildWeekPlan.js'

// Brent, 9 Nov 2026: "when you see the word extension or connection to
// existing construct in the booking you need to flag this so that the team
// leader searches for the previous booking in Dropbox and identifies what is
// in situ." Invented patients.
describe('what is in situ', () => {
  it('is asked for an extension, a connection to an existing construct, a revision or a removal', () => {
    expect(inSituReason('L3/4 extension of fusion')).toBe('extension')
    expect(inSituReason('T10-L2 PSF, connection to existing construct')).toBe('connection to existing construct')
    expect(inSituReason('Extending the fusion to L2')).toBe('extension')
    expect(inSituReason('Revision L4/5 PLIF')).toBe('revision')
    expect(inSituReason('R/O C5/6 ACDF plate')).toBe('removal')
    expect(inSituReason('Remove existing hardware')).toBe('existing construct')
  })
  it('is not asked for an ordinary case, or a note about a previous day', () => {
    expect(inSituReason('L4/5 PLIF')).toBeNull()
    expect(inSituReason('C5/6 ACDF — moved from the previous Tuesday')).toBeNull()
    expect(inSituReason('Prior to theatre: consent')).toBeNull()
  })

  const DAYS = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']
  const ev = (id, summary, description) => ({
    id, summary, description, location: 'RHH',
    start: { dateTime: '2026-11-17T08:00:00+11:00' }, end: { dateTime: '2026-11-17T12:00:00+11:00' }
  })

  it('flags the day for the team leader and marks the case', () => {
    const plan = buildWeekPlan([
      ev('a', 'Testcase MARINER - Fowler', 'Surgeon: Fowler\nPatient: Testcase\nHospital: RHH\nProcedure: T10-L2 PSF, connection to existing construct\nKit: Mariner (Consignment)'),
      ev('b', 'Plaincase DAKOTA - Fowler', 'Surgeon: Fowler\nPatient: Plaincase\nHospital: RHH\nProcedure: C5/6 ACDF\nKit: Dakota (Consignment)')
    ], { startDate: DAYS[0], endDate: DAYS[6], days: DAYS })
    const day = plan.days.find(d => d.date === '2026-11-17')
    const flag = day.flags.find(f => f.kind === 'inSitu')
    expect(flag.text).toMatch(/Testcase · Fowler \(connection to existing construct\).*team leader.*Dropbox/)
    expect(day.flags.filter(f => f.kind === 'inSitu')).toHaveLength(1)
    const cases = day.casesByHospital.flatMap(g => g.cases)
    expect(cases.find(c => c.patient === 'Testcase').inSitu).toBe('connection to existing construct')
    expect(cases.find(c => c.patient === 'Plaincase').inSitu).toBeUndefined()
  })

  it('a cancelled case is not flagged', () => {
    const plan = buildWeekPlan([
      ev('a', 'CANCELLED Testcase MARINER - Fowler', 'Surgeon: Fowler\nPatient: Testcase\nProcedure: L3/4 extension of fusion')
    ], { startDate: DAYS[0], endDate: DAYS[6], days: DAYS })
    expect(plan.days.find(d => d.date === '2026-11-17').flags.some(f => f.kind === 'inSitu')).toBe(false)
  })
})
