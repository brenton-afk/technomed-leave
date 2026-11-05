import { describe, it, expect } from 'vitest'
import {
  parseCashReport, rowsFromItems, classify, mergeReport, holdingsFrom, incomeByYear, conversionsByYear,
  suggestOpenings, suggestConsolidations, readReportDate, readMoney
} from './selfwealth.js'

// An invented SelfWealth cash report, laid out as the PDF's text comes out:
// page, x, y (upwards) and text. Never the real reports.
let y = 700
const items = [
  { p: 1, x: 33, y: 760, s: 'Account:' },
  { p: 1, x: 70, y: 760, s: 'MR TEST + MRS TEST <TEST FAMILY A/C>' },
  { p: 1, x: 164, y: 720, s: 'Opening Balance' },
  { p: 1, x: 514, y: 720, s: '$100.00' }
]
function row(date, desc, credit, debit, balance, wrap) {
  y -= 30
  items.push({ p: 1, x: 60, y, s: date }, { p: 1, x: 164, y, s: desc })
  if (wrap) items.push({ p: 1, x: 164, y: y - 10, s: wrap })
  if (credit) items.push({ p: 1, x: 384, y, s: credit })
  if (debit) items.push({ p: 1, x: 455, y, s: debit })
  items.push({ p: 1, x: 513, y, s: balance })
}
row('1 July 2025 10:00:00', 'Transfer 1,000.00 AUD TO USD. 1 AUD =', '$650.00', null, '$750.00', '0.650000 USD')
row('2 July 2025 23:30:01', 'Order 1: Buy 20 MSTY @ $30.00', null, '$600.00', '$150.00')
row('2 July 2025 23:30:07', 'Order 1: Brokerage BUY MSTY', null, '$9.50', '$140.50')
row('8 July 2025 00:00:00', '120 MSTY CASHDIV @ USD 1.00', '$120.00', null, '$260.50')
row('8 July 2025 00:00:00', 'WHT 120 MSTY CASHDIV @ USD 1.00', null, '$18.00', '$242.50')
row('8 July 2025 00:00:00', 'Cash Div Fee 120 MSTY CASHDIV @ USD', null, '$1.50', '$241.00', '1.00')
row('5 Aug 2025 00:00:00', 'CASH DIV @ USD 1.00 LESS TAX 15% 120 YieldMax MSTR Option Income Strategy', '$120.00', null, '$361.00')
row('5 Aug 2025 00:00:00', 'CASH DIV @ USD 1.00 LESS TAX 15% 120 YieldMax MSTR Option Income Strategy', null, '$18.00', '$343.00')
row('5 Aug 2025 00:00:00', 'CASH DIV @ USD 1.00 LESS TAX 15% 120 YieldMax MSTR Option Income Strategy', null, '$1.50', '$341.50')
row('1 Dec 2025 00:00:00', '30 MSTY CASHDIV @ USD 4.00', '$120.00', null, '$461.50')
row('12 July 2026 20:34:14', 'Convert 400.00 USD to AUD. Estimate 1 USD =', null, '$400.00', '$61.50', '1.500000 AUD')
row('15 Sept 2026 00:00:00', '120 MSTY TAX REFUND @ USD 0.15', '$18.00', null, '$79.50')
items.push({ p: 1, x: 164, y: y - 30, s: 'Closing Balance at end of day 30 June 2027' }, { p: 1, x: 513, y: y - 30, s: '$79.50' })
items.push({ p: 1, x: 550, y: 17, s: 'Page: 1 of 1' })

describe('reading the report', () => {
  const r = parseCashReport(items)

  it('finds every row, joins wrapped descriptions, and checks the balances', () => {
    expect(r.rows).toHaveLength(12)
    expect(r.rows[0].desc).toBe('Transfer 1,000.00 AUD TO USD. 1 AUD = 0.650000 USD')
    expect(r).toMatchObject({ opening: 100, closing: 79.5, reconciles: true, breaks: [], currency: 'USD', account: 'MR TEST + MRS TEST <TEST FAMILY A/C>' })
  })

  it('says when a row was missed', () => {
    const missing = items.filter(i => i.s !== '$600.00' && i.s !== 'Order 1: Buy 20 MSTY @ $30.00' && !(i.y === 640 && i.x === 60))
    expect(parseCashReport(missing).reconciles).toBe(false)
  })

  it('reads all three wordings SelfWealth has used', () => {
    expect(r.rows.map(x => x.kind)).toEqual([
      'from_aud', 'buy', 'brokerage', 'distribution', 'withholding', 'divfee',
      'distribution', 'withholding', 'divfee', 'distribution', 'to_aud', 'refund'
    ])
    expect(classify('Order 54: Buy 64 MSTR @ US$119.32')).toMatchObject({ kind: 'buy', units: 64, ticker: 'MSTR', price: 119.32 })
    expect(classify('3537 MSTY CASHDIV @ USD 0.1549 (WITH HOLDING TAX)')).toMatchObject({ kind: 'withholding', units: 3537 })
    expect(classify('CASH DIV @ USD 1 LESS TAX 15% 7483 YieldMax MSTR Option Income Strategy ETF')).toMatchObject({ ticker: 'MSTY' })
    expect(classify('Something new')).toEqual({ kind: 'other' })
  })

  it('a newer overlapping report adds only new rows', () => {
    const first = mergeReport([], r.rows.slice(0, 5))
    expect(mergeReport(first.rows, r.rows).added).toBe(7)
    expect(mergeReport(mergeReport(first.rows, r.rows).rows, r.rows).added).toBe(0)
  })

  it('reads dates and amounts as printed', () => {
    expect(readReportDate('4 Sept 2026 09:51:46')).toEqual({ date: '2026-09-04', at: '2026-09-04T09:51:46' })
    expect(readMoney('-$74.59')).toBe(-74.59)
    expect(readMoney('$1,288.88')).toBe(1288.88)
  })

  it('a row with no date is not a row', () => {
    expect(rowsFromItems([{ p: 1, x: 164, y: 500, s: 'stray' }]).rows).toEqual([])
  })
})

describe('the investments', () => {
  const { rows } = parseCashReport(items)

  it('sees units held before the first report, and a consolidation, from the distributions', () => {
    const openings = suggestOpenings(rows)
    expect(openings).toEqual([{ ticker: 'MSTY', units: 100, date: '2025-07-01' }])
    const actions = suggestConsolidations(rows, openings)
    expect(actions).toEqual([{ ticker: 'MSTY', date: '2025-12-01', ratio: 4, before: 120, after: 30 }])
    const [h] = holdingsFrom(rows, openings.map(o => ({ ...o, costUsd: 2000 })), actions)
    expect(h).toMatchObject({ ticker: 'MSTY', units: 30, costUsd: 2609.5, lastDistUnits: 30, unitsGap: 0 })
  })

  it('income by financial year, withholding and refunds apart', () => {
    expect(incomeByYear(rows)).toEqual([
      expect.objectContaining({ fy: 'FY27', ticker: 'MSTY', gross: 0, refunds: 18, net: 18 }),
      expect.objectContaining({ fy: 'FY26', ticker: 'MSTY', gross: 360, withholding: 36, fees: 3, payments: 3, net: 321 })
    ])
  })

  it('money moved between the dollars', () => {
    expect(conversionsByYear(rows)).toEqual([
      { fy: 'FY27', toAudUsd: 400, toAudAud: 600, fromAudAud: 0, fromAudUsd: 0 },
      { fy: 'FY26', toAudUsd: 0, toAudAud: 0, fromAudAud: 1000, fromAudUsd: 650 }
    ])
  })
})

describe('the A$ account', () => {
  // An invented A$ cash report: money arrives from the US$ side, then two ASX buys.
  let y = 700
  const items = [{ p: 1, x: 164, y: 720, s: 'Opening Balance' }, { p: 1, x: 514, y: 720, s: '$10.00' }]
  const row = (date, desc, credit, debit, balance, wrap) => {
    y -= 30
    items.push({ p: 1, x: 60, y, s: date }, { p: 1, x: 164, y, s: desc })
    if (wrap) items.push({ p: 1, x: 164, y: y - 10, s: wrap })
    if (credit) items.push({ p: 1, x: 384, y, s: credit })
    if (debit) items.push({ p: 1, x: 455, y, s: debit })
    items.push({ p: 1, x: 513, y, s: balance })
  }
  row('12 July 2026 20:34:14', 'Convert 500.00 USD to AUD. Estimate 1 USD =', '$750.00', null, '$760.00', '1.500000 AUD')
  row('14 July 2026 10:00:01', 'Order 7: Buy 10 SLVX @ $50.00', null, '$500.00', '$260.00')
  row('14 July 2026 10:00:05', 'Order 7: Brokerage BUY SLVX', null, '$9.50', '$250.50')
  row('15 July 2026 10:00:01', 'Order 8: Buy 4 GLDX @ $50.00', null, '$200.00', '$50.50')
  items.push({ p: 1, x: 164, y: y - 30, s: 'Closing Balance at end of day 30 June 2027' }, { p: 1, x: 513, y: y - 30, s: '$50.50' })
  const r = parseCashReport(items)

  it('is read as A$ although it carries a conversion from US$, which it does not count again', () => {
    expect(r).toMatchObject({ currency: 'AUD', reconciles: true })
    expect(r.rows[0].kind).toBe('fx_in')
    expect(conversionsByYear(r.rows)).toEqual([])
  })

  it('gives the ASX holdings in A$, with brokerage', () => {
    const h = holdingsFrom(r.rows.map(x => ({ ...x, currency: r.currency })))
    expect(h.map(x => [x.ticker, x.currency, x.units, x.costUsd])).toEqual([['GLDX', 'AUD', 4, 200], ['SLVX', 'AUD', 10, 509.5]])
  })

  it('a US$ report with a conversion out is still US$', () => {
    const usd = parseCashReport(items.map(i => (i.s === '$750.00' ? { ...i, x: 455, s: '$500.00' } : i)))
    expect(usd.currency).toBe('USD')
  })
})
