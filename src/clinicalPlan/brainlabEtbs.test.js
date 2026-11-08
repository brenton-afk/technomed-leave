import { describe, it, expect } from 'vitest'
import { brainlabOptions, brainlabFor, kitWithNavigation } from './brainlab.js'
import { isNavigationOnly } from './systems.js'

// Brent, 8 Nov 2026: an ETBS button beside AIRO and Curve, RHH bookings only.
describe('ETBS', () => {
  it('is offered at RHH and nowhere else', () => {
    expect(brainlabOptions('Royal Hobart Hospital')).toContain('ETBS')
    expect(brainlabOptions('RHH')).toContain('ETBS')
    expect(brainlabOptions('Calvary Lenah Valley')).not.toContain('ETBS')
    expect(brainlabOptions('')).not.toContain('ETBS')
  })
  it('comes off a booking moved away from RHH; the others stay', () => {
    expect(brainlabFor('ETBS', 'Calvary')).toBe('')
    expect(brainlabFor('ETBS', 'RHH')).toBe('ETBS')
    expect(brainlabFor('AIRO + Curve', 'Calvary')).toBe('AIRO + Curve')
  })
  it('writes BRAINLAB ETBS on the kit line, read as navigation not a system', () => {
    expect(kitWithNavigation('Mariner MIS', 'ETBS')).toBe('Mariner MIS + BRAINLAB ETBS')
    expect(isNavigationOnly('BRAINLAB ETBS')).toBe(true)
  })
})
