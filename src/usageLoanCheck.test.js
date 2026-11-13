import { describe, it, expect } from 'vitest'
import { loanStampFlags, markingOf } from './usageLoanCheck.js'

// Brent, 13 Nov 2026: a distributor loan on the booking must be marked LOAN on
// the usage form. Invented items.
const KIT = 'Mariner MIS (Distributor Loan) / Shoreline (Consignment)'

describe('loan stock not marked LOAN', () => {
  it('flags a loan line that says consignment, and one with no stamp', () => {
    const flags = loanStampFlags([
      { id: 'a', productName: 'Mariner pedicle screw', distributorKey: 'device', stockMarking: 'Consignment' },
      { id: 'b', productName: 'Mariner set screw', distributorKey: 'device', stockMarking: '' }
    ], KIT)
    expect(flags.map(f => f.problem).sort()).toEqual(['consignment', 'no-stamp'])
    expect(flags.find(f => f.problem === 'consignment').message).toMatch(/says consignment/)
  })

  it('passes a loan line stamped LOAN, and leaves consignment systems alone', () => {
    expect(loanStampFlags([
      { id: 'a', productName: 'Mariner pedicle screw', distributorKey: 'device', stockMarking: 'LOAN' },
      { id: 'c', productName: 'Shoreline cage', distributorKey: 'device', stockMarking: 'consignment' }
    ], KIT)).toEqual([])
  })

  it('never flags Boost, and does nothing when the booking has no distributor loan', () => {
    expect(loanStampFlags([{ id: 'x', productName: 'BOOST UltraFibres', distributorKey: 'device_boost' }], KIT)).toEqual([])
    expect(loanStampFlags([{ id: 'a', productName: 'Mariner screw', distributorKey: 'device' }], 'Mariner (Consignment)')).toEqual([])
    expect(loanStampFlags([{ id: 'a', productName: 'Mariner screw', distributorKey: 'device' }], '')).toEqual([])
  })

  it('a line naming no system counts when the distributor has only the loan system booked', () => {
    const flags = loanStampFlags([{ id: 'r', productName: 'Rod 5.5 x 100', distributorKey: 'device' }], 'Mariner (Distributor Loan)')
    expect(flags).toHaveLength(1)
    expect(loanStampFlags([{ id: 'r', productName: 'Rod 5.5 x 100', distributorKey: 'device' }], KIT)).toEqual([])
  })

  it('reads the marking', () => {
    expect(markingOf({ stockMarking: 'LOAN stamp' })).toBe('loan')
    expect(markingOf({ stockMarking: 'cons' })).toBe('consignment')
    expect(markingOf({})).toBe('')
  })
})
