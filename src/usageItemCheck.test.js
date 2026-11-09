import { describe, it, expect } from 'vitest'
import { itemGaps, suggestedCode, lengthOf, ruleFor } from './usageItemCheck.js'

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

// Brent, 9 Nov 2026: "there is no size per se for a tulip, so I don't want the
// usage stopped for these items."
describe('the rules, kind by kind', () => {
  const stops = item => itemGaps(item).filter(g => g !== 'no product code')
  it('never stops a tulip, set screw, cross link, K-wire or graft for a size', () => {
    for (const productName of ['Standard tulip', 'Diplomat Reduction Tulip', 'Set screw', 'Mariner MIS Set Screw - Point Lock',
      'Diplomat cross link', 'Nitinol K-wire', 'Boost DBM Allograft', 'Mariner Outrigger'])
      expect(stops({ productName }), productName).toEqual([])
  })
  it('a code alone is enough for anything — it already says the size', () => {
    expect(itemGaps({ productName: 'DIPLOMAT Titanium rod curved', referenceCode: 'AB0955-00105' })).toEqual([])
    expect(itemGaps({ productName: 'Pedicle screw', referenceCode: 'AB0321-65050' })).toEqual([])
  })
  it('stops a screw, rod, plate or cage with neither code nor size', () => {
    expect(stops({ productName: 'DIPLOMAT Ped Scr w/o tlp fenes polyax' })).toEqual(['screw size missing'])
    expect(stops({ productName: 'Pedicle screw', size: '6.5 x 50mm' })).toEqual([])
    expect(stops({ productName: 'Pedicle screw', description: 'length handwritten as 50mm' })).toEqual([])
    expect(stops({ productName: 'Cervical plate' })).toEqual(['plate size missing'])
    expect(stops({ productName: 'PLIF cage', size: '10 x 26mm' })).toEqual([])
    expect(stops({ productName: 'Cervical cage' })).toEqual(['cage size missing'])
  })
  it('knows a screw without its tulip is a screw, not a tulip', () => {
    expect(ruleFor({ productName: 'Ped Scr w/o tulip 6.5' }).kind).toMatch(/screw/i)
    expect(ruleFor({ productName: 'Standard tulip' }).kind).toMatch(/tulip/i)
    expect(ruleFor({ productName: 'Mystery item' })).toBeNull()
  })
})
