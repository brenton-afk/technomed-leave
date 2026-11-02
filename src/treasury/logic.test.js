import { describe, it, expect } from 'vitest'
import {
  zBand, soprAdjust, sthMvrvAdjust, dcaPlan, keyLevels, summaryLine, slice, holdingsView,
  atoOutlook, cashForecast, payDates, fyLabel, trustTotals, trustCsv, weekStart,
  parseBtc, satsToBtcText, parseMoney, isLargeBtc, runScenario, pricePath, weeksBetween
} from './logic.js'

// Made-up figures throughout.

describe('MVRV Z-score bands — each edge belongs to the band above it', () => {
  it.each([
    [-0.5, 2.0], [0, 1.5], [0.99, 1.5], [1, 1.0], [1.99, 1.0], [2, 0.75],
    [3, 0.5], [4.99, 0.5], [5, 0.25], [6.99, 0.25], [7, 0], [12, 0]
  ])('z = %s → %s', (z, want) => expect(zBand(z)).toBe(want))
})

describe('STH-SOPR adjustment', () => {
  it.each([[0.95, 0.5], [0.98, 0.25], [0.999, 0.25], [1.0, 0], [1.03, 0], [1.031, -0.25]])(
    'sopr = %s → %s', (s, want) => expect(soprAdjust(s)).toBe(want))
})

describe('STH-MVRV adjustment', () => {
  it.each([[0.85, 0.25], [0.9, 0], [1.2, 0], [1.21, -0.25]])(
    'sth-mvrv = %s → %s', (m, want) => expect(sthMvrvAdjust(m)).toBe(want))
})

describe('the weekly buy', () => {
  const S = { baseWeekly: 1700, dailyAuto: 150, amberCash: 50000 }

  it('base × multiplier, rounded to $50', () => {
    // 1.0 + 0 + 0 = 1.0 → 1700
    const p = dcaPlan({ mvrvZ: 1.5, sthSopr: 1.01, sthMvrv: 1.0 }, S)
    expect(p.multiplier).toBe(1)
    expect(p.total).toBe(1700)
    // 0.75 + 0.25 + 0 → 1.0; 0.5 + 0.25 + 0.25 = 1.0 ... try 0.75 - 0.25 = 0.5 → 850
    expect(dcaPlan({ mvrvZ: 2.5, sthSopr: 1.05, sthMvrv: 1.0 }, S).total).toBe(850)
    // 0.25 × 1700 = 425 → rounds to 450
    expect(dcaPlan({ mvrvZ: 5.5, sthSopr: 1.01, sthMvrv: 1.0 }, S).total).toBe(450)
  })

  it('is capped at 2.5 and at 0', () => {
    expect(dcaPlan({ mvrvZ: -1, sthSopr: 0.9, sthMvrv: 0.8 }, S).multiplier).toBe(2.5) // 2 + .5 + .25
    expect(dcaPlan({ mvrvZ: 8, sthSopr: 1.1, sthMvrv: 1.5 }, S).multiplier).toBe(0) // 0 - .25 - .25
  })

  it('never spends more than the Amber cash', () => {
    const p = dcaPlan({ mvrvZ: -1, sthSopr: 0.9, sthMvrv: 0.8 }, { ...S, amberCash: 3020 })
    expect(p.target).toBe(4250)
    expect(p.total).toBe(3000)
    expect(p.capped).toBe(true)
  })

  it('shows the top-up over the daily auto-buy, and weeks of cash left', () => {
    const p = dcaPlan({ mvrvZ: 0.5, sthSopr: 1.01, sthMvrv: 1.0 }, { ...S, amberCash: 10200 })
    expect(p.total).toBe(2550) // 1.5 × 1700
    expect(p.autoWeek).toBe(1050)
    expect(p.topUp).toBe(1500)
    expect(p.weeksLeft).toBeCloseTo(4, 5)
  })

  it('warns when the readings are more than a week old', () => {
    const r = { mvrvZ: 1, sthSopr: 1, sthMvrv: 1 }
    expect(dcaPlan(r, S, { asOf: '2026-10-20', today: '2026-11-02' }).stale).toBe(true)
    expect(dcaPlan(r, S, { asOf: '2026-10-30', today: '2026-11-02' }).stale).toBe(false)
  })

  it('says it is not ready rather than guessing when a reading is missing', () => {
    expect(dcaPlan({ mvrvZ: 1 }, S).ready).toBe(false)
  })
})

describe('key levels', () => {
  const latest = { sthRealizedPrice: 100000, realizedPrice: 50000, lthRealizedPrice: 40000, sthSopr: 0.99 }
  it('gives each cost basis and the distance to it', () => {
    const l = keyLevels(102500, latest)
    expect(l[0].pct).toBeCloseTo(2.5)
    expect(l[1].pct).toBeCloseTo(105)
  })
  it('writes the summary line', () => {
    expect(summaryLine(102500, latest)).toBe('Price is 2.5% above the STH cost basis, and short-term holders are selling at a loss (STH-SOPR below 1).')
    expect(summaryLine(95000, { sthRealizedPrice: 100000 })).toBe('Price is 5.0% below the STH cost basis.')
  })
})

describe('chart ranges', () => {
  const series = Array.from({ length: 800 }, (_, i) => [new Date(Date.UTC(2024, 7, 1) + i * 86400e3).toISOString().slice(0, 10), i])
  it('3 months and a year by date; all thinned but keeping the last point', () => {
    const today = series[series.length - 1][0]
    expect(slice(series, '3m', today).length).toBeLessThanOrEqual(93)
    expect(slice(series, '1y', today).length).toBeLessThanOrEqual(367)
    const all = slice(series, 'all', today)
    expect(all.length).toBeLessThan(130)
    expect(all[all.length - 1]).toEqual(series[series.length - 1])
  })
})

describe('holdings', () => {
  it('values each entity and totals them', () => {
    const v = holdingsView({ company: { exchangeSats: 50_000_000, coldSats: 50_000_000, costAud: 100000 }, trust: { coldSats: 10_000_000, costAud: 5000 } }, 150000)
    expect(v.rows.find(r => r.id === 'company')).toMatchObject({ sats: 100_000_000, value: 150000, pl: 50000 })
    expect(v.total.sats).toBe(110_000_000)
    expect(v.total.value).toBeCloseTo(165000)
  })
})

describe('ATO and cash', () => {
  const ato = [
    { id: 'a', due: '2026-11-28', amount: 10000, status: 'due' },
    { id: 'b', due: '2027-01-21', amount: 5000, status: 'due' },
    { id: 'c', due: '2026-10-28', amount: 9999, status: 'paid' }
  ]
  it('the next payment and the 30/90-day windows', () => {
    const o = atoOutlook(ato, '2026-11-02')
    expect(o.next.id).toBe('a')
    expect(o.due30).toBe(10000)
    expect(o.due90).toBe(15000)
  })

  it('payroll repeats fortnightly', () => {
    expect(payDates('2026-11-05', '2026-11-02', '2026-12-01')).toEqual(['2026-11-05', '2026-11-19'])
  })

  it('thirteen weeks from this Monday, overdue receipts kept out', () => {
    const f = cashForecast({
      today: '2026-11-04', opening: 100000,
      receivables: [{ due: '2026-11-06', amountDue: 2000 }, { due: '2026-10-01', amountDue: 7000 }],
      payables: [{ due: '2026-11-20', amountDue: 1000 }],
      ato, payroll: { amount: 3000, nextDate: '2026-11-05' },
      oneOffs: [{ date: '2026-11-10', amount: -500 }]
    })
    expect(f.weeks).toHaveLength(13)
    expect(f.weeks[0].from).toBe('2026-11-02')
    expect(f.weeks[0]).toMatchObject({ receipts: 2000, payroll: 3000, net: -1000, closing: 99000 })
    expect(f.overdueReceivables).toBe(7000)
    expect(f.weeks[1].other).toBe(-500)
    expect(f.weeks[3].ato).toBe(10000)
  })

  it('weeks start on Monday', () => {
    expect(weekStart('2026-11-08')).toBe('2026-11-02')
  })
})

describe('family trust', () => {
  const entries = [
    { date: '2026-07-01', amount: 100, category: 'Distribution', party: 'A' },
    { date: '2026-06-30', amount: 50, category: 'Loan', party: 'B' },
    { date: '2027-03-01', amount: 25, category: 'Distribution', party: 'B', note: 'has, a "comma"' }
  ]
  it('financial years run July to June', () => {
    expect(fyLabel('2026-07-01')).toBe('FY27')
    expect(fyLabel('2026-06-30')).toBe('FY26')
  })
  it('totals by category and party for a year', () => {
    const t = trustTotals(entries, 'FY27')
    expect(t.total).toBe(125)
    expect(t.byCategory).toEqual([{ name: 'Distribution', total: 125 }])
    expect(t.byParty.map(p => p.name)).toEqual(['A', 'B'])
  })
  it('exports CSV with quoting, and does not let a cell become a formula', () => {
    const csv = trustCsv([...entries, { date: '2026-08-01', amount: 1, category: '=HYPERLINK("x")', party: 'C' }], 'FY27')
    expect(csv.split('\r\n')[0]).toBe('Date,FY,Category,Party,Amount (AUD),Note')
    expect(csv).toContain('"has, a ""comma"""')
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
  })
})

describe('typing a BTC amount', () => {
  it('reads a decimal point either way — the comma is what an iPhone in some regions types', () => {
    expect(parseBtc('4.20005325').sats).toBe(420_005_325)
    expect(parseBtc('4,20005325').sats).toBe(420_005_325)
    expect(parseBtc(' 4.20005325 ').sats).toBe(420_005_325)
  })
  it('treats commas beside a full stop as thousands', () => {
    expect(parseBtc('1,234.5').sats).toBe(123_450_000_000)
  })
  it('refuses more than can exist, more than 8 places, and junk', () => {
    expect(parseBtc('420005325').error).toMatch(/21 million/)
    expect(parseBtc('0.123456789').error).toMatch(/8 decimal/)
    expect(parseBtc('4.2.1').error).toBeTruthy()
  })
  it('blank is nothing', () => {
    expect(parseBtc('')).toEqual({ sats: 0, error: null })
  })
  it('writes sats back without exponent notation', () => {
    expect(satsToBtcText(10)).toBe('0.0000001')
    expect(satsToBtcText(420_005_325)).toBe('4.20005325')
  })
  it('reads dollars with a sign and commas', () => {
    expect(parseMoney('$563,993')).toBe(563993)
    expect(parseMoney('abc')).toBe(null)
  })
})

describe('Amber cash by entity', () => {
  it('reads the DCA entity\'s cash from the DCA settings, the rest from holdings', () => {
    const v = holdingsView({ smsf: { amberAud: 1436.7 }, company: { amberAud: 999 } }, 100000, { amberCash: 19000, dcaEntity: 'company' })
    expect(v.rows.find(r => r.id === 'company')).toMatchObject({ amberAud: 19000, dcaCash: true })
    expect(v.rows.find(r => r.id === 'smsf')).toMatchObject({ amberAud: 1436.7, dcaCash: false })
    expect(v.total.amberAud).toBeCloseTo(20436.7)
  })
})

describe('an amount worth a second look', () => {
  it('flags a field over 100 BTC, not an ordinary holding', () => {
    expect(isLargeBtc(parseBtc('1436.7').sats)).toBe(true)
    expect(isLargeBtc(parseBtc('4.20005325').sats)).toBe(false)
  })
})

describe('the scenario planner', () => {
  const rows = [
    { id: 'company', label: 'TechnoMed', sats: 400_000_000, costAud: 500000 },
    { id: 'trust', label: 'Family trust', sats: 0, costAud: 0 },
    { id: 'smsf', label: 'SMSF', sats: 100_000_000, costAud: 150000 }
  ]

  it('values today\'s holdings at the target, with no buying', () => {
    const r = runScenario({ rows, priceAudNow: 100000, targetUsd: 140000, fx: 0.7, weekly: 0, weeks: 0 })
    expect(r.targetAud).toBeCloseTo(200000)
    expect(r.total.valueAt).toBeCloseTo(1_000_000)
    expect(r.total.gain).toBeCloseTo(350000)
    expect(r.entities.map(e => e.id)).toEqual(['company', 'smsf'])
  })

  it('a flat year buys more coin than a steady climb to the same price', () => {
    const base = { rows, priceAudNow: 100000, targetUsd: 140000, fx: 0.7, weekly: 1000, weeks: 52 }
    const steady = runScenario({ ...base, path: 'steady' })
    const late = runScenario({ ...base, path: 'late' })
    const dip = runScenario({ ...base, path: 'dip' })
    expect(steady.spend).toBe(52000)
    expect(late.addedSats).toBeGreaterThan(steady.addedSats)
    expect(dip.addedSats).toBeGreaterThan(late.addedSats)
    // A straight line from 100k to 200k averages (P1−P0)/ln(P1/P0) per coin bought.
    expect(steady.averageBuyAud).toBeGreaterThan(140000)
    expect(steady.averageBuyAud).toBeLessThan(146000)
  })

  it('only the buying entity gets the coins and the cost', () => {
    const r = runScenario({ rows, priceAudNow: 100000, targetUsd: 70000, fx: 0.7, weekly: 1000, weeks: 10, path: 'steady', buyer: 'smsf' })
    const smsf = r.entities.find(e => e.id === 'smsf')
    expect(smsf.addedSats).toBe(10_000_000)
    expect(smsf.cost).toBe(160000)
    expect(r.entities.find(e => e.id === 'company').addedSats).toBe(0)
  })

  it('counts whole weeks to the date', () => {
    expect(weeksBetween('2026-11-02', '2027-11-01')).toBe(52)
    expect(weeksBetween('2026-11-02', '2026-11-01')).toBe(0)
  })

  it('the path starts today and ends at the target', () => {
    for (const path of ['steady', 'late', 'dip']) {
      const p = pricePath(100, 200, 52, path)
      expect(p[0]).toBe(100)
      expect(p[51]).toBeCloseTo(200)
    }
    expect(Math.min(...pricePath(100, 200, 53, 'dip'))).toBeCloseTo(75)
  })
})
