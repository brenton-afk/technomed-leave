import { it, expect, vi, beforeEach } from 'vitest'

// Brent's ARTG certificates (23 Nov 2026): found or filed once, then chosen.
const store = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, k, v) => {
    if (cmd === 'get') return store.get(k) ?? null
    if (cmd === 'set') { if (store.has(k)) return null; store.set(k, v); return 'OK' }
    if (cmd === 'del') { store.delete(k); return 1 }
    return null
  }),
  redisSetBody: vi.fn(async (k, v) => { store.set(k, v) })
}))
const { applyResourceAdditions, getPicks } = await import('./_resources.js')

let files
const list = vi.fn(async root => files.filter(f => f.path.startsWith(root)))
beforeEach(() => {
  store.clear()
  files = [
    { path: '/Distributors/E4 Surgical/E4 Global ALIF/ARTG 323520 (GB lumbar cage including Standalone).pdf', name: 'ARTG 323520 (GB lumbar cage including Standalone).pdf' },
    { path: '/Distributors/E4 Surgical/Global PLIF Cage/ARTG 323520 Summary (SLR90 Cages).pdf', name: 'ARTG 323520 Summary (SLR90 Cages).pdf' },
    { path: '/Distributors/E4 Surgical/Reform/Reform Cervical Surgical Technique.pdf', name: 'Reform Cervical Surgical Technique.pdf' }
  ]
})

it('chooses the GB certificate for both cages and files Reform beside its technique, once', async () => {
  const upload = vi.fn(async path => { files.push({ path, name: path.split('/').pop() }) })
  const done = await applyResourceAdditions({ upload, list })
  expect(done).toEqual(['artg-gb-lumbar-2026-11-23', 'artg-reform-2026-11-23'])
  expect(upload).toHaveBeenCalledTimes(1)
  expect(upload.mock.calls[0][0]).toBe('/Distributors/E4 Surgical/Reform/Reform Cervical ARTG 287906 - POCT and Slim HP.pdf')
  expect(upload.mock.calls[0][1].subarray(0, 4).toString()).toBe('%PDF')
  const picks = await getPicks()
  expect(picks['Catenary ALIF'].artg).toMatch(/GB lumbar cage including Standalone/)
  expect(picks['Global BMD PLIF'].artg).toMatch(/GB lumbar cage including Standalone/)
  expect(picks['Reform Cervical'].artg).toMatch(/ARTG 287906/)
  // Done once.
  expect(await applyResourceAdditions({ upload, list })).toEqual([])
  expect(upload).toHaveBeenCalledTimes(1)
})
