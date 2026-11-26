import { describe, it, expect } from 'vitest'
import { detectDistributor } from './_distributors.js'

// Brent, 26 Nov 2026: "Orthofix implants go to KT medical as per Firebird and
// Forza"; Boost to Device, CBM to DTBV as before.
describe('who a usage line goes to', () => {
  it('Orthofix, Firebird, Forza and Lonestar are KT Medical', () => {
    for (const t of ['Orthofix pedicle screw 6.5 x 45', 'FIREBIRD SI fusion', 'Forza XP spacer', 'Lonestar cage']) {
      expect(detectDistributor(t)).toBe('kt')
    }
  })
  it('Boost and CBM keep their own routes', () => {
    expect(detectDistributor('Boost UltraFibres 5g')).toBe('device_boost')
    expect(detectDistributor('CBM allograft 5cc')).toBe('dtbv')
    expect(detectDistributor('Mariner screw')).toBe('device')
  })
})
