import { describe, it, expect } from 'vitest'
import { navigationChoice, kitWithoutNavigation, kitWithNavigation } from './brainlab.js'

// "AIRO doesn't need to transcribe into the booking from the email, just needs
// to automatically tap the AIRO button in the booking."
describe('navigation from an email', () => {
  it('becomes the button', () => {
    expect(navigationChoice('Mariner MIS / AIRO')).toBe('AIRO + Curve')
    expect(navigationChoice('Spinal Brainlab Curve')).toBe('Curve only')
    expect(navigationChoice('Mariner MIS')).toBe('')
  })

  it('comes off the kit line, leaving the systems', () => {
    expect(kitWithoutNavigation('Mariner MIS / AIRO')).toBe('Mariner MIS')
    expect(kitWithoutNavigation('Mariner MIS (Distributor Loan) / Spinal Brainlab')).toBe('Mariner MIS (Distributor Loan)')
    expect(kitWithoutNavigation('AIRO')).toBe('')
    expect(kitWithoutNavigation('Diplomat (Consignment)')).toBe('Diplomat (Consignment)')
  })

  it('is written back the same way the New booking button writes it', () => {
    expect(kitWithNavigation('Mariner MIS', 'AIRO + Curve')).toBe('Mariner MIS + BRAINLAB AIRO & CURVE')
    expect(kitWithNavigation('', 'AIRO + Curve')).toBe('BRAINLAB AIRO & CURVE')
    expect(kitWithNavigation('Mariner MIS', '')).toBe('Mariner MIS')
  })
})
