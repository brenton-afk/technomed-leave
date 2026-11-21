import { describe, it, expect, vi, beforeEach } from 'vitest'

// Brent, 21 Nov 2026: "Check my email from Gerardo. It has the trays for the E4
// Catenary trays when he renamed them." The Calvary set gets the three trays;
// a set someone has already filled is left alone.
const store = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, ...args) => {
    if (cmd === 'get') return store.get(args[0]) ?? null
    if (cmd === 'mget') return args.map(k => store.get(k) ?? null)
    return 1
  }),
  redisSetBody: vi.fn(async (k, v) => { store.set(k, v) })
}))
vi.mock('./_bookingNotices.js', () => ({ getNoticeSettings: async () => ({ contacts: [] }) }))

const { getDefs, getTrayList, KIT_CORRECTIONS } = await import('./_kits.js')
const others = KIT_CORRECTIONS.map(c => c.id).filter(id => id !== 'catenary-trays-clv-2026-11-21')

beforeEach(() => {
  store.clear()
  store.set('kits:applied', JSON.stringify(others))
  store.set('kits:defs', JSON.stringify([
    { id: 'alif-clv', name: 'Catenary ALIF', system: 'Catenary ALIF', home: 'CLV', kind: 'consignment', trays: [] },
    { id: 'plif-clv', name: 'Global BMD PLIF', system: 'Global BMD PLIF', home: 'CLV', kind: 'consignment', trays: [] }
  ]))
})

describe("Calvary's Catenary ALIF trays", () => {
  it('fills the empty Calvary set with the three trays, totals as on the sheets, no prices', async () => {
    await getDefs()
    const list = await getTrayList('alif-clv')
    expect(list.trays.map(t => t.name)).toEqual(['E4 Catenary ALIF Inst', 'E4 Catenary ALIF Trials', 'E4 Catenary ALIF Hyperlordotic Trials DNO'])
    expect(list.trays.map(t => t.lines.reduce((s, l) => s + l.qty, 0))).toEqual([13, 28, 21])
    expect(JSON.stringify(list)).not.toMatch(/\$|\bprice\b|\bAUD\b/i)
    expect(await getTrayList('plif-clv')).toBeNull()
  })
  it('leaves a tray someone has already filled', async () => {
    store.set('kits:list:alif-clv', JSON.stringify({ trays: [{ name: 'E4 Catenary ALIF Inst', lines: [{ code: 'X', description: 'Mine', qty: 9, kind: 'instrument' }] }] }))
    await getDefs()
    const list = await getTrayList('alif-clv')
    expect(list.trays.find(t => t.name === 'E4 Catenary ALIF Inst').lines[0].description).toBe('Mine')
    expect(list.trays).toHaveLength(3)
  })
})
