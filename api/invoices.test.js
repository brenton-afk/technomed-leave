import { describe, it, expect } from 'vitest'
import { lineItems } from './_xeroAccounting.js'
import { poNumberIn, cleanOrder } from './_purchaseOrders.js'

// Admin → Invoices (Brent, 5 Nov 2026): Calvary POs from accounts@ into draft
// Xero invoices, and quotes. Invented data.
describe('reading a purchase order', () => {
  it('finds Calvary PO numbers in subjects and file names', () => {
    expect(poNumberIn('Purchase Order LVP0008868')).toBe('LVP0008868')
    expect(poNumberIn('', 'ACP0000294.pdf')).toBe('ACP0000294')
    expect(poNumberIn('Quote QU-0480')).toBe('')
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
