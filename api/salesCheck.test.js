import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ExcelJS from 'exceljs'

// Brent, 9 Nov 2026: "You need to be able to cross check with the portal."
// A distributor's sales report is matched invoice by invoice to the portal's
// usage records, then the bookings calendar. Every name and number here is
// invented.

const store = new Map()
const log = []
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, ...a) => {
    if (cmd === 'lrange' && a[0] === 'usage:all') return store.get('usage:all') || []
    if (cmd === 'mget') return a.map(k => store.get(k) ?? null)
    if (cmd === 'lpush' && a[0] === 'agent:log') { log.push(JSON.parse(a[1])); return 1 }
    return null
  })
}))
vi.mock('./_googleCalendar.js', () => ({
  getGoogleToken: vi.fn(async () => 't'), getCalendarId: () => 'cal', CALENDAR_SCOPE_READONLY: 'ro'
}))

const S = await import('./_salesCheck.js')

/** A report laid out the way Signus lays theirs out. */
async function signusReport(rows) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet')
  ws.getCell('M1').value = 2026
  ws.getRow(3).values = ['Branch', 'Customer Group', 'Customer', 'Customer Account Number', 'InvoiceDate', 'Invoice No',
    'Product Type', 'Code', 'Product', 'BatchNumbers', 'Carrier', 'Project Name', 'Qty', 'Sales']
  rows.forEach((r, i) => {
    ws.getRow(4 + i).values = ['213 TEST', 'TAS', r.customer, '04X', r.date, r.invoice, r.type, r.code, r.product, '', r.surgeon, r.patient, r.qty, r.sales]
  })
  const last = 3 + rows.length
  ws.getCell(`A${last + 1}`).value = 'Grand Total'
  ws.getCell(`N${last + 1}`).value = { formula: `SUM(N4:N${last})` }
  ws.getCell(`A${last + 3}`).value = { formula: `N${last + 1}*30%` }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

const CLV = 'Calvary Health Care Tasmania'
const RHH = 'Royal Hobart Hospital'
const rows = [
  { customer: CLV, date: '01/10/2026', invoice: 9001, type: 'Diplomat', code: 'AB0010-55001', product: 'DIPLOMAT Tulip', surgeon: 'IBBETT', patient: 'SAMPLEA', qty: 4, sales: 2744 },
  { customer: CLV, date: '01/10/2026', invoice: 9001, type: 'Diplomat', code: 'MACNIT18470 R/R', product: 'Nitinol k-wire', surgeon: 'IBBETT', patient: 'SAMPLEA', qty: 1, sales: 200 },
  { customer: CLV, date: '06/10/2026', invoice: 9002, type: 'Diplomat', code: 'AB0010-55001', product: 'DIPLOMAT Tulip', surgeon: 'IBBETT', patient: 'SAMPLEB', qty: 5, sales: 3087 },
  { customer: RHH, date: '06/10/2026', invoice: 9003, type: 'Diplomat', code: 'MACNIT18470 R/R', product: 'Nitinol k-wire', surgeon: 'FOWLER', patient: 'SAMPLEC', qty: 1, sales: 150 },
  { customer: RHH, date: '19/10/2026', invoice: 9004, type: 'Athlet', code: 'H3-056', product: 'ASCOT plate', surgeon: 'ATALLAH', patient: 'SAMPLED', qty: 1, sales: 1419 },
  { customer: CLV, date: '27/10/2026', invoice: 9005, type: 'Diplomat', code: 'AB0155-41058', product: 'DIPLOMAT cross connector', surgeon: 'THANI', patient: 'SAMPLEA', qty: 1, sales: 1136 }
]

const usage = (id, date, patient, surgeon, hospital, items) => ({
  id, date, patientSurname: patient, surgeonSurname: surgeon, hospital, procedure: 'PLIF',
  items: items.map(([referenceCode, quantity, distributorKey = 'signus']) => ({ referenceCode, quantity, productName: 'x', distributorKey })),
  emailsSent: [{ key: 'signus', ok: true }]
})

beforeEach(() => {
  store.clear(); log.length = 0
  const cases = [
    usage('u1', '2026-09-22', 'Samplea', 'Ibbett', 'Calvary', [['AB0010-55001', 4], ['MACNIT18470', 1]]),
    usage('u2', '2026-09-29', 'Sampleb', 'Ibbett', 'Calvary', [['AB0010-55001', 4]]),
    usage('u3', '2026-09-28', 'Samplec', 'Fowler', 'RHH', [['MACNIT18470', 1]]),
    usage('u9', '2026-09-30', 'Samplez', 'Thani', 'Calvary', [['AB0140-55000', 8]]),
    usage('u10', '2026-10-20', 'Sampley', 'Thani', 'Calvary', [['AB0140-55000', 8]]),
    usage('u11', '2026-09-30', 'Samplex', 'Thani', 'Calvary', [['DAKOTA-1', 1, 'e4']])
  ]
  store.set('usage:all', cases.map(c => c.id))
  for (const c of cases) store.set(`usage:${c.id}`, JSON.stringify(c))
})

const bookings = async () => ([
  { date: '2026-10-08', patient: 'Sampled', surgeon: 'Gupta', hospital: 'RHH', cancelled: false },
  { date: '2026-10-02', patient: 'Sampleb', surgeon: 'Ibbett', hospital: 'CLV', cancelled: true }
])

describe('reading a sales report', () => {
  it('finds the header by what it says and skips the total rows', async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await signusReport(rows))
    const { headerRow, lines } = S.readReport(wb.worksheets[0])
    expect(headerRow).toBe(3)
    expect(lines).toHaveLength(6)
    expect(lines[0]).toMatchObject({ invoice: '9001', invoiceDate: '2026-10-01', hospital: 'CLV', patient: 'SAMPLEA', qty: 4, sales: 2744 })
  })

  it('refuses a workbook that is not a sales report', async () => {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('x').getRow(1).values = ['Name', 'Amount']
    await expect(S.checkSalesReport(Buffer.from(await wb.xlsx.writeBuffer()), { loadCases: async () => [], loadBookings: async () => [] }))
      .rejects.toThrow(/does not look like a sales report/)
  })
})

describe('checking it against the portal', () => {
  it('dates every invoice from the usage, then the calendar, and says what to check', async () => {
    const r = await S.checkSalesReport(await signusReport(rows), { loadBookings: bookings })
    const by = Object.fromEntries(r.invoices.map(i => [i.invoice, i]))
    expect(r.distributor).toBe('Signus')
    expect(by['9001']).toMatchObject({ surgeryDate: '2026-09-22', source: 'Portal usage' })
    // A code read slightly differently off the form still counts as the same.
    expect(by['9001'].checks.join()).not.toMatch(/MACNIT.*not on the usage/)
    // Five billed, four on the usage — and a discount against the same hospital.
    expect(by['9002'].checks.join(' | ')).toMatch(/AB0010-55001: 5 billed, 4 on the usage/)
    expect(by['9002'].checks.join(' | ')).toMatch(/\$617\.40 each against \$686\.00 elsewhere at CLV/)
    // RHH's K-wire price is RHH's, not a discount on Calvary's.
    expect(by['9003'].checks.join()).not.toMatch(/each against/)
    // No usage: the calendar's date, and the surgeon disagreement said.
    expect(by['9004']).toMatchObject({ surgeryDate: '2026-10-08', source: 'Bookings calendar' })
    expect(by['9004'].checks.join(' | ')).toMatch(/No usage record/)
    expect(by['9004'].checks.join(' | ')).toMatch(/report is ATALLAH; the booking says Gupta/)
    // A late item a month on is put with its case, and both invoices say so.
    expect(by['9005'].surgeryDate).toBe('2026-09-22')
    expect(by['9005'].checks.join()).toMatch(/also on invoice 9001/)
    expect(by['9005'].checks.join()).toMatch(/Surgeon on the report is THANI/)
  })

  it('lists the distributor\'s cases that no invoice covers, and only theirs', async () => {
    const r = await S.checkSalesReport(await signusReport(rows), { loadBookings: bookings })
    expect(r.notBilled.map(c => c.patient)).toEqual(['Samplez', 'Sampley'])
    expect(r.notBilled[0].note).toMatch(/Missing from this report/)
    expect(r.notBilled[1].note).toMatch(/probably next month/)
  })

  it('hands back the same spreadsheet with three columns added and its formulas intact', async () => {
    const r = await S.checkSalesReport(await signusReport(rows), { loadBookings: bookings })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(r.file, 'base64'))
    const ws = wb.worksheets[0]
    expect(ws.getRow(3).getCell(15).value).toBe('Surgery Date')
    expect(ws.getRow(3).getCell(16).value).toBe('Found in')
    expect(ws.getRow(3).getCell(17).value).toBe('Check')
    expect(ws.getCell('O4').value.toISOString().slice(0, 10)).toBe('2026-09-22')
    expect(ws.getCell('O4').numFmt).toBe('dd/mm/yyyy')
    expect(ws.getCell('N10').value.formula).toBe('SUM(N4:N9)')
    expect(ws.getCell('A12').value.formula).toBe('N10*30%')
    expect(wb.getWorksheet('Not on this report').getCell('B2').value).toBe('Samplez')
  })
})

describe('the read-only key', () => {
  const OLD = process.env.AGENT_READ_KEY
  const KEY = 'k'.repeat(40)
  afterEach(() => { process.env.AGENT_READ_KEY = OLD })
  const call = async (query, headers = {}, method = 'GET') => {
    const { default: handler } = await import('./agent.js')
    const res = { code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
    await handler({ query, headers, method, body: {} }, res)
    return res
  }

  it('does not exist without a long enough key set', async () => {
    process.env.AGENT_READ_KEY = 'short'
    expect((await call({ action: 'usage' })).code).toBe(404)
  })

  it('refuses a wrong key, and logs it', async () => {
    process.env.AGENT_READ_KEY = KEY
    expect((await call({ action: 'usage' }, { authorization: 'Bearer nope' })).code).toBe(401)
    expect(log.at(-1)).toMatchObject({ ok: false, reason: 'bad key' })
  })

  it('reads usage cases in a window — codes, never lot numbers', async () => {
    process.env.AGENT_READ_KEY = KEY
    store.set('usage:u1', JSON.stringify({ ...JSON.parse(store.get('usage:u1')), items: [{ referenceCode: 'AB1', lotNumber: 'LOT-SECRET', quantity: 1, productName: 'x' }] }))
    const res = await call({ action: 'usage', from: '2026-09-01', to: '2026-09-30' }, { authorization: `Bearer ${KEY}` })
    expect(res.code).toBe(200)
    expect(res.body.cases.map(c => c.id).sort()).toEqual(['u1', 'u11', 'u2', 'u3', 'u9'])
    expect(JSON.stringify(res.body)).not.toMatch(/LOT-SECRET/)
    expect(log.at(-1)).toMatchObject({ action: 'usage', ok: true, count: 5 })
  })

  it('will not do anything else', async () => {
    process.env.AGENT_READ_KEY = KEY
    expect((await call({ action: 'save' }, { authorization: `Bearer ${KEY}` }, 'POST')).code).toBe(400)
    expect((await call({ action: 'usage', from: '2025-01-01', to: '2026-09-30' }, { authorization: `Bearer ${KEY}` })).code).toBe(400)
  })
})
