import { describe, it, expect } from 'vitest'
import { isPedicleOrLateralMass, needsAutoAiro, kitWithAutoAiro } from './brainlab.js'

// Brent, 11 Nov 2026: "All Pedicle screw and lateral mass cases at RHH should
// have auto AIRO booked and not rely on someone tapping it." The operations
// below are October's RHH bookings as typed.
describe('AIRO on RHH pedicle-screw and lateral-mass cases', () => {
  it('knows a screw case from the operation', () => {
    for (const op of [
      'L4-S1 Pedicle screw fixation and L4/5 & L5/S1 PLIF',
      'T10-L2 pedicle screw fixation',
      'T7–T10 posterior fixation',
      'L1/2 PLIF',
      'L4/5 PLIF',
      'Posterior cervical C3-5 decompression +/- lateral mass screws',
      'C3-5 Lat Mass Fixation',
      'C4-T2 Fixation',
      'Redo L4/5 posterior decompression +/- posterior pedicle screw fixation',
      'Extension Fusion to L5/S1 and S2AI'
    ]) expect(isPedicleOrLateralMass(op), op).toBe(true)
  })
  it('leaves everything else alone', () => {
    for (const op of [
      'C4/5, C5/6 C6/7 ACDF +/- C3/4',
      'C5,C6 Corpectomy',
      'C5-C6 corpectomy and fixation',
      'SIJ Screw fixation',
      'Posterior Fossa Craniotomy',
      'L1 - L3 Pedicle screw removal',
      'Stereotactic biopsy of left cerebellar lesion',
      'VP shunt insertion',
      ''
    ]) expect(isPedicleOrLateralMass(op), op).toBe(false)
  })
  it('is RHH only, and a booking that says no AIRO keeps it off', () => {
    expect(needsAutoAiro({ hospital: 'RHH', procedure: 'L4/5 PLIF' })).toBe(true)
    expect(needsAutoAiro({ hospital: 'Royal Hobart Hospital', procedure: 'L4/5 PLIF' })).toBe(true)
    expect(needsAutoAiro({ hospital: 'CLV', procedure: 'L4/5 PLIF' })).toBe(false)
    expect(needsAutoAiro({ hospital: 'RHH', procedure: 'L4/5 PLIF', notes: 'No AIRO — surgeon using fluoro' })).toBe(false)
  })
  it('adds AIRO & Curve to the kit once, and never over navigation already chosen', () => {
    expect(kitWithAutoAiro({ hospital: 'RHH', procedure: 'L4/5 PLIF', kit: 'Diplomat (Consignment)' }))
      .toBe('Diplomat (Consignment) + BRAINLAB AIRO & CURVE')
    expect(kitWithAutoAiro({ hospital: 'RHH', procedure: 'L4/5 PLIF', kit: '' })).toBe('BRAINLAB AIRO & CURVE')
    const done = 'Diplomat (Consignment) + BRAINLAB AIRO & CURVE'
    expect(kitWithAutoAiro({ hospital: 'RHH', procedure: 'L4/5 PLIF', kit: done })).toBe(done)
    expect(kitWithAutoAiro({ hospital: 'RHH', procedure: 'L4/5 PLIF', kit: 'Mariner + BRAINLAB CURVE' })).toBe('Mariner + BRAINLAB CURVE')
    expect(kitWithAutoAiro({ hospital: 'RHH', procedure: 'C4/5 ACDF', kit: 'Dakota' })).toBe('Dakota')
  })
})
