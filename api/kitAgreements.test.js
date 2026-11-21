import { describe, it, expect, vi, beforeEach } from 'vitest'

// Brent, 21 Nov 2026: the kit room filled from the consignment agreements —
// "only empty or missing trays are filled". Invented kits and trays.
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
vi.mock('./_kitAgreementData.js', () => ({
  AGREEMENTS: [
    { doc: 'clv-widget', kit: 'Widget', hospital: 'CLV', distributor: 'signus', agreement: { path: '/Admin/Consignment Agreements/x.pdf', name: 'x.pdf' },
      trays: [
        { name: 'Widget Insertion', set: 1, photo: 'p4_1.jpg', lines: [{ code: 'A1', description: 'Driver', qty: 1, kind: 'instrument' }] },
        { name: 'Widget Screws', set: 1, photo: null, lines: [{ code: 'S1', description: 'Screw', qty: 4, kind: 'implant' }] },
        { name: 'Widget Insertion', set: 2, photo: null, lines: [{ code: 'A1', description: 'Driver', qty: 1, kind: 'instrument' }] }
      ] },
    { doc: 'rhh-gadget', kit: 'TM Gadget', hospital: 'RHH', agreement: { path: '/Admin/Consignment Agreements/g.pdf', name: 'g.pdf' },
      trays: [{ name: 'TM Gadget Tray', set: 1, photo: null, lines: [{ code: 'G1', description: 'Gadget', qty: 1, kind: 'instrument' }] }] }
  ],
  PHOTO_LOADERS: { 'clv-widget': async () => ({ PHOTOS: { 'p4_1.jpg': Buffer.from('jpg').toString('base64') } }) }
}))

const { planForSet, sameTray, fillFromAgreement, agreementStatus, addMissingPhotos, byCodes } = await import('./_kitAgreements.js')
const { getTrayList, getDefs } = await import('./_kits.js')

const deps = { upload: vi.fn(async () => {}), listDocs: vi.fn(async () => []), link: vi.fn(async () => {}) }
beforeEach(() => {
  store.clear()
  store.set('kits:applied', JSON.stringify(['outrigger-consigned-clv-2026-11-02', 'reform-lumbar-returned-2026-11-02', 'mariner-mis-clv-2026-11-21', 'mariner-mis-photos-2026-11-21', 'shoreline-trays-2026-11-21', 'shoreline-photos-clv-2026-11-21', 'catenary-name-2026-11-21', 'set-n-systems-2026-11-21', 'catenary-trays-clv-2026-11-21']))
  store.set('kits:defs', JSON.stringify([
    { id: 'widget-clv-1', name: 'Widget 1', system: 'Widget', home: 'CLV', kind: 'consignment', trays: ['Insertion 1-1'] },
    { id: 'widget-clv-2', name: 'Widget 2', system: 'Widget', home: 'CLV', kind: 'consignment', trays: ['Insertion 2-1'] }
  ]))
  vi.clearAllMocks()
})

describe('matching trays', () => {
  it('knows the same tray under another name', () => {
    expect(sameTray('Rods and tulips 1-3', 'Diplomat Rods & Tulips 1-3', 'Diplomat')).toBe(true)
    expect(sameTray('Insertion 2-1', 'Diplomat Pedicle Screws 1-5', 'Diplomat')).toBe(false)
  })
  it('replaces a list with nothing filled; adds only missing trays to a filled one', () => {
    const trays = [{ name: 'W Insertion', lines: [1] }, { name: 'W Screws', lines: [1] }]
    expect(planForSet({ trays: [{ name: 'Placeholder', lines: [] }] }, trays, 'W')).toMatchObject({ mode: 'replace', skipped: 0 })
    const plan = planForSet({ trays: [{ name: 'Insertion', lines: [{}] }] }, trays, 'W')
    expect(plan).toMatchObject({ mode: 'add', skipped: 1 })
    expect(plan.add.map(t => t.name)).toEqual(['W Screws'])
  })
})

describe('filling', () => {
  it('fills each set with its own trays, files the photo, attaches the agreement, once', async () => {
    const rec = await fillFromAgreement('clv-widget', 'Brent', deps)
    expect(rec.results.map(r => [r.kitId, r.added, r.attached])).toEqual([['widget-clv-1', 2, true], ['widget-clv-2', 1, true]])
    const one = await getTrayList('widget-clv-1')
    expect(one.trays.map(t => t.name)).toEqual(['Widget Insertion', 'Widget Screws'])
    expect(one.trays[0].photo).toBe('/Tray Lists/Tray Photos/Widget 1/Widget Insertion.jpg')
    expect(deps.upload).toHaveBeenCalledTimes(1)
    // No prices anywhere on the list.
    expect(JSON.stringify(one)).not.toMatch(/\$|price/i)
    expect((await fillFromAgreement('clv-widget', 'Brent', deps)).already).toBe(true)
    expect((await agreementStatus()).find(a => a.doc === 'clv-widget').done).toBeTruthy()
  })
  it('leaves a filled tray alone', async () => {
    store.set('kits:list:widget-clv-1', JSON.stringify({ source: {}, trays: [{ name: 'Insertion 1-1', lines: [{ code: 'Z', description: 'Mine', qty: 9, kind: 'instrument' }] }] }))
    await fillFromAgreement('clv-widget', 'Brent', deps)
    const one = await getTrayList('widget-clv-1')
    expect(one.trays.find(t => t.name === 'Insertion 1-1').lines[0].description).toBe('Mine')
    expect(one.trays.map(t => t.name)).toContain('Widget Screws')
    expect(one.trays.map(t => t.name)).not.toContain('Widget Insertion')
  })
  it('makes a set for a kit the room does not have yet', async () => {
    await fillFromAgreement('rhh-gadget', 'Brent', deps)
    const made = (await getDefs()).find(k => k.system === 'TM Gadget')
    expect(made).toMatchObject({ home: 'RHH', kind: 'technomed' })
    expect((await getTrayList(made.id)).trays[0].name).toBe('TM Gadget Tray')
  })
})

describe('photos the fill missed (Brent, 21 Nov 2026)', () => {
  it('says a photo was missed, and Add missing photos puts it on later', async () => {
    const failing = { ...deps, upload: vi.fn(async () => { throw new Error('too_many_write_operations') }) }
    const rec = await fillFromAgreement('clv-widget', 'Brent', failing)
    expect(rec.results[0]).toMatchObject({ added: 2, photos: 0, photosMissed: 1 })
    expect(failing.upload).toHaveBeenCalledTimes(3)
    expect((await getTrayList('widget-clv-1')).trays[0].photo).toBeFalsy()

    const upload = vi.fn(async () => {})
    const r = await addMissingPhotos('clv-widget', 'Brent', { upload })
    expect(r).toMatchObject({ added: 1, missed: 0, more: false })
    expect(upload).toHaveBeenCalledWith('/Tray Lists/Tray Photos/Widget 1/Widget Insertion.jpg', expect.any(Buffer))
    expect((await getTrayList('widget-clv-1')).trays[0].photo).toBe('/Tray Lists/Tray Photos/Widget 1/Widget Insertion.jpg')
    // Nothing left to do the second time.
    expect(await addMissingPhotos('clv-widget', 'Brent', { upload })).toMatchObject({ added: 0, more: false })
  })
  it('gives a tray that was already there, under its own name, the agreement photo', async () => {
    store.set('kits:list:widget-clv-1', JSON.stringify({ source: {}, trays: [{ name: 'Insertion 1-1', lines: [{ code: 'Z', description: 'Mine', qty: 9, kind: 'instrument' }] }] }))
    const r = await addMissingPhotos('clv-widget', 'Brent', { upload: vi.fn(async () => {}) })
    expect(r.added).toBe(1)
    const t = (await getTrayList('widget-clv-1')).trays[0]
    expect(t).toMatchObject({ name: 'Insertion 1-1', photo: '/Tray Lists/Tray Photos/Widget 1/Insertion 1-1.jpg' })
    expect(t.lines[0].description).toBe('Mine')
  })
  it('never replaces a photo a tray already has', async () => {
    store.set('kits:list:widget-clv-1', JSON.stringify({ source: {}, trays: [{ name: 'Widget Insertion', photo: '/Tray Lists/Tray Photos/Mine.jpg', lines: [] }] }))
    const upload = vi.fn(async () => {})
    expect((await addMissingPhotos('clv-widget', 'Brent', { upload })).added).toBe(0)
    expect(upload).not.toHaveBeenCalled()
  })
})

describe('a tray typed in by hand under another name', () => {
  it('is matched to its agreement tray by the codes it holds', () => {
    const agreement = [
      { name: 'Mariner Instruments 1', lines: [{ code: '2SEA-12-0001' }, { code: '2SEA-12-0002' }, { code: '2SEA-12-0003' }] },
      { name: 'Mariner Screws', lines: [{ code: '2SEA-55-0001' }, { code: '2SEA-55-0002' }] }
    ]
    const aimees = { name: 'RHH MARINER INST TRAY A', lines: [{ code: '12-0001' }, { code: 'SEA-12-0002' }, { code: '99-9999' }] }
    expect(byCodes(aimees, agreement).name).toBe('Mariner Instruments 1')
    expect(byCodes({ name: 'Other', lines: [{ code: '77-0001' }, { code: '77-0002' }] }, agreement)).toBeNull()
  })
})

describe('Dropbox header', () => {
  it('escapes a degree sign so the upload is not refused', async () => {
    const { apiArg } = await vi.importActual('./_dropbox.js')
    const h = apiArg({ path: '/Tray Lists/Tray Photos/Dakota 1/Dakota 7° Interbodies.jpg' })
    expect(h).toMatch(/^[\x20-\x7e]+$/)
    expect(JSON.parse(h).path).toContain('7° Interbodies')
  })
})

describe('tray names with numbers', () => {
  it('keeps tray 1 of 5 and tray 2 of 5 apart', () => {
    expect(sameTray('Pedicle screws 2-5', 'Diplomat Pedicle Screws 1-5', 'Diplomat')).toBe(false)
    expect(sameTray('Insertion 1-1', 'Widget Insertion', 'Widget')).toBe(true)
  })
})

describe('the agreements as read (21 Nov 2026)', () => {
  it('carry no prices, and every photo named has its file', async () => {
    const real = await vi.importActual('./_kitAgreementData.js')
    expect(real.AGREEMENTS.length).toBeGreaterThan(20)
    expect(JSON.stringify(real.AGREEMENTS)).not.toMatch(/\$|\bprice\b|\bAUD\b/i)
    for (const a of real.AGREEMENTS) {
      expect(a.agreement.path.startsWith('/Admin/Consignment Agreements/')).toBe(true)
      for (const t of a.trays) {
        expect(t.lines.length).toBeGreaterThan(0)
        if (t.photo) expect(real.PHOTO_LOADERS[a.doc]).toBeTypeOf('function')
      }
    }
  })
})
