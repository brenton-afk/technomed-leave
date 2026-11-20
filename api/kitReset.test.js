import { describe, it, expect, vi, beforeEach } from 'vitest'

// Brent, 20 Nov 2026: "a button to reset all trays to their original locations
// in one tap". Invented kits.
const store = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, ...args) => {
    if (cmd === 'get') return store.get(args[0]) ?? null
    if (cmd === 'mget') return args.map(k => store.get(k) ?? null)
    if (cmd === 'lpush' || cmd === 'ltrim' || cmd === 'del' || cmd === 'expire') return 1
    return null
  }),
  redisSetBody: vi.fn(async (k, v) => { store.set(k, v) })
}))
vi.mock('./_bookingNotices.js', () => ({ getNoticeSettings: async () => ({ contacts: [] }) }))

const { resetAllLocations, listKits } = await import('./_kits.js')

beforeEach(() => {
  store.clear()
  store.set('kits:defs', JSON.stringify([
    { id: 'a', name: 'Diplomat 1', system: 'Diplomat', home: 'CLV', trays: ['T1', 'T2'] },
    { id: 'b', name: 'Dakota', system: 'Dakota', home: 'RHH', trays: ['D1'] }
  ]))
  store.set('kits:applied', JSON.stringify(['*']))
  store.set('kits:loc:a', JSON.stringify({ at: 'CLV', checkedAt: 'x', checkedBy: 'Ben', trayAt: { T1: { at: 'RHH' } } }))
  store.set('kits:loc:b', JSON.stringify({ at: 'CLV', trays: ['D1'] }))
})

describe('reset every tray to home', () => {
  it('puts sets and single trays back, keeping the stock-take tick', async () => {
    const out = await resetAllLocations('Brent')
    expect(out.reset).toBe(2)
    const after = await listKits()
    expect(after.every(k => k.at === k.home && !k.away && !Object.keys(k.trayAt || {}).length)).toBe(true)
    expect(JSON.parse(store.get('kits:loc:a'))).toMatchObject({ at: 'CLV', checkedBy: 'Ben' })
  })
})
