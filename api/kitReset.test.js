import { describe, it, expect, vi, beforeEach } from 'vitest'

// Brent, 20 Nov 2026: "a button to reset all trays to their original locations
// in one tap". Invented kits.
const store = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, ...args) => {
    if (cmd === 'get') return store.get(args[0]) ?? null
    if (cmd === 'mget') return args.map(k => store.get(k) ?? null)
    if (cmd === 'set') { store.set(args[0], args[1]); return 'OK' }
    if (cmd === 'lpush' || cmd === 'ltrim' || cmd === 'del' || cmd === 'expire') return 1
    return null
  }),
  redisSetBody: vi.fn(async (k, v) => { store.set(k, v) })
}))
vi.mock('./_bookingNotices.js', () => ({ getNoticeSettings: async () => ({ contacts: [] }) }))

const { resetAllLocations, listKits, renameSystem, editTrayList } = await import('./_kits.js')

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

// Brent, 21 Nov 2026: the name on a system's tile could not be changed.
describe('renaming', () => {
  it('renames a system on every set of it', async () => {
    await renameSystem('Diplomat', 'Diplomat Screws', 'Brent')
    const kits = await listKits()
    expect(kits.find(k => k.id === 'a')).toMatchObject({ system: 'Diplomat Screws', name: 'Diplomat Screws 1' })
    expect(kits.find(k => k.id === 'b').system).toBe('Dakota')
    await expect(renameSystem('Dakota', 'diplomat screws', 'Brent')).rejects.toThrow(/already a system/)
  })
  it('a tray moved on its own keeps its place when renamed', async () => {
    await editTrayList('a', { op: 'rename', tray: 'T1', name: 'Tray One' }, 'Brent')
    const a = (await listKits()).find(k => k.id === 'a')
    expect(a.trays).toContain('Tray One')
    expect(a.trayAt['Tray One']).toMatchObject({ at: 'RHH' })
  })
})

describe('the Mariner MIS set at Calvary (21 Nov 2026)', () => {
  it('is added once, under the Mariner tile, with seven trays from the agreement', async () => {
    const { correctKits } = await import('./_kits.js')
    const { MARINER_MIS_TRAYS } = await import('./_kitSeedMarinerMis.js')
    const out = correctKits([], ['outrigger-consigned-clv-2026-11-02', 'reform-lumbar-returned-2026-11-02'])
    const set = out.kits.find(k => k.id === 'mariner-mis-clv')
    expect(set).toMatchObject({ system: 'Mariner', home: 'CLV', kind: 'consignment', distributor: 'device' })
    expect(correctKits(out.kits, out.applied)).toBeNull()
    expect(MARINER_MIS_TRAYS.map(t => t.lines.reduce((n, l) => n + l.qty, 0))).toEqual([19, 13, 152, 107, 15, 7, 12])
    // No prices come across from the agreement.
    expect(JSON.stringify(MARINER_MIS_TRAYS)).not.toMatch(/\$|price/i)
  })
})
