import { describe, it, expect } from 'vitest'
import { priceCheckCase, priceCheckResupply, withListedCodes, listedCodeFor } from './usagePriceCheck.js'
import { compareResupply } from '../api/_resupply.js'

// Brent, 27 Nov 2026 (Ben's resupply): the usage read the rod as AB0805-00-150;
// the list has AB0855-00150, so the resupply of AB0855-00150 matched nothing.
// Codes are invented-price-free fixtures shaped like the Signus list.
const book = { lists: { signus: [
  { code: 'AB0855-00150', rebate: 'QQ740', range: 'Diplomat', description: 'DIPLOMAT Titanium rod straight 5.5X150mm' },
  { code: 'AB0321-65045', rebate: 'QQ745', range: 'Diplomat', description: 'DIPLOMAT Ped screw 6.5x45' },
  { code: 'AB0321-55040', rebate: 'QQ745', range: 'Diplomat', description: 'DIPLOMAT Ped screw 5.5x40' },
  { code: 'AB0321-55045', rebate: 'QQ745', range: 'Diplomat', description: 'DIPLOMAT Ped screw 5.5x45' },
  { code: 'MACNIT18470 R/R', rebate: '', range: 'Diplomat', description: 'Nitinol k-wire 1.8 x 470mm' }
] } }
const item = (referenceCode, extra = {}) => ({ referenceCode, distributorKey: 'signus', quantity: 1, productName: 'SIGNUS DIPLOMAT', ...extra })

describe('a misread code is put right from the price list', () => {
  it('the rod: AB0805-00-150 becomes AB0855-00150, the reading kept', () => {
    const [it0] = priceCheckCase([item('AB0805-00-150')], book)
    expect(it0.referenceCode).toBe('AB0855-00150')
    expect(it0.codeAsRead).toBe('AB0805-00-150')
    expect(it0.priceCheck.status).toBe('listed')
    expect(it0.rebateCode).toBe('QQ740')
  })
  it('a listed code in another layout is written as the list writes it', () => {
    expect(priceCheckCase([item('AB0321-650-45')], book)[0].referenceCode).toBe('AB0321-65045')
  })
  it('a missed suffix is filled in', () => {
    expect(priceCheckCase([item('MACNIT18470')], book)[0].referenceCode).toBe('MACNIT18470 R/R')
    expect(priceCheckCase([item('MACNIT18470 R/W')], book)[0].referenceCode).toBe('MACNIT18470 R/R')
  })
  it('never guesses between two list codes', () => {
    // AB0321-55049 is one apart from both 55040 and 55045.
    expect(listedCodeFor('AB0321-55049', 'signus', book)).toBe(null)
    expect(priceCheckCase([item('AB0321-55049')], book)[0].referenceCode).toBe('AB0321-55049')
  })
  it('Ben\'s resupply now matches the usage it came from', () => {
    const record = { items: [item('AB0805-00-150', { quantity: 2, productName: 'SIGNUS DIPLOMAT Rod Straight' })] }
    const paper = priceCheckResupply({ distributorKey: 'signus', lines: [{ referenceCode: 'AB0855-00150', quantity: 2, description: 'DIPLOMAT Titanium rod straight 5.5x150mm' }] }, book)
    const before = compareResupply(record, 'signus', paper.lines)
    const after = compareResupply(withListedCodes(record, book), 'signus', paper.lines)
    expect(JSON.stringify(after)).not.toEqual(JSON.stringify(before))
    const row = (after.rows || after.items || []).find(r => /AB0855/.test(r.referenceCode))
    expect(row.now).toBe(2)
  })
})
