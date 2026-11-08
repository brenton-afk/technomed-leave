import { describe, it, expect } from 'vitest'
import { etbsFrom, isRhh } from './etbs.js'
import { readBooking } from './parse.js'
import { setLabelledValue, removeLabelledLine, parseLabelledDescription } from './labelledFields.js'

// Brent, 8 Nov 2026: ETBS is extra information on an RHH case, shown on the
// card like the list place — not a navigation choice.
describe('ETBS on a booking', () => {
  const base = 'Surgeon: Fowler\nPatient: Testcase\nProcedure: C5/6 ACDF\nKit: Dakota (Consignment)\nHospital: RHH'

  it('is written as "ETBS: Yes", read back, and taken off', () => {
    const on = setLabelledValue(base, 'etbs', 'Yes')
    expect(on).toMatch(/\nETBS: Yes$/)
    expect(readBooking('Testcase ACDF - Fowler', on).etbs).toBe(true)
    const off = removeLabelledLine(on, 'etbs')
    expect(off).toBe(base)
    expect(readBooking('Testcase ACDF - Fowler', off).etbs).toBeUndefined()
  })
  it('is never shown back as a note', () => {
    const r = readBooking('Testcase ACDF - Fowler', setLabelledValue(base, 'etbs', 'Yes'))
    expect((r.notes || []).map(n => n.text || n).join(' ')).not.toMatch(/ETBS/)
    expect(parseLabelledDescription(setLabelledValue(base, 'etbs', 'Yes')).kit).toBe('Dakota (Consignment)')
  })
  it('reads yes in the ways it gets typed, and RHH by either name', () => {
    expect(etbsFrom('Yes')).toBe(true)
    expect(etbsFrom('y')).toBe(true)
    expect(etbsFrom('')).toBe(false)
    expect(etbsFrom('No')).toBe(false)
    expect(isRhh('Royal Hobart Hospital')).toBe(true)
    expect(isRhh('Calvary Lenah Valley')).toBe(false)
  })
})
