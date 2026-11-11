import { describe, it, expect, vi, beforeEach } from 'vitest'

// Brent, 11 Nov 2026: the kit room as a live ecosystem — consignment
// agreements and documents on each kit, a shared tile order, and every member
// of staff able to make changes. Dropbox and Redis are faked; names invented.

const store = new Map()
const uploads = []
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, ...args) => {
    if (cmd === 'get') return store.get(args[0]) ?? null
    if (cmd === 'mget') return args.map(k => store.get(k) ?? null)
    if (cmd === 'lpush') { store.set(args[0], [args[1], ...(store.get(args[0]) || [])]); return 1 }
    if (cmd === 'lrange') return store.get(args[0]) || []
    return 'OK'
  }),
  redisSetBody: vi.fn(async (k, v) => { store.set(k, v); return 'OK' })
}))
vi.mock('./_dropbox.js', () => ({
  dropboxConfigured: () => true,
  ensureFolder: vi.fn(async p => p),
  uploadFile: vi.fn(async (path, buf) => { uploads.push(path); return { name: path.split('/').pop(), path_display: path } }),
  temporaryLink: vi.fn(async path => ({ url: `https://dl.example/${encodeURIComponent(path)}`, name: path.split('/').pop() }))
}))

const docs = await import('./_kitDocs.js')
const kit = { id: 'k1', name: 'Diplomat RHH' }

beforeEach(() => { store.clear(); uploads.length = 0 })

describe("a kit's documents", () => {
  it('files a consignment agreement under the kit and lists it', async () => {
    const doc = await docs.keepKitDoc(kit, { buffer: Buffer.from('pdf'), filename: 'Agreement 2026.pdf', kind: 'consignment' }, 'Aimee')
    expect(uploads).toEqual(['/Kit Room/Diplomat RHH/Consignment Agreements/Agreement 2026.pdf'])
    expect(doc).toMatchObject({ kind: 'consignment', name: 'Agreement 2026.pdf', by: 'Aimee' })
    expect((await docs.listKitDocs('k1')).map(d => d.name)).toEqual(['Agreement 2026.pdf'])
    expect(await docs.docCounts(['k1', 'k2'])).toEqual({ k1: { docs: 1, consignment: 1 }, k2: { docs: 0, consignment: 0 } })
  })

  it('opens only a document the kit lists, and taking one off leaves Dropbox alone', async () => {
    const doc = await docs.keepKitDoc(kit, { buffer: Buffer.from('x'), filename: 'Notes.docx' }, 'Mat')
    expect(doc.kind).toBe('other')
    expect((await docs.kitDocLink('k1', doc.id)).url).toContain('Documents')
    await expect(docs.kitDocLink('k1', 'nope')).rejects.toThrow(/no longer/)
    await docs.removeKitDoc('k1', doc.id)
    expect(await docs.listKitDocs('k1')).toEqual([])
  })

  it('keeps a file name out of the folder structure', async () => {
    await docs.keepKitDoc(kit, { buffer: Buffer.from('x'), filename: '../../ALL SURGEON USAGE/x.pdf' }, 'Mat')
    expect(uploads[0].startsWith('/Kit Room/Diplomat RHH/Documents/')).toBe(true)
    expect(uploads[0].split('/').length).toBe(5)
  })
})

describe('the tile order', () => {
  it('keeps only known kits, once each', async () => {
    const kits = await import('./_kits.js')
    const ids = (await kits.listKits()).map(k => k.id)
    const saved = await kits.saveKitOrder([ids[1], 'made-up', ids[0], ids[1]], 'Toni')
    expect(saved).toEqual([ids[1], ids[0]])
    expect(await kits.getKitOrder()).toEqual([ids[1], ids[0]])
  })
})

describe('adding from Dropbox (Brent, 11 Nov 2026: "Build option 2")', () => {
  const f = (path, extra = {}) => ({ name: path.split('/').pop(), path, size: 1, kind: docs.kindForPath(path), ...extra })
  const CA = '/Admin/Consignment Agreements'
  const catalogue = [
    f(`${CA}/RHH Consignment Agreements/Signus Diplomat Consignment Agreement TM-RHH 2023.docx`),
    f(`${CA}/RHH Consignment Agreements/PDF format Consignment Agreements/Signus Diplomat Consignment Agreement TM-RHH 2023.pdf`),
    f(`${CA}/Calvary Lenah Valley Consignmnet Agreements/CONSIGNMENT AGREEMENT CLV - Signus Diplomat 2023.pdf`),
    f(`${CA}/Calvary Lenah Valley Consignmnet Agreements/CONSIGNMENT AGREEMENT CLV - Signus Diplomat 2024 update.pdf`),
    f(`${CA}/RHH Consignment Agreements/E4 Dakota Consignment Agreement TM-RHH 2025.pdf`)
  ]

  it('offers only files in the agreement, tray list and kit room folders', () => {
    expect(docs.linkablePath(`${CA}/RHH/x.pdf`)).toBe(true)
    expect(docs.linkablePath('/Tray Lists/Hospital Copies/RHH/x.pdf')).toBe(true)
    expect(docs.linkablePath('/ALL SURGEON USAGE/SPINE/x.pdf')).toBe(false)
    expect(docs.linkablePath('/Admin/Accounts/prices.xlsx')).toBe(false)
    expect(docs.linkablePath(`${CA}/../Accounts/x.pdf`)).toBe(false)
  })

  it("suggests the kit's own hospital first, and a PDF and Word copy as one", () => {
    const out = docs.suggestFor({ id: 'k', name: 'Diplomat', system: 'Diplomat', home: 'RHH' }, catalogue)
    expect(out[0].name).toBe('Signus Diplomat Consignment Agreement TM-RHH 2023.pdf')
    expect(out.filter(o => /TM-RHH 2023/.test(o.name))).toHaveLength(1)
    expect(out.some(o => /Dakota/.test(o.name))).toBe(false)
  })

  it('attaches only a clear match by itself, and lists the rest for a person', () => {
    const kits = [
      { id: 'a', name: 'Diplomat', system: 'Diplomat', home: 'RHH' },
      { id: 'b', name: 'Diplomat 1', system: 'Diplomat', home: 'CLV' },
      { id: 'c', name: 'Lonestar', system: 'Lonestar', home: 'RHH' },
      { id: 'd', name: 'Dakota', system: 'Dakota', home: 'RHH' }
    ]
    const { sure, unsure } = docs.proposeAgreements(kits, catalogue, { d: [{ kind: 'consignment', path: 'x' }] })
    // b: two versions of the same agreement — the newer year wins outright.
    expect(sure.map(s => s.kitId)).toEqual(['a', 'b'])
    expect(sure[1].name).toMatch(/2024 update/)
    expect(unsure).toEqual([])
    // A signed copy against a newer unsigned one is a person's call.
    const signed = [...catalogue, f(`${CA}/Calvary Lenah Valley Consignmnet Agreements/CONSIGNMENT AGREEMENT CLV - Signus Diplomat (SIGNED).pdf`)]
    expect(docs.proposeAgreements([kits[1]], signed, {}).unsure.map(u => u.kitId)).toEqual(['b'])
  })

  it('links by path — no copy — and refuses anything outside those folders', async () => {
    const open = vi.fn(async p => ({ url: 'u', name: p.split('/').pop() }))
    const doc = await docs.linkKitDoc(kit, { path: catalogue[1].path }, 'Brent', { open })
    expect(doc).toMatchObject({ linked: true, kind: 'consignment', name: 'Signus Diplomat Consignment Agreement TM-RHH 2023.pdf' })
    expect(uploads).toEqual([])
    expect((await docs.linkKitDoc(kit, { path: catalogue[1].path }, 'Brent', { open })).id).toBe(doc.id)
    await expect(docs.linkKitDoc(kit, { path: '/ALL SURGEON USAGE/x.pdf' }, 'Brent', { open })).rejects.toThrow(/Only files/)
  })

  it('builds the catalogue from those folders only, leaving tray photos out', async () => {
    const list = vi.fn(async root => (root === '/Tray Lists'
      ? [{ name: 'Tray 1.jpg', path: '/Tray Lists/Tray Photos/Kit/Tray 1.jpg' }, { name: 'RHH.pdf', path: '/Tray Lists/Hospital Copies/RHH.pdf' }]
      : []))
    const out = await docs.dropboxCatalogue({ fresh: true, list })
    expect(list.mock.calls.map(c => c[0])).toEqual(docs.LINK_ROOTS)
    expect(out.map(f => [f.name, f.kind])).toEqual([['RHH.pdf', 'traylist']])
  })
})

describe('TM loan kits (Brent, 11 Nov 2026: "don\'t require consignment agreements")', () => {
  it('are never offered an agreement in the one-pass attach', async () => {
    const { needsAgreement } = await import('../src/kit/agreements.js')
    expect(needsAgreement({ kind: 'floating' })).toBe(false)
    expect(needsAgreement({ kind: 'consignment' })).toBe(true)
    expect(needsAgreement({})).toBe(true)
    const cat = [{ name: 'CONSIGNMENT AGREEMENT RHH - Dakota 2025.pdf', path: '/Admin/Consignment Agreements/RHH Consignment Agreements/CONSIGNMENT AGREEMENT RHH - Dakota 2025.pdf', kind: 'consignment' }]
    const kits = [
      { id: 'loan', name: 'Dakota (TM loan)', system: 'Dakota', home: 'RHH', kind: 'floating' },
      { id: 'cons', name: 'Dakota', system: 'Dakota', home: 'RHH', kind: 'consignment' }
    ]
    const { sure, unsure } = docs.proposeAgreements(kits, cat, {})
    expect([...sure, ...unsure].map(x => x.kitId)).toEqual(['cons'])
  })
})
