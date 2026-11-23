import { describe, it, expect } from 'vitest'
import { readBooking } from './parse.js'

describe('a booking with no Kit line (Brent, 23 Nov 2026)', () => {
  it('does not read the patient and surgeon in the title as a system', () => {
    const r = readBooking('Surname - Thani (Ben)', 'Surgeon: Thani\nPatient: Surname\nHospital: CLV\nProcedure: Brainlab Stereotactic Needle Biopsy')
    expect(r.supplies).toEqual([])
  })
  it('still reads a system named in the title', () => {
    const r = readBooking('Surname Diplomat - Fowler', 'Surgeon: Fowler\nPatient: Surname\nHospital: RHH\nProcedure: L4/5 PLIF')
    expect(r.supplies.map(s => s.system).join(' ')).toMatch(/Diplomat/i)
  })
})
