import { describe, it, expect } from 'vitest'
import { itemGaps, suggestedCode, lengthOf } from './usageItemCheck.js'

// Brent, 9 Nov 2026: "The portal should have picked up the missing size of the
// rods before he sent it." Invented lines.
describe('what a usage line must say', () => {
  it('a line with no product code is not finished', () => {
    expect(itemGaps({ productName: 'Diplomat cross link', size: '41-58mm' })).toEqual(['no product code'])
    expect(itemGaps({ productName: 'Diplomat cross link', referenceCode: 'AB0155-41058' })).toEqual([])
  })
  it('a rod needs its length, a pedicle screw its size, a set screw neither', () => {
    expect(itemGaps({ productName: 'Diplomat curved rods' })).toEqual(['no product code', 'rod length missing'])
    expect(itemGaps({ productName: 'Diplomat curved rods', size: '105' })).toEqual(['no product code'])
    expect(itemGaps({ productName: 'Pedicle screw' })).toEqual(['no product code', 'screw size missing'])
    expect(itemGaps({ productName: 'Set screw' })).toEqual(['no product code'])
    expect(itemGaps({ productName: 'Pedicle screw', referenceCode: 'AB0321-65050' })).toEqual([])
  })
  it('an excluded line is nobody\'s business', () => {
    expect(itemGaps({ productName: 'Floseal', excluded: true })).toEqual([])
  })
  it('offers the Diplomat rod code from the shape and length', () => {
    expect(lengthOf({ size: '5.5 x 105mm' })).toBe(105)
    expect(suggestedCode({ productName: 'Diplomat curved rods', size: '105' })).toBe('AB0955-00105')
    expect(suggestedCode({ productName: 'Titanium rod straight', size: '40mm', distributorKey: 'signus' })).toBe('AB0855-00040')
    expect(suggestedCode({ productName: 'Diplomat rods', size: '105' })).toBe('')
    expect(suggestedCode({ productName: 'Mariner rod curved', size: '105' })).toBe('')
    expect(suggestedCode({ productName: 'Diplomat curved rods', size: '105', referenceCode: 'X' })).toBe('')
  })
})
