import { describe, it, expect } from 'vitest'
import { priceCheckCase, priceCheckItem, priceCheckLine, indexPriceBook, priceCheckResupply } from './usagePriceCheck.js'

// A usage line against the distributor's price list (Brent, 18 Nov 2026).
// Invented codes.

const book = {
  lists: {
    signus: [{ code: 'AB0010-11111', rebate: 'QQ001', range: 'Diplomat', description: 'Tulip', price: 100 }],
    e4: [{ code: '71-PIN-01', rebate: 'EY034', range: 'Dakota', price: 0 }],
    'kt-private': [{ code: '44-1111', rebate: 'ER571', range: 'FIREBIRD', price: 500 }],
    'kt-rhh': [{ code: '44-1111', rebate: 'ER999', range: 'FIREBIRD', price: 480 }]
  }
}
const index = indexPriceBook(book)
const check = (item, opts) => priceCheckItem(item, book, index, opts)

describe('checking a line', () => {
  it('finds it on its distributor’s list, ignoring spaces and dashes', () => {
    expect(check({ referenceCode: 'ab0010 11111', distributorKey: 'signus' })).toMatchObject({ status: 'listed', rebate: 'QQ001', range: 'Diplomat' })
  })
  it('KT: the RHH list at the RHH, private elsewhere', () => {
    expect(check({ referenceCode: '44-1111', distributorKey: 'kt' }, { hospital: 'RHH' }).rebate).toBe('ER999')
    expect(check({ referenceCode: '44-1111', distributorKey: 'kt' }, { hospital: 'CLV' }).rebate).toBe('ER571')
  })
  it('a code on another distributor’s list', () => {
    expect(check({ referenceCode: '71-PIN-01', distributorKey: 'signus' })).toMatchObject({ status: 'other-distributor', distributorKey: 'e4', distributor: 'E4 Surgical' })
  })
  it('a code on no list, with the one a character away', () => {
    expect(check({ referenceCode: 'AB0010-11117', distributorKey: 'signus' })).toMatchObject({ status: 'not-listed', near: 'AB0010-11111' })
    expect(check({ referenceCode: 'ZZZ', distributorKey: 'signus' }).near).toBeUndefined()
  })
  it('says nothing for a distributor with no list, or no code', () => {
    expect(check({ referenceCode: 'X-1', distributorKey: 'globus' }).status).toBe('no-list')
    expect(check({ referenceCode: '', distributorKey: 'signus' }).status).toBe('no-code')
  })
})

describe('a whole case', () => {
  it('fills a blank rebate code, sends a wrong-distributor line to review, never carries a price', () => {
    const items = priceCheckCase([
      { id: 'a', referenceCode: 'AB0010-11111', distributorKey: 'signus', rebateCode: '' },
      { id: 'b', referenceCode: 'AB0010-11111', distributorKey: 'signus', rebateCode: 'QQ777' },
      { id: 'c', referenceCode: '71-PIN-01', distributorKey: 'signus', reviewReasons: [] }
    ], book)
    expect(items[0].rebateCode).toBe('QQ001')
    expect(items[1].rebateCode).toBe('QQ777')
    expect(items[2]).toMatchObject({ manualReview: true, reviewReasons: ["code is on E4 Surgical's price list"] })
    expect(JSON.stringify(items)).not.toMatch(/"price"/)
  })
  it('the review line follows the code: edited, it is no longer shown', () => {
    const [item] = priceCheckCase([{ referenceCode: '71-PIN-01', distributorKey: 'signus' }], book)
    expect(priceCheckLine(item)).toMatchObject({ tone: 'warn', move: 'e4' })
    expect(priceCheckLine({ ...item, referenceCode: 'other' })).toBeNull()
  })
  it('leaves the case alone when the portal holds no lists', () => {
    const items = [{ referenceCode: 'x' }]
    expect(priceCheckCase(items, null)).toBe(items)
  })
})

describe('a resupply paper', () => {
  const paper = (distributorKey, codes) => ({ distributorKey, distributor: distributorKey ? 'Named' : '', lines: codes.map((c, i) => ({ id: `line-${i}`, referenceCode: c, quantity: 1 })) })
  it('checks every line, never carrying a price', () => {
    const out = priceCheckResupply(paper('signus', ['AB0010-11111', 'AB0010-11117']), book)
    expect(out.lines.map(l => l.priceCheck.status)).toEqual(['listed', 'not-listed'])
    expect(out.lines[1].priceCheck.near).toBe('AB0010-11111')
    expect(JSON.stringify(out)).not.toMatch(/"price"/)
  })
  it('takes the distributor from the codes when the supplier was not recognised, on the first read only', () => {
    const out = priceCheckResupply(paper(null, ['71-PIN-01', 'ZZZ']), book, { infer: true })
    expect(out).toMatchObject({ distributorKey: 'e4', distributor: 'E4 Surgical', distributorFromList: true })
    expect(priceCheckResupply(paper(null, ['71-PIN-01']), book).distributorKey).toBeNull()
  })
  it('says when the paper looks like another distributor’s', () => {
    const out = priceCheckResupply(paper('signus', ['71-PIN-01', '71-PIN-01', 'AB0010-11111']), book)
    expect(out.listSuggests).toMatchObject({ distributorKey: 'e4' })
    expect(priceCheckResupply(paper('signus', ['AB0010-11111']), book).listSuggests).toBeNull()
  })
  it('leaves the paper alone with no lists', () => {
    const p = paper('signus', ['x'])
    expect(priceCheckResupply(p, null)).toBe(p)
  })
})
