process.env.PREF_ADDITIONS = 'off'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Task 18: editing preference cards in the portal ────────────────────────

const store = new Map()
const lists = new Map()
let who = { name: 'Aimee Vulinovich', email: 'aimee@technomed.com.au' }

vi.mock('./_auth.js', () => ({ requireSession: vi.fn(async () => who) }))
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, key, ...args) => {
    if (cmd === 'get') return store.get(key) ?? null
    if (cmd === 'lpush') { lists.set(key, [args[0], ...(lists.get(key) || [])]); return 1 }
    if (cmd === 'lrange') return lists.get(key) || []
    return 'OK'
  }),
  redisSetBody: vi.fn(async (key, value) => { store.set(key, value) })
}))

const { default: handler } = await import('./guides.js')

async function call(method, query, body) {
  const res = { statusCode: 0, payload: null, headers: {}, status(c) { this.statusCode = c; return this },
    json(d) { this.payload = d; return this }, setHeader(k, v) { this.headers[k] = v }, end() { return this } }
  await handler({ method, query, headers: {}, body }, res)
  return res
}

beforeEach(() => { store.clear(); lists.clear(); who = { name: 'Aimee Vulinovich', email: 'aimee@technomed.com.au' } })

const thaniDiplomat = cards => cards.data.surgeons.find(s => s.id === 'thani').systems.find(c => c.name === 'Diplomat')

describe('reading', () => {
  it('starts from Aimee\'s card, and says who may edit', async () => {
    const res = await call('GET', { prefs: '1' })
    expect(res.payload.version).toBe(0)
    expect(thaniDiplomat(res.payload).items).toContain('**Navigated probe**')
    expect(res.payload.canEdit).toBe(true)
  })
})

describe('editing', () => {
  it('saves a change for everyone, as a new version, with who and what', async () => {
    const before = (await call('GET', { prefs: '1' })).payload
    const i = before.data.surgeons.find(s => s.id === 'thani').systems.findIndex(c => c.name === 'Diplomat')
    const card = { ...thaniDiplomat(before), items: ['**Navigated probe**', 'New line from Aimee'] }
    const res = await call('POST', { prefs: '1' }, { baseVersion: 0, surgeonId: 'thani', index: i, card })
    expect(res.statusCode).toBe(200)
    const after = (await call('GET', { prefs: '1' })).payload
    expect(after.version).toBe(1)
    expect(after.updatedBy).toBe('Aimee')
    expect(thaniDiplomat(after).items).toEqual(['**Navigated probe**', 'New line from Aimee'])
    const history = (await call('GET', { prefs: 'history' })).payload.history
    expect(history[0]).toMatchObject({ version: 1, by: 'Aimee', summary: 'Edited Thani · Diplomat' })
  })

  it('refuses a save made against an older version, rather than overwriting', async () => {
    const card = { name: 'Diplomat', items: ['A'] }
    await call('POST', { prefs: '1' }, { baseVersion: 0, surgeonId: 'thani', index: 1, card })
    const res = await call('POST', { prefs: '1' }, { baseVersion: 0, surgeonId: 'thani', index: 1, card: { ...card, items: ['B'] } })
    expect(res.statusCode).toBe(409)
    expect(res.payload.error).toMatch(/changed the cards while you were editing/)
  })

  it('can add and remove a system', async () => {
    await call('POST', { prefs: '1' }, { baseVersion: 0, surgeonId: 'dubey', index: null, card: { name: 'Mariner MIS', items: ['Power driver'] } })
    let cards = (await call('GET', { prefs: '1' })).payload
    expect(cards.data.surgeons.find(s => s.id === 'dubey').systems.map(c => c.name)).toEqual(['Global PLIF', 'Mariner MIS'])
    await call('POST', { prefs: '1' }, { baseVersion: 1, surgeonId: 'dubey', index: 1, card: null })
    cards = (await call('GET', { prefs: '1' })).payload
    expect(cards.data.surgeons.find(s => s.id === 'dubey').systems.map(c => c.name)).toEqual(['Global PLIF'])
  })

  it('puts an earlier version back, as a new version, losing nothing', async () => {
    await call('POST', { prefs: '1' }, { baseVersion: 0, surgeonId: 'thani', index: 1, card: { name: 'Diplomat', items: ['Changed'] } })
    const res = await call('POST', { prefs: '1' }, { restore: 0 })
    expect(res.payload.version).toBe(2)
    expect(thaniDiplomat(res.payload).items).toContain('**Navigated probe**')
    const history = (await call('GET', { prefs: 'history' })).payload.history
    expect(history.map(h => h.summary)).toEqual(['Restored version 0', 'Edited Thani · Diplomat'])
  })

  it('stores bold as text, never HTML', async () => {
    const res = await call('POST', { prefs: '1' }, { baseVersion: 0, surgeonId: 'thani', index: 1, card: { name: 'Diplomat', items: ['<script>x</script> **ok**'] } })
    expect(thaniDiplomat(res.payload).items[0]).toBe('<script>x</script> **ok**')
  })
})

describe('who may edit', () => {
  it('not somebody outside the clinical team', async () => {
    who = { name: 'Toni Hoppitt', email: 'toni@technomed.com.au' }
    expect((await call('GET', { prefs: '1' })).payload.canEdit).toBe(false)
    const res = await call('POST', { prefs: '1' }, { baseVersion: 0, surgeonId: 'thani', index: 0, card: { name: 'X', items: [] } })
    expect(res.statusCode).toBe(403)
  })
})

// Brent, 7 Nov 2026: "Save as a card under the other orthopaedics cards".
describe('a card added from a conversation', async () => {
  const { applyAdditions } = await import('./_preferences.js')
  const addition = [{ id: 'test-add', group: /ortho/i, groupName: 'Orthopaedics',
    card: { name: 'Synthes Pelvic Recon (3.5 mm)', items: ['**3.5 cortex:** drill **2.5 mm**'] } }]
  const live = (surgeons) => ({ version: 7, data: { surgeons } })

  it('goes into the existing orthopaedics group, once', async () => {
    const before = live([{ id: 'thani', name: 'Thani', systems: [] }, { id: 'ortho', name: 'Orthopaedics', systems: [{ name: 'Existing', items: ['x'] }] }])
    const after = await applyAdditions(before, addition)
    const group = after.data.surgeons.find(g => g.name === 'Orthopaedics')
    expect(group.systems.map(c => c.name)).toEqual(['Existing', 'Synthes Pelvic Recon (3.5 mm)'])
    expect(after.version).toBe(8)
    const again = await applyAdditions(after, addition)
    expect(again.version).toBe(8)
  })

  it('makes the group when there is none', async () => {
    const after = await applyAdditions(live([{ id: 'thani', name: 'Thani', systems: [] }]), addition)
    expect(after.data.surgeons.at(-1)).toMatchObject({ name: 'Orthopaedics' })
  })
})

