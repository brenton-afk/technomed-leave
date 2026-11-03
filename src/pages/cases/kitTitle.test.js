import { describe, it, expect } from 'vitest'
import { kitTitle, staleTitle } from './EditBooking.jsx'

// "Issue with portal not changing/updating the KIT/system in the TITLE / event
// heading in the google calendar" — Toni, 3 Nov 2026, on the Diplomat to
// Mariner cases. Titles as the team writes them; invented patients.

describe('the kit in the title follows the kit field', () => {
  it('swaps the system the way the team writes it', () => {
    expect(kitTitle('Testa DIPLOMAT - Dubey', 'Diplomat (Consignment)', 'Mariner MIS (TM Loan)').proposed)
      .toBe('Testa MARINER MIS - Dubey')
  })

  it('swaps one system on a line of several and leaves the rest as typed', () => {
    expect(kitTitle('Testa DIPLOMAT / E4 GLOBAL BMD PLIF CAGE / SPINAL - Thani (Mat)',
      'Diplomat (Consignment) / E4 Global BMD PLIF cage (Consignment)',
      'Mariner MIS (Distributor Loan) / E4 Global BMD PLIF cage (Consignment)').proposed)
      .toBe('Testa MARINER MIS / E4 GLOBAL BMD PLIF CAGE / SPINAL - Thani (Mat)')
  })

  it('takes a system off cleanly', () => {
    expect(kitTitle('Testa DIPLOMAT + E4 BMD - Gupta', 'Diplomat + Global BMD PLIF', 'Global BMD PLIF').proposed)
      .toBe('Testa E4 BMD - Gupta')
  })

  it('leaves a title that never named the kit', () => {
    expect(kitTitle('Booking', 'Diplomat', 'Mariner')).toBeNull()
  })

  it('leaves the title alone when the systems did not change', () => {
    expect(kitTitle('Testa DIPLOMAT - Dubey', 'Diplomat', 'Diplomat (Consignment)')).toBeNull()
  })

  it('goes with a surgeon change in one save', () => {
    const stale = staleTitle('Testa DIPLOMAT - Dubey', { kit: 'Diplomat', surgeon: 'Dubey' }, { kit: 'Mariner', surgeon: 'Gupta' })
    expect(stale.proposed).toBe('Testa MARINER - Gupta')
  })
})
