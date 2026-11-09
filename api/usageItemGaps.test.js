import { describe, it, expect } from 'vitest'
import { normaliseItem } from './_usageCase.js'

// Brent, 9 Nov 2026: a scanned line a distributor cannot resupply from goes to
// review before anything is sent. Invented lines.
describe('a scanned line with no code or size', () => {
  it('goes to review, saying what is missing', () => {
    const rod = normaliseItem({ productName: 'Diplomat curved rods', quantity: 'x2' }, 0)
    expect(rod.manualReview).toBe(true)
    expect(rod.reviewReasons).toEqual(expect.arrayContaining(['no product code', 'rod length missing']))
  })
  it('a complete line does not', () => {
    const ok = normaliseItem({ productName: 'DIPLOMAT Titanium rod curved', referenceCode: 'AB0955-00105', size: '5.5 x 105mm', quantity: 'x2' }, 1)
    expect(ok.manualReview).toBe(false)
  })
})
