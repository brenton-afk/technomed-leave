import { describe, it, expect } from 'vitest'
import { normaliseCase, cleanRebate } from './_usageCase.js'
import { isExcludedProduct } from './_distributors.js'

// Brent, 26 Nov 2026: the CBM graft read twice, the reference copied into the
// rebate box, and Horizon clips and Dermabond on the scan.
const base = { patientSurname: 'Testcase', surgeonName: 'Thani', date: '26/11/2026', hospital: 'Calvary', procedure: 'ALIF' }

describe('one graft, read twice, is one line', () => {
  it('keeps the clean CBM line and drops the copy', () => {
    const c = normaliseCase({ ...base, items: [
      { productName: 'Cancellous Bone Matrix', referenceCode: 'DTBVCBM10014', lotNumber: 'CBM-001947-25-27', rebateCode: 'DTBVCBM10014', quantity: 1, manualReview: true },
      { productName: 'Cancellous Bone Matrix', referenceCode: 'CBM-001947-25-27', lotNumber: 'CBM-001947-25-27', size: '10cc, particle size 1-4mm', quantity: 1 }
    ] }, {})
    expect(c.items).toHaveLength(1)
    expect(c.items[0].size).toMatch(/10cc/)
  })
  it('never merges implants that only share a lot', () => {
    const c = normaliseCase({ ...base, items: [
      { productName: 'Diplomat screw', referenceCode: 'AB0321-06540', lotNumber: 'L123456', size: '6.5x40', quantity: 1 },
      { productName: 'Diplomat screw', referenceCode: 'AB0321-06545', lotNumber: 'L123456', size: '6.5x45', quantity: 1 }
    ] }, {})
    expect(c.items).toHaveLength(2)
  })
})

describe('rebate codes', () => {
  it('keeps a short letters-and-digits code', () => {
    expect(cleanRebate('EY011', 'AB0321-06540')).toBe('EY011')
  })
  it('drops the reference, a lot, or anything long or hyphenated', () => {
    expect(cleanRebate('DTBVCBM10014', 'DTBVCBM10014')).toBe('')
    expect(cleanRebate('CBM-001947-25-27')).toBe('')
    expect(cleanRebate('123456789')).toBe('')
  })
})

describe('never on a scan', () => {
  it('Horizon (Weck) clips and Dermabond', () => {
    expect(isExcludedProduct('Horizon Medium (clip)')).toBe(true)
    expect(isExcludedProduct('Weck ligating clips')).toBe(true)
    expect(isExcludedProduct('Dermabond Prineo')).toBe(true)
    expect(isExcludedProduct('Mariner pedicle screw')).toBe(false)
  })
})
