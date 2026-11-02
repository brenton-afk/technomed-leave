import { describe, it, expect } from 'vitest'
import {
  parseAmberCsv, mergeAmber, amberTotals, purchaseSummary, monthlyTable, purchaseDots,
  cumulativeSteps, dotRadius, parseCsvText
} from './amber.js'

// An invented Amber export. Never the real file.
const CSV = [
  'datetime_hobart,type,status,aud_amount,btc_amount,price_aud_per_btc,fee_aud,address',
  '2025-05-07 09:00:00,aud_deposit,settled,10000,,,,',
  '2025-05-07 09:05:00,buy_on_deposit,settled,5000,0.05,100000,10,',
  '2025-05-08 15:03:00,buy_recurring,settled,150,0.0015,100000,0.3,',
  '2025-05-09 15:03:00,buy_recurring,pending,150,0.0015,100000,0.3,',
  '2025-06-01 12:00:00,buy,settled,"1,000.00",0.008,125000,2,',
  '2025-06-02 10:00:00,send_to_cold_storage,settled,,0.05,,,bc1qFAKEADDRESS',
  '2025-06-03 10:00:00,sell,settled,100,0.001,100000,,'
].join('\n')

describe('reading an Amber export', () => {
  const { rows, skipped } = parseAmberCsv(CSV)

  it('takes settled rows of the types it knows, by column name', () => {
    expect(rows.map(r => r.type)).toEqual(['aud_deposit', 'buy_on_deposit', 'buy_recurring', 'buy', 'send_to_cold_storage'])
    expect(rows[3]).toMatchObject({ date: '2025-06-01', aud: 1000, sats: 800000, priceAud: 125000, feeAud: 2 })
  })

  it('says what it set aside and why', () => {
    expect(skipped).toEqual([
      { line: 5, reason: 'status "pending", not settled' },
      { line: 8, reason: 'type "sell" is not one this reads' }
    ])
  })

  it('never keeps a wallet address', () => {
    expect(JSON.stringify(rows)).not.toMatch(/FAKEADDRESS/)
  })

  it('refuses a file that is not an export', () => {
    expect(parseAmberCsv('a,b\n1,2').error).toMatch(/Not an Amber export/)
  })

  it('re-importing a newer export adds only the new rows', () => {
    const first = mergeAmber([], rows.slice(0, 3))
    const again = mergeAmber(first.rows, rows)
    expect(again.added).toBe(2)
    expect(mergeAmber(again.rows, rows).added).toBe(0)
  })

  it('handles quoted commas and newlines', () => {
    expect(parseCsvText('a,b\n"x, ""y""","line\nbreak"')).toEqual([['a', 'b'], ['x, "y"', 'line\nbreak']])
  })
})

describe('what it adds up to', () => {
  const { rows } = parseAmberCsv(CSV)
  const t = amberTotals(rows)

  it('totals purchases, sends and what is still at Amber', () => {
    expect(t).toMatchObject({ purchases: 3, invested: 6150, boughtSats: 5_950_000, sends: 1, sentSats: 5_000_000, atAmberSats: 950_000, firstPurchase: '2025-05-07' })
    expect(t.averageCost).toBeCloseTo(6150 / 0.0595)
  })

  it('counts a transfer in as held, never as invested', () => {
    const s = purchaseSummary(rows, [{ date: '2025-06-05', sats: 10_000_000 }], 200000, '2025-06-05')
    expect(s.invested).toBe(6150)
    expect(s.transferSats).toBe(10_000_000)
    expect(s.value).toBeCloseTo(0.0595 * 200000)
    expect(s.largest.aud).toBe(5000)
    expect(s.last30Sats).toBe(5_950_000)
  })

  it('a month table, newest first', () => {
    expect(monthlyTable(rows).map(m => [m.month, m.invested, m.buys])).toEqual([['2025-06', 1000, 1], ['2025-05', 5150, 2]])
  })

  it('dots one per buy, or grouped', () => {
    expect(purchaseDots(rows)).toHaveLength(3)
    const months = purchaseDots(rows, 'month')
    expect(months.map(d => [d.date, d.aud, d.count])).toEqual([['2025-05-01', 5150, 2], ['2025-06-01', 1000, 1]])
    expect(months[0].priceAud).toBeCloseTo(5150 / 0.0515)
  })

  it('holdings as steps, transfers included', () => {
    expect(cumulativeSteps(rows, [{ date: '2025-06-05', sats: 10_000_000 }])).toEqual([
      ['2025-05-07', 0.05], ['2025-05-08', 0.05], ['2025-05-08', 0.0515], ['2025-06-01', 0.0515], ['2025-06-01', 0.0595],
      ['2025-06-05', 0.0595], ['2025-06-05', 0.1595]
    ])
  })

  it('a dot\'s area follows the amount, but the smallest stays visible', () => {
    expect(dotRadius(50000, 50000)).toBe(17)
    expect(dotRadius(12500, 50000)).toBeCloseTo(10.25)
    expect(dotRadius(150, 50000)).toBeGreaterThan(4)
    expect(dotRadius(150, 50000)).toBeLessThan(dotRadius(300, 50000))
  })
})
