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
    expect(order.lines).toEqual([{ code: 'AR-1234', description: 'Handpiece', quantity: 2, unitPrice: 1250, xeroCode: '' }])
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

import { planInvoice, contactFor } from './_poAuto.js'

describe('a purchase order drafted by itself', () => {
  const items = [
    { code: 'KIT-1', name: 'Positioning Kit (Box of 6)', price: 500 },
    { code: 'TUBE-10', name: 'Suction Tube 10FR', price: 70 },
    { code: 'F/H Local', name: 'LOCAL Freight and Handling', price: 27.5 }
  ]
  const contacts = [
    { id: 'c-lv', name: 'Calvary Lenah Valley Hospital' },
    { id: 'c-sj', name: 'Calvary St Johns Hospital' },
    { id: 'c-cafe', name: 'Calvary Cafe' }
  ]
  const base = { poNumber: 'LVH0010001', items, contacts, today: '2026-11-05' }
  const order = (lines, extra = {}) => ({ poNumber: 'LVH0010001', lines, totalExGst: 0, ...extra })

  it('is drafted the way the team does it: the hospital, the PO as reference, Xero prices, freight, 30 days', () => {
    const plan = planInvoice(order([{ code: 'CAL-99', description: 'positioning kit', quantity: 3, unitPrice: 500, xeroCode: 'KIT-1' }], { totalExGst: 1500 }), base)
    expect(plan.ok).toBe(true)
    expect(plan.invoice).toMatchObject({ contactId: 'c-lv', reference: 'LVH0010001', date: '2026-11-05', dueDate: '2026-12-05' })
    expect(plan.invoice.lines).toEqual([
      { code: 'KIT-1', xeroCode: 'KIT-1', description: 'Positioning Kit (Box of 6)', quantity: 3, unitPrice: 500 },
      { code: 'F/H Local', xeroCode: 'F/H Local', description: 'LOCAL Freight and Handling', quantity: 1, unitPrice: 27.5 }
    ])
  })

  it('uses the Xero price when the order shows none, and does not add freight twice', () => {
    const plan = planInvoice(order([
      { description: 'tube', quantity: 2, unitPrice: 0, xeroCode: 'TUBE-10' },
      { description: 'Freight', quantity: 1, unitPrice: 27.5 }
    ]), base)
    expect(plan.invoice.lines.map(l => [l.code, l.quantity, l.unitPrice])).toEqual([['TUBE-10', 2, 70], ['F/H Local', 1, 27.5]])
  })

  it('holds a line it cannot match to a Xero product', () => {
    const plan = planInvoice(order([{ description: 'something new', quantity: 1, unitPrice: 10, xeroCode: 'NOPE' }]), base)
    expect(plan).toMatchObject({ ok: false })
    expect(plan.reason).toMatch(/not matched/)
  })

  it('holds when the order price disagrees with Xero', () => {
    const plan = planInvoice(order([{ description: 'kit', quantity: 1, unitPrice: 450, xeroCode: 'KIT-1' }]), base)
    expect(plan.reason).toMatch(/\$450\.00.*\$500\.00/)
  })

  it('holds when the lines do not add up to the order total', () => {
    const plan = planInvoice(order([{ description: 'kit', quantity: 1, unitPrice: 500, xeroCode: 'KIT-1' }], { totalExGst: 1000 }), base)
    expect(plan.reason).toMatch(/total/)
  })

  it('accepts an order total that includes GST or freight', () => {
    const l = [{ description: 'kit', quantity: 1, unitPrice: 500, xeroCode: 'KIT-1' }]
    expect(planInvoice(order(l, { totalExGst: 550 }), base).ok).toBe(true)
    expect(planInvoice(order(l, { totalExGst: 527.5 }), base).ok).toBe(true)
  })

  it('holds when the PDF and the email disagree on the PO number', () => {
    const plan = planInvoice({ ...order([{ quantity: 1, xeroCode: 'KIT-1' }]), poNumber: 'LVH0010002' }, base)
    expect(plan.reason).toMatch(/LVH0010002/)
  })

  it('finds the hospital by the PO prefix, and holds an unknown one', () => {
    expect(contactFor('LVH0010001', contacts).id).toBe('c-lv')
    expect(contactFor('SJH0010001', contacts).id).toBe('c-sj')
    expect(contactFor('ACP0000294', contacts)).toBe(null)
    expect(planInvoice(order([{ quantity: 1, xeroCode: 'KIT-1' }]), { ...base, poNumber: 'ACP0000294' }).ok).toBe(false)
  })
})

import { invoiceNumbersIn } from './_remittances.js'

describe('reading a remittance', () => {
  it('finds our invoice numbers however they are written', () => {
    expect(invoiceNumbersIn('Payment of INV-2016, INV 2017 and inv2021; ref LVH0016091')).toEqual(['INV-2016', 'INV-2017', 'INV-2021'])
  })
})

import { readRequest, dedupe } from './_quoteRequests.js'

describe('quote requests from CNS', () => {
  it('reads levels and MBS items from the email, and nothing it does not say', () => {
    expect(readRequest({ subject: 'T8/9 DISCECTOMY + SINGLE LEVEL FIXATION - UNINSURED', text: 'quote please 51011, 51021, 51031' }))
      .toEqual({ mbs: ['51011', '51021', '51031'], levels: 'T8/9', uninsured: true })
    expect(readRequest({ subject: 'Quote request', text: 'hello' })).toEqual({ mbs: [], levels: '', uninsured: false })
  })
  it('counts the same email in bookings@ and brenton@ once', () => {
    const out = dedupe([
      { messageId: '<a@x>', mailbox: 'bookings@technomed.com.au', receivedAt: '2026-11-05T00:00:00Z' },
      { messageId: '<a@x>', mailbox: 'brenton@technomed.com.au', receivedAt: '2026-11-05T00:00:00Z' },
      { messageId: '<b@x>', mailbox: 'brenton@technomed.com.au', receivedAt: '2026-11-04T00:00:00Z' }
    ])
    expect(out.map(m => m.mailboxes.length)).toEqual([2, 1])
  })
})

import { checkPlan, quoteFolder, quoteFileName, distributorsOnQuote, quoteSummary } from './_quoteAuto.js'

describe('self-funding quotes from templates', () => {
  const templates = [{ id: 't1', title: 'Diplomat single level fixation', number: 'QU-0001', lines: [
    { code: 'AB0321-xxxxx', description: 'DIPLOMAT Pedicle Screw', quantity: 4, unitPrice: 524, discount: 20 },
    { code: 'AB0010-55001', description: 'DIPLOMAT Tulip', quantity: 4, unitPrice: 686, discount: 20 },
    { code: 'MP0068', description: 'K-Wire 1.8 x 500mm', quantity: 1, unitPrice: 50, discount: 0 }
  ] }]

  it('copies lines and prices only from the chosen template, letting quantities change', () => {
    const out = checkPlan({ templateId: 't1', lines: [
      { code: 'AB0321-xxxxx', description: 'DIPLOMAT Pedicle Screw', quantity: 6 },
      { code: 'MP0068', description: 'K-Wire 1.8 x 500mm', quantity: 1 }
    ] }, templates)
    expect(out.ok).toBe(true)
    expect(out.lines).toEqual([
      { code: 'AB0321-xxxxx', description: 'DIPLOMAT Pedicle Screw', quantity: 6, unitPrice: 524, discount: 20 },
      { code: 'MP0068', description: 'K-Wire 1.8 x 500mm', quantity: 1, unitPrice: 50, discount: 0 }
    ])
  })

  it('holds a line the template does not have, and an unknown template', () => {
    expect(checkPlan({ templateId: 't1', lines: [{ code: 'NEW', description: 'Something', quantity: 1 }] }, templates).ok).toBe(false)
    expect(checkPlan({ templateId: 'nope', lines: [] }, templates).reason).toMatch(/No quote template/)
    expect(checkPlan({ hold: 'Surgeon unclear' }, templates).reason).toBe('Surgeon unclear')
  })

  it('files where the team files them, named as they name them', () => {
    expect(quoteFolder('Dr Nova Thani')).toBe('/ALL SURGEON USAGE/SPINE Usage/THANI - SPINE/Thani Self Funding Quotes')
    expect(quoteFolder('Ibbett')).toBe('/ALL SURGEON USAGE/SPINE Usage/IBBETT - SPINE/Self Funding Quotes')
    expect(quoteFolder('Dubey')).toBe('/ALL SURGEON USAGE/SPINE Usage/DUBEY - SPINE/Dubey Self Funding Quotes')
    expect(quoteFolder('')).toMatch(/Surgeon Unknown$/)
    expect(quoteFileName('Test Patient', 'QU-0501')).toBe('Test Patient Self Funding Quote QU0501.pdf')
  })

  it('tells each distributor with a product on the quote', () => {
    expect(distributorsOnQuote([{ description: 'DIPLOMAT Tulip' }, { description: 'CYLOX cage' }, { description: 'Dakota plate' }]).sort()).toEqual(['e4', 'signus'])
    expect(distributorsOnQuote([{ description: 'Freight' }])).toEqual([])
  })

  it('writes the summary lines the team puts on a quote', () => {
    expect(quoteSummary({ surgeon: 'Dr Test', patient: 'Test Patient', procedure: 'Fixation', levels: 'T8/9', system: 'Diplomat' }))
      .toBe('Surgeon: Dr Test\nPatient: Test Patient\nDate: TBC\nProcedure: Fixation (T8/9)\nKit/System: Diplomat')
  })
})
