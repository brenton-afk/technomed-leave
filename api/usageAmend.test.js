import { describe, it, expect } from 'vitest'
import { amendItems, changesByDistributor } from './_usageAmend.js'
import { normaliseItem } from './_usageCase.js'

// Aimee, 4 Nov 2026: a cross link left off a usage that had already gone.
// Invented items, no patient detail.
const before = [
  { id: 'i1', productName: 'SIGNUS DIPLOMAT Pedicle Screw', size: '6.5 x 45mm', quantity: 4, distributorKey: 'signus' },
  { id: 'i2', productName: 'Global BMD PLIF cage', size: '10mm', quantity: 1, distributorKey: 'e4' }
]

describe('amending a sent usage', () => {
  it('finds an added cross link, and tells only that distributor', () => {
    const after = amendItems(before, [...before, { productName: 'SIGNUS DIPLOMAT Cross Link', size: '60mm', quantity: 1 }], normaliseItem)
    const changes = changesByDistributor(before, after)
    expect(changes.map(c => c.key)).toEqual(['signus'])
    expect(changes[0].lines).toEqual(['Added: 1 × SIGNUS DIPLOMAT Cross Link 60mm'])
  })

  it('says what changed and what was taken off', () => {
    const after = amendItems(before, [{ id: 'i1', quantity: 3 }, { id: 'i2', excluded: true }], normaliseItem)
    const lines = Object.fromEntries(changesByDistributor(before, after).map(c => [c.key, c.lines]))
    expect(lines.signus).toEqual(['Changed: 4 × SIGNUS DIPLOMAT Pedicle Screw 6.5 x 45mm → 3 × SIGNUS DIPLOMAT Pedicle Screw 6.5 x 45mm'])
    expect(lines.e4).toEqual(['Removed: 1 × Global BMD PLIF cage 10mm'])
  })

  it('keeps what the scan read on an item it did not touch', () => {
    const after = amendItems(before, [{ id: 'i1', quantity: 4 }], normaliseItem)
    expect(after[0]).toMatchObject({ productName: 'SIGNUS DIPLOMAT Pedicle Screw', distributorKey: 'signus' })
  })

  it('reports nothing when nothing changed', () => {
    expect(changesByDistributor(before, amendItems(before, before, normaliseItem))).toEqual([])
  })
})

// Brent, 9 Nov 2026: Cloherty's rods were added in Amend with no code.
describe('lines an amendment adds without a code or size', () => {
  it('are listed, and lines the amendment did not touch are not', async () => {
    const { amendGaps } = await import('./_usageAmend.js')
    const before = [{ id: 'a', productName: 'Old line', distributorKey: 'signus' }]
    const after = [
      { id: 'a', productName: 'Old line', distributorKey: 'signus' },
      { id: 'n1', productName: 'Diplomat curved rods', size: '105', quantity: 2, distributorKey: 'signus' },
      { id: 'n2', productName: 'Diplomat cross link', referenceCode: 'AB0155-41058', distributorKey: 'signus' }
    ]
    expect(amendGaps(before, after)).toEqual([{ id: 'n1', name: 'Diplomat curved rods 105', gaps: ['no product code'], suggestion: 'AB0955-00105' }])
  })
})
