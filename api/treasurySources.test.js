import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

// ─── Treasury: reading the outside sources ───────────────────────────────────
// Xero's report shapes, the on-chain feed and the price, all from invented
// responses. And the rule that matters most: nothing here can write to Xero.

const store = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, ...args) => {
    if (cmd === 'get') return store.get(args[0]) ?? null
    if (cmd === 'set') { store.set(args[0], args[1]); return 'OK' }
    if (cmd === 'del') { store.delete(args[0]); return 1 }
    return 'OK'
  }),
  redisSetBody: vi.fn(async (k, v) => { store.set(k, v); return 'OK' })
}))

const xero = await import('./_treasuryXero.js')
const onchain = await import('./_treasuryOnchain.js')
const price = await import('./_treasuryPrice.js')
const { encrypt, decrypt } = await import('./_treasuryCrypto.js')

beforeEach(() => {
  store.clear()
  process.env.TREASURY_ENC_KEY = randomBytes(32).toString('base64')
})

describe('read-only toward Xero', () => {
  const source = readFileSync(join(__dirname, '_treasuryXero.js'), 'utf8')

  it('the accounting API is only ever sent a GET', () => {
    expect(source).not.toMatch(/method:\s*['"](PUT|PATCH|DELETE)['"]/i)
    // The one POST is the OAuth token exchange, to identity.xero.com.
    const posts = [...source.matchAll(/method:\s*['"]POST['"]/gi)]
    expect(posts).toHaveLength(1)
    const tokenFn = source.slice(source.indexOf('async function tokenRequest'), source.indexOf('/** Picks TechnoMed'))
    expect(tokenFn).toMatch(/method: 'POST'/)
    expect(tokenFn).toMatch(/identity\.xero\.com\/connect\/token/)
    expect(source.match(/api\.xro\/2\.0/g)).toHaveLength(1)
  })

  it('asks for read scopes only', () => {
    for (const s of xero.DEFAULT_SCOPES) expect(s === 'offline_access' || s.endsWith('.read')).toBe(true)
  })

  it('no route in the treasury writes to Xero either', () => {
    const route = readFileSync(join(__dirname, 'treasury.js'), 'utf8')
    expect(route).not.toMatch(/api\.xero\.com|xeroGet/)
  })
})

describe('Xero shapes', () => {
  it('picks TechnoMed out of several organisations', () => {
    const t = xero.chooseTenant([{ tenantId: '1', tenantName: 'Other Co', tenantType: 'ORGANISATION' }, { tenantId: '2', tenantName: 'TechnoMed Pty Ltd', tenantType: 'ORGANISATION' }])
    expect(t.tenantId).toBe('2')
    expect(xero.chooseTenant([{ tenantId: '1', tenantName: 'Other' }, { tenantId: '3', tenantName: 'Else' }])).toBe(null)
  })

  it('bank summary closing balances', () => {
    const body = { Reports: [{ Rows: [
      { RowType: 'Header', Cells: [{ Value: 'Bank Accounts' }, { Value: 'Opening Balance' }, { Value: 'Cash Received' }, { Value: 'Cash Spent' }, { Value: 'Closing Balance' }] },
      { RowType: 'Section', Rows: [
        { RowType: 'Row', Cells: [{ Value: 'Cheque' }, { Value: '1.00' }, { Value: '0' }, { Value: '0' }, { Value: '1000.50' }] },
        { RowType: 'Row', Cells: [{ Value: 'Saver' }, { Value: '0' }, { Value: '0' }, { Value: '0' }, { Value: '2,000.00' }] },
        { RowType: 'SummaryRow', Cells: [{ Value: 'Total' }, { Value: '' }, { Value: '' }, { Value: '' }, { Value: '3000.50' }] }
      ] }
    ] }] }
    expect(xero.parseBankSummary(body)).toEqual({ accounts: [{ name: 'Cheque', balance: 1000.5 }, { name: 'Saver', balance: 2000 }], total: 3000.5 })
  })

  it('profit and loss totals', () => {
    const body = { Reports: [{ Rows: [
      { RowType: 'Section', Title: 'Income', Rows: [{ RowType: 'SummaryRow', Cells: [{ Value: 'Total Trading Income' }, { Value: '500000' }] }] },
      { RowType: 'Section', Rows: [{ RowType: 'Row', Cells: [{ Value: 'Gross Profit' }, { Value: '300000' }] }] },
      { RowType: 'Section', Rows: [{ RowType: 'SummaryRow', Cells: [{ Value: 'Total Operating Expenses' }, { Value: '200000' }] }] },
      { RowType: 'Section', Rows: [{ RowType: 'Row', Cells: [{ Value: 'Net Profit' }, { Value: '100000' }] }] }
    ] }] }
    expect(xero.parseProfitAndLoss(body)).toEqual({ income: 500000, grossProfit: 300000, expenses: 200000, netProfit: 100000 })
  })

  it('outstanding invoices by when they fall due', () => {
    const s = xero.summariseOutstanding([
      { InvoiceNumber: 'A', AmountDue: 100, DueDateString: '2026-10-01T00:00:00' },
      { InvoiceNumber: 'B', AmountDue: 200, DueDate: `/Date(${Date.UTC(2026, 10, 20)}+0000)/` },
      { InvoiceNumber: 'C', AmountDue: 400, DueDateString: '2027-03-01T00:00:00' },
      { InvoiceNumber: 'D', AmountDue: 0, DueDateString: '2026-11-03T00:00:00' }
    ], '2026-11-02')
    expect(s).toMatchObject({ total: 700, count: 3, overdue: 100, overdueCount: 1, due30: 200, due30Count: 1 })
  })

  it('invoices raised this month and last, leaving drafts and voids out', () => {
    const r = xero.summariseRaised([
      { DateString: '2026-11-01T00:00:00', Total: 110, SubTotal: 100, Status: 'AUTHORISED' },
      { DateString: '2026-10-15T00:00:00', Total: 220, SubTotal: 200, Status: 'PAID' },
      { DateString: '2026-10-16T00:00:00', Total: 999, SubTotal: 999, Status: 'VOIDED' }
    ], '2026-11-02')
    expect(r.thisMonth).toMatchObject({ month: '2026-11', count: 1, total: 110 })
    expect(r.lastMonth).toMatchObject({ month: '2026-10', count: 1, exGst: 200 })
  })

  it('the financial year starts on 1 July', () => {
    expect(xero.fyStart('2026-11-02')).toBe('2026-07-01')
    expect(xero.fyStart('2027-03-02')).toBe('2026-07-01')
  })

  it('a figure Xero will not give comes back as the last one, marked stale', async () => {
    store.set('treasury:xero:cache:bank', encrypt({ data: { total: 5 }, fetchedAt: '2026-01-01T00:00:00.000Z' }))
    const out = await xero.xeroFigures({ today: '2026-11-02', fetchImpl: async () => { throw new Error('down') } })
    expect(out.figures.bank).toMatchObject({ data: { total: 5 }, stale: true, problem: 'Xero is not connected' })
    expect(out.figures.profit).toBe(null)
  })
})

describe('on-chain', () => {
  it('reads the shapes the source might send', () => {
    expect(onchain.parseSeries([{ d: '2026-01-02', unixTs: '1767312000', mvrv: '1.5' }, { d: '2026-01-01', mvrv: 1.4 }]))
      .toEqual([['2026-01-01', 1.4], ['2026-01-02', 1.5]])
    expect(onchain.parseSeries({ data: [{ date: '2026-01-01T00:00:00Z', value: '2' }] })).toEqual([['2026-01-01', 2]])
    expect(onchain.parseSeries([{ d: '2026-01-01', sthSopr: null }])).toEqual([])
  })

  it('never spends more requests than the budget allows', () => {
    const now = Date.UTC(2026, 10, 2)
    expect(onchain.budgetLeft([], now)).toBe(onchain.MAX_PER_HOUR)
    expect(onchain.budgetLeft(Array(8).fill(now - 60e3), now)).toBe(0)
    expect(onchain.budgetLeft(Array(15).fill(now - 3 * 3600e3), now)).toBe(0)
    expect(onchain.planRun({}, 3, now)).toHaveLength(3)
  })

  it('takes the metrics most in need first, and leaves fresh ones alone', () => {
    const now = Date.UTC(2026, 10, 2)
    const meta = Object.fromEntries(Object.keys(onchain.METRICS).map(k => [k, { fetchedAt: new Date(now - 3600e3).toISOString() }]))
    meta.sthSopr = { fetchedAt: new Date(now - 2 * 86400e3).toISOString() }
    delete meta.mvrv
    expect(onchain.planRun(meta, 8, now)).toEqual(['mvrv', 'sthSopr'])
  })

  it('extends a ratio from price and cost basis where its own series stops', () => {
    const r = onchain.extendRatio([['2026-01-01', 1.5]], [['2026-01-01', 150], ['2026-01-02', 160]], [['2026-01-02', 100]])
    expect(r).toEqual({ series: [['2026-01-01', 1.5], ['2026-01-02', 1.6]], derived: 1 })
  })

  it('a run stores what it got, records what failed, and falls back to Kraken for price', async () => {
    const fetchImpl = vi.fn(async url => {
      if (url.includes('kraken')) return { ok: true, status: 200, json: async () => ({ result: { XXBTZUSD: [[1767225600, '0', '0', '0', '99000']], last: 1 } }) }
      if (url.includes('/v1/mvrv-zscore')) return { ok: false, status: 429, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => (url.includes('btc-price') ? [] : [{ d: '2026-01-01', v: '1.1' }]) }
    })
    const out = await onchain.syncOnchain({ fetchImpl, now: Date.UTC(2026, 0, 2) })
    expect(out.fetched).toHaveLength(onchain.PER_RUN)
    const { series, meta } = await onchain.readOnchain()
    expect(series.price).toEqual([['2026-01-01', 99000]])
    expect(meta.price.source).toBe('Kraken (backup)')
    if (out.fetched.includes('mvrvZ')) expect(meta.mvrvZ.error).toBe('rate limited')
  })
})

describe('price', () => {
  it('Kraken, matched by currency rather than key', () => {
    const p = price.parseKraken({ error: [], result: { XBTAUD: { c: ['150000.1', '1'] }, XXBTZUSD: { c: ['99000.5', '1'] } } })
    expect(p).toMatchObject({ aud: 150000.1, usd: 99000.5, source: 'Kraken' })
  })

  it('CoinGecko when Kraken fails, the last good price when both do', async () => {
    const gecko = vi.fn(async url => url.includes('kraken')
      ? { ok: false, status: 503 }
      : { ok: true, json: async () => ({ bitcoin: { aud: 1, usd: 2, last_updated_at: 1767225600 } }) })
    const p = await price.getPrice({ fetchImpl: gecko })
    expect(p).toMatchObject({ source: 'CoinGecko', aud: 1, stale: false })
    const down = await price.getPrice({ fetchImpl: async () => { throw new Error('x') }, now: Date.now() + 120e3 })
    expect(down).toMatchObject({ aud: 1, stale: true })
  })
})

describe('encryption', () => {
  it('round-trips, and refuses a value that has been tampered with', () => {
    const sealed = encrypt({ a: 1 })
    expect(decrypt(sealed)).toEqual({ a: 1 })
    const parts = sealed.split('.')
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('A') ? 'BB' : 'AA')
    expect(() => decrypt(parts.join('.'))).toThrow()
  })
})

describe('the 24-hour change and the daily closes', () => {
  it('takes the close of the hour 24 hours back', () => {
    const body = { result: { XBTAUD: [[1000, '0', '0', '0', '90'], [4600, '0', '0', '0', '95'], [8200, '0', '0', '0', '99']], last: 1 } }
    expect(price.closeAt(body, 5000 * 1000)).toBe(95)
    expect(price.closeAt(body, 500 * 1000)).toBe(null)
  })

  it('reads daily candles into [date, close]', () => {
    expect(price.dailyCloses({ result: { XXBTZUSD: [[1767225600, '0', '0', '0', '99000']], last: 1 } })).toEqual([['2026-01-01', 99000]])
  })

  it('history falls back to what is stored, marked stale', async () => {
    const h = await price.getPriceHistory({ fetchImpl: async () => { throw new Error('down') } })
    expect(h).toMatchObject({ aud: [], stale: true })
  })
})
