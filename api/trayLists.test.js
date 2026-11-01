import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanTrays, fileKind } from './_trayLists.js'

// Tray lists for the kit room. Made-up item codes only.

describe('reading a tray list', () => {
  it('knows the file types the hospitals send', () => {
    expect(fileKind('RHH Diplomat.pdf')).toBe('pdf')
    expect(fileKind('Shoreline Master.docx')).toBe('docx')
    expect(fileKind('Screws.xlsx')).toBe('xlsx')
    expect(fileKind('IMG_0042.jpeg')).toBe('image')
    expect(fileKind('notes.pages')).toBeNull()
  })

  it('keeps implants and instruments apart, and never invents a quantity', () => {
    const out = cleanTrays({ trays: [{ name: 'TRAY 2 – PLATES AND SCREWS', lines: [
      { code: 'X-85-0705', description: '5MM 4-HOLE PLATE', qty: 2, kind: 'implant' },
      { code: 'X-86-0072', description: 'PACKING BLOCK', qty: '1', kind: 'instrument' },
      { code: '', description: '', qty: 3, kind: 'implant' },
      { code: 'X-86-9915', description: 'SCREW CADDY', qty: 'two', kind: 'tool' }
    ] }] })
    expect(out.trays[0].lines).toEqual([
      { code: 'X-85-0705', description: '5MM 4-HOLE PLATE', qty: 2, kind: 'implant' },
      { code: 'X-86-0072', description: 'PACKING BLOCK', qty: 1, kind: 'instrument' },
      { code: 'X-86-9915', description: 'SCREW CADDY', qty: 0, kind: 'instrument' }
    ])
  })

  it('reads the compact form the model now answers in — "super slow" was mostly writing', () => {
    const out = cleanTrays({ trays: [{ name: 'Tray 1', lines: [['X-1', 'AWL 10MM', 1, 'm'], ['X-2', 'PLATE 5MM', 2, 'i']] }] })
    expect(out.trays[0].lines).toEqual([
      { code: 'X-1', description: 'AWL 10MM', qty: 1, kind: 'instrument' },
      { code: 'X-2', description: 'PLATE 5MM', qty: 2, kind: 'implant' }
    ])
  })

  it('carries which photo shows each tray — "the photo of the tray MUST come across"', () => {
    const out = cleanTrays({ trays: [
      { name: 'Tray 1', photo: 2, lines: [['X-1', 'AWL', 1, 'm']] },
      { name: 'Tray 2', photo: null, lines: [['X-2', 'PLATE', 1, 'i']] },
      { name: 'Tray 3', photo: 'none', lines: [['X-3', 'TAP', 1, 'm']] }
    ] })
    expect(out.trays.map(t => t.photo)).toEqual([2, null, null])
  })

  it('keeps two trays printed with the same heading apart', () => {
    const line = { code: 'A', description: 'a', qty: 1 }
    const out = cleanTrays({ trays: [{ name: 'Screws', lines: [line] }, { name: 'Screws', lines: [line] }, { name: 'Empty', lines: [] }] })
    expect(out.trays.map(t => t.name)).toEqual(['Screws', 'Screws (2)'])
  })
})

const store = new Map()
const lists = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, ...args) => {
    if (cmd === 'get') return store.get(args[0]) ?? null
    if (cmd === 'mget') return args.map(k => store.get(k) ?? null)
    if (cmd === 'lpush') { lists.set(args[0], [args[1], ...(lists.get(args[0]) || [])]); return 1 }
    if (cmd === 'ltrim' || cmd === 'del' || cmd === 'expire') return 1
    if (cmd === 'lrange') return lists.get(args[0]) || []
    return null
  }),
  redisSetBody: vi.fn(async (k, v) => { store.set(k, v); return 'OK' })
}))

describe('saving a tray list onto a kit', () => {
  beforeEach(() => { store.clear(); lists.clear() })

  it('stores the lines and makes the kit\'s trays the list\'s trays', async () => {
    const { listKits, saveTrayList, getTrayList } = await import('./_kits.js')
    const kit = (await listKits()).find(k => k.system === 'Shoreline' && k.home === 'RHH')
    await saveTrayList(kit.id, {
      trays: [{ name: 'Tray 1 – Instruments', lines: [{ code: 'X-1', description: 'AWL', qty: 1, kind: 'instrument' }] },
        { name: 'Tray 2 – Plates', lines: [{ code: 'X-2', description: 'PLATE', qty: 2, kind: 'implant' }] }],
      source: { file: 'RHH Shoreline.pdf', hospital: 'RHH' }
    }, 'Ben')
    expect((await getTrayList(kit.id)).source).toMatchObject({ file: 'RHH Shoreline.pdf', hospital: 'RHH', by: 'Ben' })
    expect((await listKits()).find(k => k.id === kit.id).trays).toEqual(['Tray 1 – Instruments', 'Tray 2 – Plates'])
  })

  it('keeps a tray photo only from the photos folder', async () => {
    const { listKits, saveTrayList, getTrayList, isTrayPhotoPath } = await import('./_kits.js')
    const kit = (await listKits())[0]
    await saveTrayList(kit.id, { trays: [
      { name: 'A', photo: '/Tray Lists/Tray Photos/Kit/A.jpg', lines: [{ code: 'X', description: 'x', qty: 1 }] },
      { name: 'B', photo: '/ALL SURGEON USAGE/SPINE/case.pdf', lines: [{ code: 'Y', description: 'y', qty: 1 }] }
    ] }, 'Ben')
    expect((await getTrayList(kit.id)).trays.map(t => t.photo)).toEqual(['/Tray Lists/Tray Photos/Kit/A.jpg', null])
    expect(isTrayPhotoPath('/Tray Lists/Tray Photos/Kit/A.jpg')).toBe(true)
    expect(isTrayPhotoPath('/Tray Lists/Tray Photos/../ALL SURGEON USAGE/x.jpg')).toBe(false)
    expect(isTrayPhotoPath('/ALL SURGEON USAGE/x.jpg')).toBe(false)
  })

  it('renames a tray everywhere — "edit the tray name from an existing kit"', async () => {
    const { listKits, saveTrayList, getTrayList, saveKitDef } = await import('./_kits.js')
    const kit = (await listKits()).find(k => k.system === 'Shoreline' && k.home === 'RHH')
    await saveTrayList(kit.id, { trays: [
      { name: 'Tray 1', photo: '/Tray Lists/Tray Photos/Kit/Tray 1.jpg', lines: [{ code: 'X-1', description: 'AWL', qty: 1 }] },
      { name: 'Tray 2', lines: [{ code: 'X-2', description: 'PLATE', qty: 2, kind: 'implant' }] }
    ] }, 'Ben')
    const now = (await listKits()).find(k => k.id === kit.id)
    await saveKitDef({ ...now, trays: ['Instruments', 'Tray 2'] }, 'Brent', [{ from: 'Tray 1', to: 'Instruments' }])
    expect((await listKits()).find(k => k.id === kit.id).trays).toEqual(['Instruments', 'Tray 2'])
    const list = await getTrayList(kit.id)
    expect(list.trays[0]).toMatchObject({ name: 'Instruments', photo: '/Tray Lists/Tray Photos/Kit/Tray 1.jpg' })
    expect(list.trays[0].lines[0].code).toBe('X-1')
  })

  it('refuses two trays of the same name', async () => {
    const { listKits, saveKitDef } = await import('./_kits.js')
    const kit = (await listKits())[0]
    await expect(saveKitDef({ ...kit, trays: ['Screws', 'screws'] }, 'Brent')).rejects.toThrow(/Two trays/)
  })

  it('refuses an empty list rather than wiping the one there', async () => {
    const { listKits, saveTrayList } = await import('./_kits.js')
    const kit = (await listKits())[0]
    await expect(saveTrayList(kit.id, { trays: [{ name: 'x', lines: [] }] }, 'Ben')).rejects.toThrow(/nothing/)
  })
})
