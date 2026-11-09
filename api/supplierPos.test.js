import { describe, it, expect, vi } from 'vitest'

const store = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, ...a) => {
    if (cmd === 'set') { store.set(a[0], a[1]); return 'OK' }
    if (cmd === 'mget') return a.map(k => store.get(k) ?? null)
    return null
  })
}))
vi.mock('./_gmail.js', () => ({ searchMailboxOf: vi.fn(), readMessageHeadline: vi.fn(), readAttachment: vi.fn(), sniffMediaType: vi.fn(), addressOf: v => v }))
vi.mock('./_anthropic.js', () => ({ askClaude: vi.fn() }))
vi.mock('./_xeroAccounting.js', () => ({ xeroCall: vi.fn() }))

const S = await import('./_supplierPos.js')

// Brent, 9 Nov 2026: "read a quote and generate a PO". The case that started
// it: MAC Surgical quote 00012501, Cody asking for an updated PO-0147.
const PO147 = {
  PurchaseOrderID: 'po-147', PurchaseOrderNumber: 'PO-0147', Status: 'AUTHORISED', Reference: 'K-Wires',
  Contact: { ContactID: 'mac', Name: 'MAC SURGICAL' }, SubTotal: 1600, Total: 1760,
  LineItems: [{ Description: 'Kwire 3.2 x 500mm', Quantity: 10, UnitAmount: 160, AccountCode: '310', TaxType: 'INPUT' }]
}

describe('finding a supplier quote or PO request', () => {
  it('reads our PO number however it is written', () => {
    expect(S.ourPoNumber('Can you send me an updated PO-0147?')).toBe('PO-0147')
    expect(S.ourPoNumber('updated PO 147 please')).toBe('PO-0147')
    expect(S.ourPoNumber('no number here')).toBe('')
  })
  it('knows a quote or a PO request from other supplier mail', () => {
    expect(S.looksLikeQuoteOrPoRequest({ subject: 'Re: Kwire project', text: 'Can you send me an updated PO for this one?', files: ['QUOTE0012501.pdf'] })).toBe(true)
    expect(S.looksLikeQuoteOrPoRequest({ subject: 'Quotation 4471', text: '', files: ['Q4471.pdf'] })).toBe(true)
    expect(S.looksLikeQuoteOrPoRequest({ subject: 'Newsletter', text: 'Our new products', files: ['brochure.pdf'] })).toBe(false)
  })
  it('keeps only what was read, typed', () => {
    const q = S.cleanQuote({ supplier: 'MAC Surgical', quoteNumber: '00012501', quoteDate: '2026-10-21',
      lines: [{ code: 'MACTM28500', description: 'Kwire 3.2x500mm', quantity: '10', unitPrice: '198' }, { description: '' }],
      totalExGst: 1980, checks: ['Description says 3.2mm but the order is for 2.78mm wires'] },
    { subject: 'Re: Kwire project', text: 'updated PO-0147' })
    expect(q).toMatchObject({ poNumber: 'PO-0147', lines: [{ code: 'MACTM28500', quantity: 10, unitPrice: 198 }], totalExGst: 1980 })
    expect(q.lines).toHaveLength(1)
    expect(q.checks[0]).toMatch(/2\.78/)
  })
})

describe('saving the PO in Xero', () => {
  const lines = [{ code: 'MACTM28500', description: 'Kwire 2.78 x 500mm', quantity: 10, unitPrice: 198 }]

  it('updates the named PO: new lines, same account and tax, quote in the reference, status untouched', async () => {
    const xero = vi.fn(async (method, path, body) => {
      if (method === 'GET') return { PurchaseOrders: [PO147] }
      return { PurchaseOrders: [{ ...PO147, ...body.PurchaseOrders[0], SubTotal: 1980, Total: 2178 }] }
    })
    const { po, record } = await S.saveSupplierPo({ messageId: 'msg123456', update: 'PO-0147', lines, quoteNumber: '00012501', by: 'brenton@technomed.com.au' }, xero)
    const [, path, body] = xero.mock.calls.at(-1)
    expect(path).toBe('/PurchaseOrders/po-147')
    expect(body.PurchaseOrders[0]).not.toHaveProperty('Status')
    expect(body.PurchaseOrders[0].Reference).toBe('K-Wires — as per quote 00012501')
    expect(body.PurchaseOrders[0].LineItems).toEqual([{ Description: 'MACTM28500 — Kwire 2.78 x 500mm', Quantity: 10, UnitAmount: 198, AccountCode: '310', TaxType: 'INPUT' }])
    expect(po).toMatchObject({ number: 'PO-0147', total: 2178 })
    expect(record.status).toBe('updated')
    expect(JSON.parse(store.get('supplierpo:msg123456'))).toMatchObject({ status: 'updated', po: 'PO-0147' })
  })

  it('never changes a PO already billed', async () => {
    const xero = vi.fn(async () => ({ PurchaseOrders: [{ ...PO147, Status: 'BILLED' }] }))
    await expect(S.saveSupplierPo({ messageId: 'msg123457', update: 'PO-0147', lines }, xero)).rejects.toThrow(/billed/)
    expect(xero.mock.calls.every(c => c[0] === 'GET')).toBe(true)
  })

  it('a new PO is always a DRAFT, with freight as its own line', async () => {
    const xero = vi.fn(async (method, path, body) => ({ PurchaseOrders: [{ PurchaseOrderID: 'new', PurchaseOrderNumber: 'PO-0158', Status: 'DRAFT', Total: 2205.5, ...body.PurchaseOrders[0] }] }))
    const { po } = await S.saveSupplierPo({ messageId: 'msg123458', contactId: 'mac', lines, freight: 25, reference: 'K-Wires', quoteNumber: '00012501' }, xero)
    const sent = xero.mock.calls[0][2].PurchaseOrders[0]
    expect(sent).toMatchObject({ Status: 'DRAFT', Contact: { ContactID: 'mac' }, Reference: 'K-Wires — as per quote 00012501' })
    expect(sent.LineItems.at(-1)).toMatchObject({ Description: 'Freight', UnitAmount: 25 })
    expect(po.number).toBe('PO-0158')
  })

  it('refuses a line with no price or quantity rather than drafting $0', () => {
    expect(() => S.poLines([{ description: 'K-wire', quantity: 10, unitPrice: '' }])).toThrow(/price/)
    expect(() => S.poLines([{ description: 'K-wire', quantity: 0, unitPrice: 5 }])).toThrow(/quantity/)
  })
})
