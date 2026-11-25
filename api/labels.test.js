import { describe, it, expect, vi } from 'vitest'
import { labelStore, imageSize } from './_labels.js'

/** Just enough of Upstash for the label store, in memory. */
function fakeRedis() {
  const kv = new Map()
  const sets = new Map()
  const lists = new Map()
  const calls = []
  const redis = async (cmd, ...a) => {
    calls.push(cmd)
    switch (cmd) {
      case 'get': return kv.get(a[0]) ?? null
      case 'set': {
        if (a.includes('NX') && kv.has(a[0])) return null
        kv.set(a[0], a[1]); return 'OK'
      }
      case 'del': kv.delete(a[0]); return 1
      case 'mget': return a.map(k => kv.get(k) ?? null)
      case 'sadd': { const s = sets.get(a[0]) || new Set(); a.slice(1).forEach(v => s.add(v)); sets.set(a[0], s); return 1 }
      case 'srem': sets.get(a[0])?.delete(a[1]); return 1
      case 'smembers': return [...(sets.get(a[0]) || [])]
      case 'lpush': lists.set(a[0], [a[1], ...(lists.get(a[0]) || [])]); return 1
      case 'ltrim': return 'OK'
      default: throw new Error(`unexpected ${cmd}`)
    }
  }
  const setBody = async (k, v) => { calls.push('set'); kv.set(k, v); return 'OK' }
  return { redis, setBody, kv, sets, lists, calls }
}

const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
const seed = {
  SEED_LOGOS: [{ k: 'seaspine', name: 'SeaSpine', w: 1, h: 1, type: 'image/png' }],
  SEED_LABELS: [
    { id: 'a', name: 'Beta', w: 70.7, h: 23, items: [{ id: 'i1', t: 'img', k: 'seaspine', x: 1, y: 1, w: 5, h: 2, rot: 0 }] },
    { id: 'b', name: 'Alpha', w: 70.7, h: 24, items: [], check: 'Name says 1.6, label reads 1.8' }
  ]
}
const seedLogos = { LOGO_DATA: { seaspine: PNG_1x1 } }

function store(extra = {}) {
  const f = fakeRedis()
  const put = vi.fn(async path => `https://x.public.blob.vercel-storage.com/${path}`)
  return { f, put, s: labelStore({ redis: f.redis, setBody: f.setBody, put, seed, seedLogos, lockWait: 1, ...extra }) }
}

describe('Label Studio storage', () => {
  it('seeds once — labels in Redis, logos in Blob — and lists them by name', async () => {
    const { s, put, f } = store()
    const first = await s.listLabels()
    expect(first.labels.map(l => l.name)).toEqual(['Alpha', 'Beta'])
    expect(first.labels[0]).toMatchObject({ version: 1, check: 'Name says 1.6, label reads 1.8' })
    expect(first.logos.seaspine.url).toMatch(/blob\.vercel-storage\.com\/labels\/logos\/seaspine\.png$/)
    expect(put).toHaveBeenCalledTimes(1)
    f.calls.length = 0
    await s.listLabels()
    expect(put).toHaveBeenCalledTimes(1)
    // A list after seeding is a handful of commands, not one per label.
    expect(f.calls.length).toBeLessThanOrEqual(4)
  })

  it('does not seed twice at once', async () => {
    const { s, f } = store()
    await f.redis('set', 'labels:seeding', '1')
    expect((await s.listLabels()).seeding).toBe(true)
    expect(f.sets.get('labels:index')).toBeUndefined()
  })

  it('keeps a logo inline when Blob is not there', async () => {
    const { s } = store({ put: async () => { throw new Error('no token') } })
    const { logos } = await s.listLabels()
    expect(logos.seaspine.url).toBe(PNG_1x1)
  })

  it('saves against the version it opened, and refuses when someone saved first', async () => {
    const { s } = store()
    const { labels } = await s.listLabels()
    const beta = labels.find(l => l.id === 'a')
    const ok = await s.saveLabel('a', { ...beta, name: 'Beta 2' }, 1, 'Erin')
    expect(ok.label).toMatchObject({ name: 'Beta 2', version: 2, updatedBy: 'Erin' })
    const late = await s.saveLabel('a', { ...beta, name: 'Mine' }, 1, 'Brent')
    expect(late.conflict).toBe(true)
    expect(late.current.name).toBe('Beta 2')
    expect((await s.saveLabel('zzz', beta, 1, 'Brent')).missing).toBe(true)
  })

  it('never saves a logo that is not in the library', async () => {
    const { s } = store()
    await s.listLabels()
    const made = await s.createLabel({ name: 'New', w: 70.7, h: 23, items: [
      { t: 'img', k: 'seaspine', x: 1, y: 1, w: 2, h: 2 }, { t: 'img', k: 'elsewhere', x: 1, y: 1, w: 2, h: 2 }] }, 'Brent')
    expect(made.items.map(i => i.k)).toEqual(['seaspine'])
    expect(made.version).toBe(1)
    expect((await s.listLabels()).labels).toHaveLength(3)
  })

  it('deletes, keeping the label in labels:deleted', async () => {
    const { s, f } = store()
    await s.listLabels()
    await s.deleteLabel('b', 'Brent')
    expect((await s.listLabels()).labels.map(l => l.id)).toEqual(['a'])
    expect(JSON.parse(f.lists.get('labels:deleted')[0])).toMatchObject({ id: 'b', deletedBy: 'Brent' })
  })

  it('takes PNG and JPEG logos up to 2 MB, into Blob', async () => {
    const { s, put } = store()
    await s.listLabels()
    const out = await s.addLogo({ name: 'Globus logo.png', data: PNG_1x1 }, 'Brent')
    expect(out.logo).toMatchObject({ name: 'Globus logo', w: 1, h: 1, type: 'image/png' })
    expect(put.mock.calls.at(-1)[0]).toMatch(/^labels\/logos\/globus-logo-[0-9a-f]{6}\.png$/)
    expect((await s.listLabels()).logos[out.logo.k]).toBeTruthy()
    expect((await s.addLogo({ name: 'x', data: 'data:image/svg+xml;base64,PHN2Zz4=' }, 'B')).error).toMatch(/PNG or JPEG/)
    const big = `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 10).toString('base64')}`
    expect((await s.addLogo({ name: 'x', data: big }, 'B')).error).toMatch(/2 MB/)
  })

  it('reads a JPEG\'s size', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03, 0, 0, 0, 0, 0, 0])
    expect(imageSize(jpeg)).toEqual({ type: 'image/jpeg', w: 64, h: 32 })
    expect(imageSize(Buffer.from('nope'))).toBeNull()
  })
})
