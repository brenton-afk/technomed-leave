import { describe, it, expect, vi } from 'vitest'
vi.mock('./_redis.js', () => ({ redis: vi.fn(async () => null), redisSetBody: vi.fn(async () => {}) }))
vi.mock('./_xeroAccounting.js', () => ({ salesInvoicesWithLines: vi.fn(async () => []) }))
vi.mock('./_dropbox.js', () => ({ uploadFile: vi.fn(async path => ({ path_display: path })) }))
const { mayUseCommissions, commissionWorkbook, commissionsDue } = await import('./_commissions.js')

describe('commissions (Brent only, 15 Nov 2026)', () => {
  it('is Brent\'s alone unless COMMISSION_USERS says otherwise', () => {
    expect(mayUseCommissions('brenton@technomed.com.au', {})).toBe(true)
    expect(mayUseCommissions('erin@technomed.com.au', {})).toBe(false)
    expect(mayUseCommissions('erin@technomed.com.au', { COMMISSION_USERS: 'brenton@technomed.com.au, erin@technomed.com.au' })).toBe(true)
  })
  it('waits until three business days before payment', async () => {
    expect(await commissionsDue({ today: '2026-11-20' })).toEqual({ month: '2026-10', waiting: '2026-11-26' })
  })
  it('works the month out on the day', async () => {
    const out = await commissionsDue({ today: '2026-11-26' })
    expect(out).toMatchObject({ month: '2026-10', worked: true })
  })
  it('writes a workbook like the Dropbox ones', async () => {
    const buf = await commissionWorkbook(
      { salesMonth: '2026-09', paymentDate: '2026-11-02', computedAt: '2026-10-29T00:00:00Z' },
      { name: 'Toni Hoppitt', total: 189, byPayItem: { 'Commission Novus Surgical': 189 }, lines: [{ label: 'Novus', sales: 6300, tm: 1260, rate: 0.15, base: 'tm', amount: 189, payItem: 'Commission Novus Surgical', invoices: ['INV-2018'], adjustments: [] }] })
    expect(buf.length).toBeGreaterThan(1000)
  })
})
