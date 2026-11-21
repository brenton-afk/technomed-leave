import { describe, it, expect } from 'vitest'
import { kitWithDaySupplies } from './kitSupply.js'

// Brent, 16 Nov 2026: "choose the system and confirm it in the booking when
// added, rather than having consignment? in the field … You know what systems
// exist at each hospital, so you need to start booking accordingly."
describe('a new booking says where its kit comes from', () => {
  it('the first Mariner at RHH is its consignment set', () => {
    expect(kitWithDaySupplies({ kit: 'Mariner MIS / BRAINLAB AIRO & CURVE', hospital: 'RHH' }))
      .toBe('Mariner MIS (Consignment) / BRAINLAB AIRO & CURVE')
  })
  it('a second Mariner at RHH that day is not the same shelf set', () => {
    const sameDay = [{ hospital: 'RHH', supplies: [{ system: 'Mariner', supply: 'Consignment' }] }]
    // An MIS can borrow Calvary's MIS set; an Open has to be requested.
    expect(kitWithDaySupplies({ kit: 'Mariner MIS', hospital: 'RHH', sameDay })).toBe('Mariner MIS (Calvary Loan)')
    expect(kitWithDaySupplies({ kit: 'Mariner Open', hospital: 'RHH', sameDay })).toBe('Mariner Open (Distributor Loan)')
  })
  it('a case already on loan takes no shelf set', () => {
    const sameDay = [{ hospital: 'RHH', supplies: [{ system: 'Mariner', supply: 'Distributor Loan' }] }]
    expect(kitWithDaySupplies({ kit: 'Mariner MIS', hospital: 'RHH', sameDay })).toBe('Mariner MIS (Consignment)')
  })
  it('a cancelled case or one at the other hospital does not count', () => {
    const sameDay = [{ hospital: 'RHH', cancelled: true, supplies: [{ system: 'Mariner' }] }, { hospital: 'CLV', supplies: [{ system: 'Mariner' }] }]
    expect(kitWithDaySupplies({ kit: 'Mariner', hospital: 'RHH', sameDay })).toBe('Mariner (Consignment)')
  })
  it('the second Dakota at Calvary is the TM loan kit', () => {
    const sameDay = [{ hospital: 'CLV', kit: 'Dakota' }]
    expect(kitWithDaySupplies({ kit: 'Dakota', hospital: 'Calvary', sameDay })).toBe('Dakota (TM Loan)')
  })
  it('never changes a supply somebody wrote, nor an unknown system', () => {
    expect(kitWithDaySupplies({ kit: 'Mariner (DT Loan)', hospital: 'RHH' })).toBe('Mariner (DT Loan)')
    expect(kitWithDaySupplies({ kit: 'Something new', hospital: 'RHH' })).toBe('Something new')
    expect(kitWithDaySupplies({ kit: 'Mariner', hospital: '' })).toBe('Mariner')
  })
  it('a Mariner MIS at Calvary is its consignment set; an Open is a loan', () => {
    expect(kitWithDaySupplies({ kit: 'Mariner MIS', hospital: 'CLV' })).toMatch(/\(Consignment\)$/)
    expect(kitWithDaySupplies({ kit: 'Mariner Open', hospital: 'CLV' })).toBe('Mariner Open') // left for a person: RHH's tray or a loan
  })
})
