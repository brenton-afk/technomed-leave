import { describe, it, expect, vi, beforeEach } from 'vitest'

// Brent, 18 Nov 2026: "The resources page takes AGES to load". The catalogue
// is kept, and Choose a file rereads one distributor, not all eight folders.
const store = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, key) => (cmd === 'get' ? store.get(key) ?? null : 'OK')),
  redisSetBody: vi.fn(async (k, v) => { store.set(k, v) })
}))
vi.mock('./_dropbox.js', () => ({ listFilesUnder: vi.fn() }))
const { resourceCatalogue } = await import('./_resources.js')

const listing = calls => async root => {
  calls.push(root)
  return [{ name: root.includes('Signus') ? 'Diplomat ARTG.pdf' : 'Something ARTG.pdf', path: `${root}/x/file ARTG.pdf` }]
}

beforeEach(() => store.clear())

describe('the Resources catalogue', () => {
  it('reads every folder once, then serves the kept copy', async () => {
    const calls = []
    await resourceCatalogue({ fresh: true, list: listing(calls) })
    const n = calls.length
    expect(n).toBeGreaterThan(5)
    await resourceCatalogue({ list: listing(calls) })
    expect(calls.length).toBe(n)
  })
  it('a per-distributor refresh reads only that distributor and keeps the rest', async () => {
    const calls = []
    const all = await resourceCatalogue({ fresh: true, list: listing(calls) })
    calls.length = 0
    const after = await resourceCatalogue({ fresh: true, distributor: 'signus', list: listing(calls) })
    expect(calls).toEqual(['/Distributors/Signus'])
    expect(after.length).toBe(all.length)
  })
})
