import { describe, it, expect } from 'vitest'
import { dispatchDay, tmLoanDispatches, alreadyTasked, dispatchTask } from './dispatch.js'

// Brent, 5 Nov 2026: two Dakota cases at Calvary on Tue 24 Nov — the second
// takes the TM loan kit, which has to be sent no later than Fri 20 Nov.
const dakota = (id, start, supply) => ({
  id, date: '2026-11-24', start, hospital: 'CLV', surgeon: 'Ibbett', patient: 'Testa',
  supplies: [{ system: 'Dakota', ...(supply ? { supply } : {}) }]
})

describe('when a TM loan kit has to go out', () => {
  it('is at least 48 hours ahead, on a weekday', () => {
    expect(dispatchDay('2026-11-24')).toBe('2026-11-20') // Tue → Fri
    expect(dispatchDay('2026-11-23')).toBe('2026-11-20') // Mon → Fri
    expect(dispatchDay('2026-11-25')).toBe('2026-11-23') // Wed → Mon
    expect(dispatchDay('2026-11-27')).toBe('2026-11-25') // Fri → Wed
  })

  it('finds the second Dakota at Calvary, suggested TM Loan, and sends it Friday', () => {
    const out = tmLoanDispatches([dakota('a', '2026-11-24T08:00'), dakota('b', '2026-11-24T13:00')])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ caseId: 'b', system: 'Dakota', to: 'Calvary', date: '2026-11-20', caseDate: '2026-11-24' })
    expect(out[0].forCase).toBe('Ibbett · Calvary · Tue 24 Nov')
  })

  it('reads the hospital by its full name too, as the week plan carries it', () => {
    const full = c => ({ ...c, hospital: 'CALVARY LENAH VALLEY' })
    const out = tmLoanDispatches([full(dakota('a', '2026-11-24T08:00')), full(dakota('b', '2026-11-24T13:00'))])
    expect(out.map(d => [d.caseId, d.to])).toEqual([['b', 'Calvary']])
  })

  it('also follows a TM Loan written on the booking', () => {
    const out = tmLoanDispatches([dakota('a', '2026-11-24T08:00', 'TM Loan')])
    expect(out.map(d => d.caseId)).toEqual(['a'])
  })

  it('asks nothing for one Dakota, or a cancelled second', () => {
    expect(tmLoanDispatches([dakota('a', '2026-11-24T08:00')])).toEqual([])
    expect(tmLoanDispatches([dakota('a', '2026-11-24T08:00'), { ...dakota('b', '2026-11-24T13:00'), cancelled: true }])).toEqual([])
  })

  it('steps aside once a real Move a kit task covers it', () => {
    const [d] = tmLoanDispatches([dakota('a', '2026-11-24T08:00'), dakota('b', '2026-11-24T13:00')])
    expect(alreadyTasked(d, [{ kind: 'move', thing: 'Dakota', to: 'Calvary', date: '2026-11-20' }])).toBe(true)
    expect(alreadyTasked(d, [{ kind: 'move', thing: 'Dakota', to: 'RHH', date: '2026-11-20' }])).toBe(false)
    expect(dispatchTask(d)).toMatchObject({ suggested: true, kind: 'move', thing: 'Dakota', to: 'Calvary', what: 'Send the Dakota TM loan kit to Calvary' })
  })
})

// Through the real week builder: the week of 16 Nov 2026 sees the Tuesday 24
// cases ahead of it and puts the dispatch on Friday 20.
describe('the dispatch on the week', async () => {
  const { buildWeekPlan } = await import('./buildWeekPlan.js')
  const { weekWindowFor } = await import('./week.js')
  const week = weekWindowFor('2026-11-16')
  const booking = (id, hour) => ({
    id, summary: `Testa${id} DAKOTA - Ibbett`, location: 'Calvary', description: 'Kit: Dakota\nHospital: CLV',
    start: { dateTime: `2026-11-24T${hour}:00:00+11:00` }, end: { dateTime: `2026-11-24T${hour}:59:00+11:00` }
  })

  it('shows on Friday 20 for the second Dakota on Tuesday 24', () => {
    const plan = buildWeekPlan([booking('a', '08'), booking('b', '13')], week)
    const friday = plan.days.find(d => d.date === '2026-11-20')
    const sent = (friday.tasks || []).filter(t => t.suggested)
    expect(sent).toHaveLength(1)
    expect(sent[0].what).toBe('Send the Dakota TM loan kit to Calvary')
    expect(sent[0].forCase).toBe('Ibbett · Calvary · Tue 24 Nov')
  })

  it('steps aside for a real Move a kit task', () => {
    const task = {
      id: 't1', summary: 'TASK: Move Dakota from TM Office to Calvary',
      description: 'Task: Move a kit\nItem: Dakota\nFrom: TM Office\nTo: Calvary\nFor: Anyone',
      start: { date: '2026-11-19' }, end: { date: '2026-11-20' }
    }
    const plan = buildWeekPlan([booking('a', '08'), booking('b', '13'), task], week)
    expect(plan.days.flatMap(d => d.tasks || []).filter(t => t.suggested)).toEqual([])
  })
})
