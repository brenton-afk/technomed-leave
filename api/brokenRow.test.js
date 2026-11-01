import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Task 3: one bad row must not take the page ──────────────────────────────
// "Unterminated string in JSON at position 6964 (line 138 column 50)" on
// Team > Projects. The whole page died.
//
// Two things could write a row that cannot be read back, and both are closed
// now — a model answer that ran out of room mid-word (capped at 2,000 tokens,
// raised in October and salvaged since), and a value long enough to be cut
// short on its way into Redis, which is what worklist rows risked while they
// travelled by URL path rather than in the request body.
//
// This is the third line of defence, and the one the task actually asked for:
// "if one item fails to parse, show the rest and flag the broken item, rather
// than failing the whole page." Whatever wrote it, the board opens.

const store = new Map()
const lists = new Map()

vi.stubGlobal('fetch', vi.fn(async url => {
  const path = decodeURIComponent(String(url).split('/').slice(3).join('/'))
  const [command, ...args] = path.split('/')

  if (command === 'lrange') return { json: async () => ({ result: lists.get(args[0]) || [] }) }
  if (command === 'get') return { json: async () => ({ result: store.get(args[0]) ?? null }) }
  return { json: async () => ({ result: 'OK' }) }
}))

process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test'
process.env.UPSTASH_REDIS_REST_TOKEN = 'token'

const { getWorklist, getProjects, getEmailLog } = await import('./_redis.js')

const good = (id, task) => JSON.stringify({ id, task, status: 'open' })

// What a row cut off mid-word actually looks like in storage.
const TRUNCATED = '{"id":"t2","task":"Order two Reform screws for Thurs'

beforeEach(() => {
  store.clear()
  lists.clear()
})
afterEach(() => vi.clearAllMocks())

describe('a worklist with one unreadable row', () => {
  beforeEach(() => {
    lists.set('worklist:all', ['t1', 't2', 't3'])
    store.set('worklist:t1', good('t1', 'Chase the Globus paperwork'))
    store.set('worklist:t2', TRUNCATED)
    store.set('worklist:t3', good('t3', 'Book the Calvary in-service'))
  })

  it('still returns the rows that are fine', async () => {
    // Thirty tasks nobody can reach because of one of them — and the one that
    // broke is not even the one being looked for.
    const { items } = await getWorklist()
    expect(items.map(i => i.id)).toEqual(['t1', 't3'])
  })

  it('does not throw', async () => {
    await expect(getWorklist()).resolves.toBeTruthy()
  })

  it('says which row could not be read', async () => {
    // Named rather than dropped. A board that quietly loses somebody's task is
    // worse than one that admits it — and this is the only way anybody learns
    // a row needs repairing.
    const { unreadable } = await getWorklist()
    expect(unreadable).toEqual(['t2'])
  })

  it('does not count a row that was never there as broken', async () => {
    // An id in the list with nothing behind it is a deleted row, not a
    // corrupt one, and reporting it would send somebody looking for nothing.
    lists.set('worklist:all', ['t1', 'gone'])
    store.delete('worklist:t2')
    const { items, unreadable } = await getWorklist()
    expect(items.map(i => i.id)).toEqual(['t1'])
    expect(unreadable).toEqual([])
  })
})

describe('when everything is readable', () => {
  it('reports nothing broken', async () => {
    lists.set('worklist:all', ['t1'])
    store.set('worklist:t1', good('t1', 'Chase the Globus paperwork'))
    const { items, unreadable } = await getWorklist()
    expect(items).toHaveLength(1)
    expect(unreadable).toEqual([])
  })

  it('copes with a board nobody has used yet', async () => {
    const { items, unreadable } = await getWorklist()
    expect(items).toEqual([])
    expect(unreadable).toEqual([])
  })
})

describe('the same rule everywhere a list is read', () => {
  it('one unreadable project does not cost the board', async () => {
    lists.set('project:all', ['p1', 'p2'])
    store.set('project:p1', JSON.stringify({ id: 'p1', name: 'Globus onboarding' }))
    store.set('project:p2', '{"id":"p2","name":"Calvary ref')
    const projects = await getProjects()
    expect(projects.map(p => p.id)).toEqual(['p1'])
  })

  it('one unreadable email does not cost the log', async () => {
    lists.set('email:all', ['e1', 'e2'])
    store.set('email:e1', JSON.stringify({ id: 'e1', kind: 'usage', status: 'sent' }))
    store.set('email:e2', '{"id":"e2","kind":"usa')
    const entries = await getEmailLog(10)
    expect(entries.map(e => e.id)).toEqual(['e1'])
  })
})
