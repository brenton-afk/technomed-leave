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
