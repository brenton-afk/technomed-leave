import { describe, it, expect } from 'vitest'
import { mapTracker, toDay, toNumber } from './importMap.js'

// The old tracker's export, invented. Real figures never belong in a test.

const FAKE = {
  ato: [
    { label: 'BAS Q1', amount: '$12,345.00', due: '28/10/2026', status: 'paid' },
    { name: 'PAYGW', amt: 2000, dueDate: '2026-11-21' },
    { label: 'no date', amount: 5 }
  ],
  btc: {
    company: { btc: 0.5, cost: 40000 },
    trust: { sats: 1000000, costBase: 900, cold: 0.01 },
    'TechnoMed Pty Ltd cold': { btc: 0.1, wallet: 'coldcard' },
    mystery: 3
  },
  cashBank: { balance: 50000, date: '2026-10-31' },
  dca: [
    { date: '2026-10-06', aud: 1700, price: 170000 },
    { d: '2026-10-13', amount: 850, sats: 500000 }
  ],
  dcaPlan: { base: 1700, daily: 150, amber: 20000 },
  inv: [{ number: 'INV-1' }],
  onchain: { mvrv: [] },
  trustLog: [{ date: '2026-08-01', amount: 1000, category: 'Distribution', party: 'Beneficiary A', note: 'n' }],
  history: [{ month: '2026-09', cash: 40000, price: 160000 }],
  plan: { foo: 1 },
  val: 7,
  payroll: { amount: 30000, next: '2026-11-06' },
  todo: ['x']
}

describe('reading the old tracker', () => {
  const { data, report } = mapTracker(FAKE)

  it('maps every key to exactly one outcome', () => {
    const seen = [...report.mapped, ...report.superseded, ...report.unmapped].map(r => r.key).sort()
    expect(seen).toEqual(Object.keys(FAKE).sort())
  })

  it('lists what it could not use, by shape not content', () => {
    expect(report.unmapped.map(u => u.key).sort()).toEqual(['plan', 'todo', 'val'])
    expect(report.unmapped.find(u => u.key === 'plan').preview).toBe('object with 1 key (foo)')
    expect(report.superseded.map(s => s.key).sort()).toEqual(['inv', 'onchain'])
  })

  it('ATO, with a skipped row reported by position', () => {
    expect(data.ato).toHaveLength(2)
    expect(data.ato[0]).toMatchObject({ due: '2026-10-28', amount: 12345, status: 'paid' })
    expect(report.skipped).toContainEqual(expect.objectContaining({ key: 'ato', index: 2 }))
  })

  it('holdings by entity, including cold storage', () => {
    expect(data.holdings.company).toEqual({ exchangeSats: 50_000_000, coldSats: 10_000_000, costAud: 40000 })
    expect(data.holdings.trust).toEqual({ exchangeSats: 1_000_000, coldSats: 1_000_000, costAud: 900 })
    expect(report.skipped).toContainEqual(expect.objectContaining({ key: 'btc' }))
  })

  it('DCA fills in sats or price from the other', () => {
    expect(data.dca[0].sats).toBe(1_000_000)
    expect(data.dca[1].priceAud).toBe(170000)
  })

  it('settings from dcaPlan, cashBank and payroll', () => {
    expect(data.settings).toMatchObject({
      baseWeekly: 1700, dailyAuto: 150, amberCash: 20000,
      manualCash: { amount: 50000, at: '2026-10-31' }, payroll: { amount: 30000, nextDate: '2026-11-06' }
    })
  })

  it('trust and snapshots', () => {
    expect(data.trust[0]).toMatchObject({ amount: 1000, party: 'Beneficiary A' })
    expect(data.snapshots[0]).toMatchObject({ month: '2026-09', cash: 40000, btcAud: 160000 })
  })

  it('refuses something that is not a tracker export', () => {
    expect(mapTracker([1, 2]).report.unmapped[0].key).toBe('(file)')
  })
})

describe('helpers', () => {
  it('dates in the forms people type', () => {
    expect(toDay('2026-7-1')).toBe('2026-07-01')
    expect(toDay('01/07/26')).toBe('2026-07-01')
    expect(toDay('')).toBe(null)
  })
  it('amounts with dollar signs, commas and brackets', () => {
    expect(toNumber('A$1,700')).toBe(1700)
    expect(toNumber('(250.50)')).toBe(-250.5)
    expect(toNumber('abc')).toBe(null)
  })
})
