import { describe, it, expect, vi } from 'vitest'

const store = new Map()
vi.mock('./_treasuryStore.js', () => ({
  tget: async (k, d) => (store.has(k) ? store.get(k) : d),
  tset: async (k, v) => { store.set(k, v) }
}))
const { parseChart, symbolFor, getQuotes } = await import('./_treasuryQuotes.js')

const chart = price => ({ chart: { result: [{ meta: { regularMarketPrice: price, currency: 'USD', regularMarketTime: 1_800_000_000 } }] } })
const ok = body => ({ ok: true, json: async () => body })

describe('share prices', () => {
  it('reads a price from the chart endpoint, and refuses one without', () => {
    expect(parseChart(chart(12.5))).toMatchObject({ price: 12.5, currency: 'USD' })
    expect(() => parseChart({ chart: { result: [] } })).toThrow()
  })

  it('asks for ASX holdings with .AX', () => {
    expect(symbolFor('GLD', 'AUD')).toBe('GLD.AX')
    expect(symbolFor('XYZ', 'USD')).toBe('XYZ')
  })

  it('caches for 15 minutes, and falls back to the last price marked stale', async () => {
    store.clear()
    const fetchImpl = vi.fn(async () => ok(chart(10)))
    const now = Date.parse('2026-11-04T00:00:00Z')
    expect((await getQuotes([{ ticker: 'XYZ' }], { fetchImpl, now })).XYZ).toMatchObject({ price: 10, source: 'live', stale: false })
    await getQuotes([{ ticker: 'XYZ' }], { fetchImpl, now: now + 60e3 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const down = vi.fn(async () => { throw new Error('offline') })
    expect((await getQuotes([{ ticker: 'XYZ' }], { fetchImpl: down, now: now + 20 * 60e3 })).XYZ).toMatchObject({ price: 10, stale: true })
    expect(await getQuotes([{ ticker: 'NEW' }], { fetchImpl: down, now })).toEqual({})
  })
})
