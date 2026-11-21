import { describe, it, expect, vi } from 'vitest'

// Brent, 21 Nov 2026: "The photos for these trays didn't come across" — three
// of the seven Mariner MIS tray photos did not reach Dropbox. Filed again,
// one at a time, without touching anything else on the list.
const store = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, ...args) => {
    if (cmd === 'get') return store.get(args[0]) ?? null
    if (cmd === 'mget') return args.map(k => store.get(k) ?? null)
    if (cmd === 'set') { store.set(args[0], args[1]); return 'OK' }
    return 1
  }),
  redisSetBody: vi.fn(async (k, v) => { store.set(k, v) })
}))
vi.mock('./_bookingNotices.js', () => ({ getNoticeSettings: async () => ({ contacts: [] }) }))
let calls = 0
const uploadFile = vi.fn(async () => { calls += 1; if (calls === 1) throw new Error('too_many_write_operations') })
vi.mock('./_dropbox.js', () => ({ uploadFile }))

const { listKits, getTrayList } = await import('./_kits.js')

describe('the Mariner MIS photos filed again', () => {
  it('adds a photo only to the trays still without one, retrying a refusal', async () => {
    store.set('kits:defs', JSON.stringify([{ id: 'mariner-mis-clv', name: 'Mariner MIS', system: 'Mariner', home: 'CLV', trays: [] }]))
    store.set('kits:applied', JSON.stringify(['outrigger-consigned-clv-2026-11-02', 'reform-lumbar-returned-2026-11-02', 'mariner-mis-clv-2026-11-21']))
    store.set('kits:list:mariner-mis-clv', JSON.stringify({ source: {}, trays: [
      { name: 'Mariner MIS Insertion', photo: '/Tray Lists/Tray Photos/Mariner MIS/Mariner MIS Insertion.jpg', lines: [{ code: 'A', description: 'Edited', qty: 3, kind: 'instrument' }] },
      { name: 'Mariner MIS Rods, Tulips and Set Screws', lines: [{ code: 'B', description: 'Rod', qty: 2, kind: 'implant' }] },
      { name: 'Mariner MIS Reduction Towers', lines: [{ code: 'C', description: 'Tower', qty: 8, kind: 'instrument' }] }
    ] }))
    await listKits()
    const list = await getTrayList('mariner-mis-clv')
    expect(list.trays.map(t => t.photo)).toEqual([
      '/Tray Lists/Tray Photos/Mariner MIS/Mariner MIS Insertion.jpg',
      '/Tray Lists/Tray Photos/Mariner MIS/Mariner MIS Rods, Tulips and Set Screws.jpg',
      '/Tray Lists/Tray Photos/Mariner MIS/Mariner MIS Reduction Towers.jpg'
    ])
    expect(list.trays[0].lines[0]).toMatchObject({ description: 'Edited', qty: 3 })
    expect(uploadFile.mock.calls.filter(c => String(c[0]).includes('/Mariner MIS/'))).toHaveLength(3) // two trays, one refusal retried
    expect(JSON.parse(store.get('kits:applied'))).toContain('mariner-mis-photos-2026-11-21')
  })
})
