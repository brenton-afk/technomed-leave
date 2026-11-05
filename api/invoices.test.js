import { describe, it, expect } from 'vitest'
import { lineItems } from './_xeroAccounting.js'
import { poNumberIn, cleanOrder, invoicedByPo, splitOrders } from './_purchaseOrders.js'

// Admin → Invoices (Brent, 5 Nov 2026): Calvary POs from accounts@ into draft
// Xero invoices, and quotes. Invented data.
describe('reading a purchase order', () => {
  it('finds Calvary PO numbers in subjects and file names', () => {
    expect(poNumberIn('Purchase Order LVP0008868')).toBe('LVP0008868')
    expect(poNumberIn('', 'ACP0000294.pdf')).toBe('ACP0000294')
    expect(poNumberIn('Quote QU-0480')).toBe('')
  })

  it('finds the LVH numbers nearly every Calvary invoice carries', () => {
    expect(poNumberIn('Purchase Order LVH0012240')).toBe('LVH0012240')
    expect(poNumberIn('', 'PO_lvh0012240.pdf')).toBe('LVH0012240')
    expect(poNumberIn('Order SJH0001234')).toBe('SJH0001234')
    expect(poNumberIn('Phone 0412345678')).toBe('')
  })

  it('tidies the reading into typed lines, and falls back to the email for the PO number', () => {
    const order = cleanOrder({
      lines: [{ code: 'AR-1234', description: 'Handpiece', quantity: '2', unitPrice: '$1,250.00' }, { code: '', description: '' }],
      date: '2026-11-04'
    }, { id: 'm1', subject: 'Purchase Order LVP0001234', attachments: [] })
    expect(order.poNumber).toBe('LVP0001234')
    expect(order.lines).toEqual([{ code: 'AR-1234', description: 'Handpiece', quantity: 2, unitPrice: 1250 }])
    expect(order.date).toBe('2026-11-04')
  })
})

describe('lines for Xero', () => {
  const items = [{ code: 'AR-1234', name: 'Handpiece', description: 'Arthrex handpiece', price: 1250 }]

  it('sends a known code as the Xero item, and keeps an unknown one in the description', () => {
    const out = lineItems([
      { code: 'ar-1234', description: '', quantity: 1, unitPrice: 1250 },
      { code: 'X-9', description: 'Something else', quantity: 2, unitPrice: 10.005 }
    ], items)
    expect(out[0]).toEqual({ ItemCode: 'AR-1234', Description: 'Arthrex handpiece', Quantity: 1, UnitAmount: 1250 })
    expect(out[1]).toEqual({ Description: 'X-9 — Something else', Quantity: 2, UnitAmount: 10.01 })
  })

  it('refuses a line with no quantity or no price, rather than drafting a guess', () => {
    expect(() => lineItems([{ description: 'A', quantity: 0, unitPrice: 5 }], items)).toThrow(/quantity/)
    expect(() => lineItems([{ description: 'A', quantity: 1, unitPrice: 'x' }], items)).toThrow(/price/)
    // A blank price arrives as null (NaN through JSON) and must not become $0.
    expect(() => lineItems([{ description: 'A', quantity: 1, unitPrice: null }], items)).toThrow(/price/)
    expect(() => lineItems([{ description: 'A', quantity: 1, unitPrice: '' }], items)).toThrow(/price/)
    expect(lineItems([{ description: 'A', quantity: 1, unitPrice: 0 }], items)[0].UnitAmount).toBe(0)
  })
})

import { parsePastedLines, discountOf, lineAmount } from '../src/invoiceLines.js'

describe('lines pasted from a spreadsheet', () => {
  it('reads code, description, quantity, price and discount, skipping the header and totals', () => {
    const text = [
      'Item\tDescription\tQuantity\tUnit Price\tDiscount\tGST\tAmount',
      'AB0010-55001\tDIPLOMAT Tulip\t4\t686\t20.00%\t10%\t2195.2',
      'MP0068\tK-Wire\t1\t$50.00\t\t10%\t50',
      '\t\t\t\t\tSubtotal\t2245.2'
    ].join('\n')
    expect(parsePastedLines(text)).toEqual([
      { code: 'AB0010-55001', description: 'DIPLOMAT Tulip', quantity: 4, unitPrice: 686, discount: 20 },
      { code: 'MP0068', description: 'K-Wire', quantity: 1, unitPrice: 50, discount: 0 }
    ])
  })
  it('reads a discount as a percentage however it is written', () => {
    expect(discountOf('20%')).toBe(20)
    expect(discountOf('0.2')).toBe(20)
    expect(discountOf('20')).toBe(20)
    expect(discountOf('')).toBe(0)
  })
  it('totals a line after its discount, and sends the discount to Xero', () => {
    expect(lineAmount({ quantity: 4, unitPrice: 524, discount: 20 })).toBeCloseTo(1676.8)
    expect(lineItems([{ description: 'A', quantity: 1, unitPrice: 10, discount: 20 }], [])[0].DiscountRate).toBe(20)
    expect(lineItems([{ description: 'A', quantity: 1, unitPrice: 10 }], [])[0].DiscountRate).toBeUndefined()
    expect(() => lineItems([{ description: 'A', quantity: 1, unitPrice: 10, discount: 120 }], [])).toThrow(/discount/)
  })
})

describe('only purchase orders without an invoice are offered', () => {
  const orders = [
    { id: 'a', poNumber: 'LVH0010001', receivedAt: '2026-11-04T00:00:00Z' },
    { id: 'b', poNumber: 'LVH0010002', receivedAt: '2026-11-03T00:00:00Z' },
    { id: 'c', poNumber: 'LVH0010001', receivedAt: '2026-11-02T00:00:00Z' },
    { id: 'd', poNumber: '', receivedAt: '2026-11-01T00:00:00Z' },
    { id: 'e', poNumber: 'LVP0020003', receivedAt: '2026-10-30T00:00:00Z' }
  ]
  const invoiced = invoicedByPo([
    { number: 'INV-1', status: 'PAID', reference: 'LVH0010002' },
    { number: 'INV-2', status: 'AUTHORISED', reference: 'po lvp0020003 - kits' },
    { number: 'INV-3', status: 'VOIDED', reference: 'LVH0010001' }
  ])

  it('offers a PO Xero has no invoice for, once however often it was sent', () => {
    const out = splitOrders(orders, invoiced)
    expect(out.outstanding.map(o => [o.id, o.copies])).toEqual([['a', 2]])
    expect(out.invoiced.map(o => o.id)).toEqual(['b', 'e'])
    expect(out.noNumber.map(o => o.id)).toEqual(['d'])
  })

  it('a voided invoice does not count as invoiced', () => {
    expect(invoiced.has('LVH0010001')).toBe(false)
  })

  it('offers nothing when Xero could not be asked', () => {
    const out = splitOrders(orders, null)
    expect(out.outstanding).toEqual([])
    expect(out.unchecked.map(o => o.id)).toEqual(['a', 'b', 'e'])
  })
})
