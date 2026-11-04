import { describe, it, expect } from 'vitest'
import { casesUsingKit, caseLabel, placeOfCase, taskDescription, readTask, taskSummary } from './tasks.js'

// Toni, 4 Nov 2026: a "Move a kit" task offers the upcoming cases that use the
// kit, and can be attached to one. Invented cases.
const days = [
  { date: '2026-11-09', casesByHospital: [{ hospital: 'RHH', cases: [
    { id: 'a1', patient: 'Testa', surgeon: 'Fowler', hospital: 'RHH', kit: 'Mariner MIS', start: '08:00' }] }] },
  { date: '2026-11-11', casesByHospital: [{ hospital: 'CLV', cases: [
    { id: 'b2', patient: 'Sample', surgeon: 'Gupta', hospital: 'CLV', kit: 'Mariner Open (Distributor Loan)', start: '08:00' },
    { id: 'c3', patient: 'Other', surgeon: 'Thani', hospital: 'CLV', kit: 'Diplomat', start: '09:00' },
    { id: 'd4', patient: 'Gone', surgeon: 'Gupta', hospital: 'CLV', kit: 'Mariner', cancelled: true }] }] }
]

describe('a kit move, for the case it is for', () => {
  it('offers the cases using that kit, from the day on, soonest first, none cancelled', () => {
    expect(casesUsingKit(days, 'Mariner', '2026-11-04').map(c => c.id)).toEqual(['a1', 'b2'])
    expect(casesUsingKit(days, 'Mariner', '2026-11-10').map(c => c.id)).toEqual(['b2'])
    expect(casesUsingKit(days, 'Diplomat', '').map(c => c.id)).toEqual(['c3'])
    expect(casesUsingKit(days, 'Disposables', '')).toEqual([])
  })

  it('names the case without the patient, and knows where it is', () => {
    const [, c] = casesUsingKit(days, 'Mariner', '')
    expect(caseLabel(c)).toBe('Gupta · Calvary · Wed 11 Nov')
    expect(placeOfCase(c)).toBe('Calvary')
  })

  it('writes the case onto the task and reads it back', () => {
    const task = { kind: 'move', thing: 'Mariner', from: 'RHH', to: 'Calvary', forCase: 'Gupta · Calvary · Wed 11 Nov' }
    const back = readTask(taskSummary(task), taskDescription(task))
    expect(back.forCase).toBe('Gupta · Calvary · Wed 11 Nov')
    expect(taskDescription(task)).not.toMatch(/Sample/)
  })
})
