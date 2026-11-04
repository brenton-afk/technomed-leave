import { describe, it, expect } from 'vitest'
import { readDay, linesFromItems, isAnnualStatement, parseAnnualStatement } from './selfwealthAnnual.js'
import { buildLedger, checkAgainstStatements, statementPrices, holdingsFrom, incomeByYear } from './selfwealth.js'

// An invented SelfWealth annual statement (USA), laid out as the PDF's text
// comes out: page, x, y (upwards), text. Never a real statement.
function statement(lines) {
  const items = []
  let y = 780
  for (const cells of lines) {
    y -= 20
    cells.forEach((s, i) => items.push({ p: 1, x: 20 + i * 36, y, s }))
  }
  return items
}
const usa = statement([
  ['USA Detailed Holdings Summary - Period 1 July 2024 - 30 June 2025'],
  ['Holdings Valuation as at 1 July 2024'],
  ['XYZ', 'Xyz Income Fund', '100', '10.00', '1,000.00'],
  ['Transaction History'],
  ['2 Jul 2024', 'Cash Movement', 'S AUD1,000.00 B USD650.00 @FX0.65', 'USD', '650.00', '0.00', '650.00'],
  ['Contracts between 1 July 2024 and 30 June 2025'],
  ['3 Jul 2024', '5 Jul 2024', 'C100', 'BUY', 'XYZ', 'Xyz Income Fund', '50', '12.00', 'USD', '1', '600.00', '9.50', '0.00', '0.00', '609.50'],
  ['Scrip Movement'],
  ['1 Dec 2024', 'XYZ', 'Consolidation', 'Out', '-150'],
  ['1 Dec 2024', 'XYZ', 'Consolidation', 'In', '30'],
  ['Corporate Action Cash Movement'],
  ['15 Dec 2024', 'Xyz Income Fund', 'XYZ CASHDIV @ USD 2.00', '10 Dec 2024', '15 Dec 2024', '30', 'USD', '60.00', '1', '15', '60.00', '9.00', '1.00', '0.00', '50.00'],
  ['Holdings Valuation as at 30 June 2025'],
  ['XYZ', 'Xyz Income Fund', '30', '50.00', '1,500.00'],
  ['Overall Summary']
])

describe('a SelfWealth annual statement', () => {
  const a = parseAnnualStatement(usa)

  it('is recognised, and its period and market read', () => {
    expect(isAnnualStatement(usa)).toBe(true)
    expect(isAnnualStatement([{ s: 'Cash Report' }])).toBe(false)
    expect(a).toMatchObject({ market: 'USA', currency: 'USD', from: '2024-07-01', to: '2025-06-30' })
  })

  it('reads dates as printed, including the long month names', () => {
    expect(readDay('17 Sept 2025')).toBe('2025-09-17')
    expect(readDay('8 July 2025')).toBe('2025-07-08')
    expect(readDay('Sometime')).toBeNull()
  })

  it('rebuilds lines from pieces at the same height', () => {
    const l = linesFromItems([{ p: 1, x: 50, y: 100, s: 'b' }, { p: 1, x: 10, y: 101, s: 'a' }, { p: 1, x: 10, y: 80, s: 'c' }])
    expect(l.map(x => x.cells)).toEqual([['a', 'b'], ['c']])
  })

  it('reads the holdings at both ends of the year', () => {
    expect(a.snapshots).toEqual([
      { date: '2024-07-01', ticker: 'XYZ', name: 'Xyz Income Fund', units: 100, price: 10, value: 1000 },
      { date: '2025-06-30', ticker: 'XYZ', name: 'Xyz Income Fund', units: 30, price: 50, value: 1500 }
    ])
  })

  it('reads trades with settlement date and brokerage', () => {
    const buy = a.rows.find(r => r.kind === 'buy')
    expect(buy).toMatchObject({ ticker: 'XYZ', units: 50, amount: -600, settle: '2024-07-05', currency: 'USD' })
    expect(a.rows.find(r => r.kind === 'brokerage').amount).toBeCloseTo(-9.5)
  })

  it('finds a consolidation from the scrip movement, exactly', () => {
    expect(a.actions).toEqual([{ ticker: 'XYZ', date: '2024-12-01', ratio: 5, source: 'annual', before: 150, after: 30 }])
  })

  it('reads distributions with record date, units paid on, withholding and fees', () => {
    const d = a.rows.find(r => r.kind === 'distribution')
    expect(d).toMatchObject({ ticker: 'XYZ', units: 30, perUnit: 2, recordDate: '2024-12-10', amount: 60 })
    expect(a.rows.find(r => r.kind === 'withholding').amount).toBe(-9)
    expect(a.rows.find(r => r.kind === 'divfee').amount).toBe(-1)
  })

  it('reads a conversion from A$', () => {
    expect(a.rows.find(r => r.kind === 'from_aud')).toMatchObject({ aud: 1000, amount: 650, rate: 0.65 })
  })

  it('says when it is not a statement', () => {
    expect(parseAnnualStatement([{ p: 1, x: 0, y: 0, s: 'Something else' }]).error).toBeTruthy()
  })
})

describe('one ledger from statements and cash reports', () => {
  const a = { ...parseAnnualStatement(usa) }

  it('counts a cash report only after the last statement in its currency', () => {
    const cash = [
      { key: 'old', at: '2024-12-15T00:00:00', date: '2024-12-15', kind: 'distribution', ticker: 'XYZ', units: 30, amount: 60 },
      { key: 'new', at: '2025-07-15T00:00:00', date: '2025-07-15', kind: 'distribution', ticker: 'XYZ', units: 30, amount: 45 }
    ]
    const L = buildLedger(cash, [a])
    const dists = L.rows.filter(r => r.kind === 'distribution')
    expect(dists.map(r => r.amount)).toEqual([60, 45])
    expect(dists[1].source).toBe('cash')
    expect(L.lastTo.USD).toBe('2025-06-30')
  })

  it('checks the ledger against what SelfWealth says was held', () => {
    const L = buildLedger([], [a])
    const opening = [{ ticker: 'XYZ', units: 100, costUsd: 0 }]
    const checks = checkAgainstStatements(L.rows, L.actions, L.snapshots, opening)
    expect(checks.every(c => c.matches)).toBe(true)
    // Without the opening position the start of the year does not match.
    expect(checkAgainstStatements(L.rows, L.actions, L.snapshots, []).some(c => !c.matches)).toBe(true)
    expect(holdingsFrom(L.rows, opening, L.actions).find(h => h.ticker === 'XYZ').units).toBe(30)
  })

  it('takes the latest statement price as a fallback', () => {
    expect(statementPrices(buildLedger([], [a]).snapshots).XYZ).toMatchObject({ price: 50, source: 'statement' })
  })

  it('keeps each holding and its income in its own currency', () => {
    const asx = { currency: 'AUD', from: '2024-07-01', to: '2025-06-30', snapshots: [], actions: [],
      rows: [{ key: 'g', at: '2024-08-01T12:00:00', date: '2024-08-01', kind: 'buy', ticker: 'GLD', units: 10, amount: -300, currency: 'AUD', order: 'g' }] }
    const L = buildLedger([], [a, asx])
    expect(holdingsFrom(L.rows, [], L.actions).find(h => h.ticker === 'GLD').currency).toBe('AUD')
    expect(incomeByYear(L.rows)[0].currency).toBe('USD')
  })
})
