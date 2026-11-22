import { describe, it, expect, vi } from 'vitest'

// Brent, 22 Nov 2026: "the tray in the kit room is black and white … I love
// the colour photo". The TM Corpectomy tray's photo is replaced in place.
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
const uploadFile = vi.fn(async () => {})
vi.mock('./_dropbox.js', () => ({ uploadFile }))

const { listKits, KIT_CORRECTIONS } = await import('./_kits.js')

describe('the TM Corpectomy tray photo in colour', () => {
  it('overwrites the tray photo where it already is, and only that', async () => {
    const path = '/Tray Lists/Tray Photos/TM Corpectomy/TM Corpectomy Set.jpg'
    store.set('kits:defs', JSON.stringify([{ id: 'tm-corpectomy-clv', name: 'TM Corpectomy', system: 'TM Corpectomy', home: 'CLV', kind: 'technomed', trays: ['TM Corpectomy Set'] }]))
    store.set('kits:applied', JSON.stringify(KIT_CORRECTIONS.map(c => c.id).filter(id => id !== 'corpectomy-colour-2026-11-22')))
    store.set('kits:list:tm-corpectomy-clv', JSON.stringify({ trays: [{ name: 'TM Corpectomy Set', photo: path, lines: [{ code: 'A', description: 'Curette', qty: 1, kind: 'instrument' }] }] }))
    await listKits()
    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(uploadFile.mock.calls[0][0]).toBe(path)
    expect(JSON.parse(store.get('kits:applied'))).toContain('corpectomy-colour-2026-11-22')
    expect(JSON.parse(store.get('kits:list:tm-corpectomy-clv')).trays[0].lines[0].description).toBe('Curette')
  })
})
