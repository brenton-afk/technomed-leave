import { describe, it, expect } from 'vitest'
import { readBooking } from './parse.js'
import { parseRepNames } from '../staffConfig.js'
import { onlyMine } from '../pages/CaseWeek.jsx'

// ─── Task 10: planned reps, several to a case ────────────────────────────────

describe('the Planned rep line', () => {
  const description = 'Surg - Ibbett\nPt - Testa\nProcedure - ACDF\nKit - Dakota\nPlanned rep: Ben / Aimee'
  it('reads two reps going together', () => {
    expect(readBooking('Testa DAKOTA - Ibbett', description).planned).toEqual(['Ben', 'Aimee'])
  })
  it('is kept apart from who actually went', () => {
    const read = readBooking('Testa DAKOTA - Ibbett (Mat)', description)
    expect(read.reps).toEqual(['Mat'])
    expect(read.planned).toEqual(['Ben', 'Aimee'])
  })
  it('is not shown again as a note', () => {
    expect(readBooking('Testa DAKOTA - Ibbett', description).notes.join(' ')).not.toMatch(/Planned/)
  })
  it('is not set off by "as planned" in prose', () => {
    expect(readBooking('Testa DAKOTA - Ibbett', 'Pt - Testa\nKit - Dakota, as planned - confirmed').planned).toEqual([])
  })
})

describe('names', () => {
  it('takes the ways the team writes them, roster names only', () => {
    expect(parseRepNames('ben and Aimee')).toEqual(['Ben', 'Aimee'])
    expect(parseRepNames('Matthew, Brent')).toEqual(['Mat', 'Brent'])
    expect(parseRepNames('RHH / Ben')).toEqual(['Ben'])
  })
})

describe('My cases', () => {
  const plan = { days: [{ date: '2026-11-04', casesByHospital: [
    { hospital: 'RHH', cases: [{ id: 'a', planned: ['Ben', 'Aimee'] }, { id: 'b', planned: ['Mat'] }] },
    { hospital: 'CLV', cases: [{ id: 'c', rep: 'Aimee/Mat' }] }
  ] }] }
  it('each of two allocated reps sees the case', () => {
    expect(onlyMine(plan, 'Ben').days[0].casesByHospital.flatMap(g => g.cases.map(c => c.id))).toEqual(['a'])
    expect(onlyMine(plan, 'Aimee').days[0].casesByHospital.flatMap(g => g.cases.map(c => c.id))).toEqual(['a', 'c'])
  })
  it('drops a hospital with none of theirs', () => {
    expect(onlyMine(plan, 'Ben').days[0].casesByHospital.map(g => g.hospital)).toEqual(['RHH'])
  })
})
