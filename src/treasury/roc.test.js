import { describe, it, expect } from 'vitest'
import { trackRoc, rocShare, makeFx, fyOf, refundShares, discountable, DEFAULT_ROC } from './roc.js'

// Invented trades and distributions. US$ per A$1 is 0.5 throughout, so every
// A$ figure is twice the US$ one and easy to check by eye.
const fx = () => 0.5
const row = (date, kind, extra) => ({ key: `${date}|${kind}|${extra.units ?? ''}`, at: `${date}T00:00:00`, date, kind, ticker: 'MSTY', ...extra })

describe('return of capital, parcel by parcel', () => {
  const rows = [
    row('2025-07-01', 'buy', { units: 100, amount: -1000, order: '1' }),
    { key: 'b1', at: '2025-07-01T00:00:01', date: '2025-07-01', kind: 'brokerage', order: '1', side: 'buy', ticker: 'MSTY', amount: -10 },
    row('2025-07-02', 'distribution', { units: 100, perUnit: 1 }),   // same week: not yet settled for the 1 July buy? 1 day — excluded
    row('2025-07-10', 'distribution', { units: 100, perUnit: 2 }),
    row('2025-08-10', 'buy', { units: 50, amount: -500, order: '2' }),
    row('2026-01-10', 'distribution', { units: 150, perUnit: 4 })
  ]
  const cfg = { tickers: ['MSTY'], years: { 2025: 100, 2026: 50 }, overrides: {} }
  const r = trackRoc({ rows, fx, cfg, today: '2026-02-01' })

  it('turns each buy into a parcel with its cost in A$, brokerage included', () => {
    expect(r.parcels.map(p => [p.date, p.units, p.costAud])).toEqual([['2025-07-01', 100, 2020], ['2025-08-10', 50, 1000]])
  })

  it('reduces the cost base by the return of capital, and only on settled units', () => {
    // 10 July: 100 units × US$2 × 100% = US$200 = A$400.
    // 10 Jan 2026: 50% of US$4 = US$2 a unit = A$4 → 100 units A$400, 50 units A$200.
    const [a, b] = r.parcels
    expect(a.base).toBeCloseTo(2020 - 400 - 400)
    expect(b.base).toBeCloseTo(1000 - 200)
    expect(r.payments.map(p => [p.date, p.pct, p.basis])).toEqual([
      ['2025-07-02', 100, 'year'], ['2025-07-10', 100, 'year'], ['2026-01-10', 50, 'year']
    ])
    expect(r.payments[0].rocAud).toBe(0)
  })

  it('a parcel at nil turns the rest into a capital gain, discounted after 12 months', () => {
    const big = trackRoc({ rows, fx, cfg: { ...cfg, years: { 2025: 100, 2026: 100 } }, today: '2026-02-01' })
    // 10 Jan 2026: A$8 a unit. Parcel one has A$1,620 left on 100 units → A$800 off, no gain yet.
    expect(big.parcels[0].base).toBeCloseTo(820)
    const huge = trackRoc({ rows: [...rows, row('2026-07-15', 'distribution', { units: 150, perUnit: 10 })], fx, cfg: { ...cfg, years: { 2025: 100, 2026: 100 } }, today: '2026-08-01' })
    const [a] = huge.parcels
    // 15 Jul 2026: A$20 a unit → A$2,000 on parcel one, A$820 left of it: gain A$1,180, held over a year.
    expect(a.base).toBe(0)
    expect(a.nilOn).toBe('2026-07-15')
    expect(a.gains).toEqual([{ date: '2026-07-15', fy: 'FY27', amount: expect.closeTo(1180, 6), discount: true }])
    // Parcel two (bought Aug 2025) has A$600 left: A$1,000 on it → A$400 gain, held under a year.
    expect(huge.byFy.find(x => x.fy === 'FY27')).toMatchObject({ rocAud: 1420, gainAud: expect.closeTo(1580, 6), gainDiscount: expect.closeTo(1180, 6) })
  })

  it('a consolidation divides the units and keeps the cost', () => {
    const c = trackRoc({ rows, actions: [{ ticker: 'MSTY', date: '2025-12-01', ratio: 5 }], fx, cfg, today: '2026-02-01' })
    expect(c.parcels.map(p => p.units)).toEqual([20, 10])
    // 10 Jan: 50% of US$4 on 30 units = US$60 = A$120.
    expect(c.payments[2].rocAud).toBeCloseTo(120)
  })

  it('an opening position is a parcel from before the first report', () => {
    const o = trackRoc({ rows, openings: [{ ticker: 'MSTY', units: 10, costUsd: 100 }], fx, cfg, today: '2026-02-01' })
    expect(o.parcels[0]).toMatchObject({ date: '2025-06-30', units: 10, costAud: 200 })
  })

  it('projects when each parcel runs out from the recent average payment', () => {
    expect(r.assumption.weeklyAudPerUnit).toBeGreaterThan(0)
    expect(r.parcels.every(p => p.projectedNil > '2026-02-01')).toBe(true)
  })
})

describe('settings and helpers', () => {
  it('a payment\'s own estimate beats the year', () => {
    const cfg = { years: { 2026: 97 }, overrides: { '2026-01-12': 91.9 } }
    expect(rocShare('2026-01-12', cfg)).toEqual({ pct: 91.9, basis: 'payment' })
    expect(rocShare('2026-01-19', cfg)).toEqual({ pct: 97, basis: 'year' })
    expect(rocShare('2027-01-05', cfg)).toEqual({ pct: null, basis: null })
    expect(rocShare('2026-01-19', { ...cfg, final: ['2026'] })).toEqual({ pct: 97, basis: 'final' })
    expect(rocShare('2026-01-19', cfg, 100)).toEqual({ pct: 100, basis: 'refunded' })
  })

  it('reads the exchange rate for a day from closes in both currencies', () => {
    const f = makeFx([['2026-01-01', 200], ['2026-01-03', 100]], [['2026-01-01', 130], ['2026-01-03', 70]])
    expect(f('2026-01-02')).toBeCloseTo(0.65)
    expect(f('2026-01-05')).toBeCloseTo(0.7)
    expect(f('2025-12-01')).toBeCloseTo(0.65)
    expect(makeFx([], [], 0.66)('2026-01-01')).toBe(0.66)
  })

  it('financial years run July to June', () => {
    expect(fyOf('2026-06-30')).toBe('FY26')
    expect(fyOf('2026-07-01')).toBe('FY27')
  })
})

describe('what is known, and what is not', () => {
  const buy = row('2025-01-02', 'buy', { units: 100, amount: -1000, order: '1', settle: '2025-01-03' })
  const pay = (date, units, perUnit, record) => row(date, 'distribution', { units, perUnit, amount: units * perUnit, recordDate: record })
  const wht = (date, units, amount) => ({ key: `${date}|wht`, at: `${date}T00:00:00`, date, kind: 'withholding', ticker: 'MSTY', units, amount: -amount })
  const refund = (units, amount) => ({ key: `r|${units}|${amount}`, at: '2026-09-15T00:00:00', date: '2026-09-15', kind: 'refund', ticker: 'MSTY', units, amount })
  const rows = [buy, pay('2025-06-09', 100, 1, '2025-06-05'), wht('2025-06-09', 100, 15), pay('2026-02-09', 100, 1, '2026-02-05'), wht('2026-02-09', 100, 15), refund(100, 15)]

  it('a payment whose US withholding was refunded in full counts as return of capital; one with no evidence reduces nothing', () => {
    const r = trackRoc({ rows, fx, cfg: DEFAULT_ROC, today: '2026-10-01' })
    expect(r.payments.map(p => [p.date, p.pct, p.basis])).toEqual([['2025-06-09', 100, 'refunded'], ['2026-02-09', null, null]])
    expect(r.payments[1].rocAud).toBe(0)
    expect(r.byFy.find(x => x.fy === 'FY26')).toMatchObject({ unknownUsd: 100, unknown: 1, grossAud: 200, rocAud: 0 })
    // Nothing is projected without a share typed in for the year.
    expect(r.assumption.pct).toBeNull()
    expect(r.parcels[0].projectedNil).toBeNull()
  })

  it('a refund is matched to its own payment, by units and amount', () => {
    expect([...refundShares(rows).keys()]).toEqual(['2025-06-09|100'])
    expect(refundShares([wht('2025-06-09', 100, 15), refund(100, 14)]).size).toBe(0)
  })

  it('checks each payment was paid on the units the parcels add up to at its record date', () => {
    const r = trackRoc({ rows, fx, cfg: DEFAULT_ROC, today: '2026-10-01' })
    expect(r.checks).toMatchObject({ payments: 2, mismatches: [] })
    const off = trackRoc({ rows: [buy, pay('2025-06-09', 120, 1, '2025-06-05')], fx, cfg: DEFAULT_ROC, today: '2026-10-01' })
    expect(off.checks.mismatches.map(p => [p.eligibleUnits, p.units])).toEqual([[100, 120]])
    // A buy settling after the record date is not paid on.
    const late = trackRoc({ rows: [buy, row('2025-06-04', 'buy', { units: 10, amount: -100, order: '2', settle: '2025-06-06' }), pay('2025-06-09', 100, 1, '2025-06-05')], fx, cfg: DEFAULT_ROC, today: '2026-10-01' })
    expect(late.checks.mismatches).toEqual([])
  })

  it('a consolidation leaves the units SelfWealth says came back, the fraction taken off in proportion', () => {
    const two = [buy, row('2025-02-03', 'buy', { units: 3, amount: -30, order: '2', settle: '2025-02-04' })]
    const r = trackRoc({ rows: two, actions: [{ ticker: 'MSTY', date: '2025-12-08', ratio: 5, before: 103, after: 20 }], fx, cfg: DEFAULT_ROC, today: '2026-10-01' })
    expect(r.parcels.reduce((t, p) => t + p.units, 0)).toBeCloseTo(20)
    expect(r.parcels.map(p => p.costAud)).toEqual([2000, 60])
    expect(r.consolidations[0]).toMatchObject({ ratio: 5, before: 103, after: 20, fraction: expect.closeTo(0.6, 6) })
  })

  it('the CGT discount needs 12 months, not counting the day bought or the day of the event', () => {
    expect(discountable('2025-05-08', '2026-05-08')).toBe(false)
    expect(discountable('2025-05-08', '2026-05-09')).toBe(true)
    expect(discountable('2024-02-29', '2025-03-01')).toBe(false)
    expect(discountable('2024-02-29', '2025-03-02')).toBe(true)
  })
})
