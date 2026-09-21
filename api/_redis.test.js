import { describe, it, expect, vi, afterEach } from 'vitest'

// The module reads its credentials once, at import. Setting them in beforeEach
// is too late — hoisted, so it runs before the import below.
vi.hoisted(() => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
})

import { getRunsheet, tickRunsheetItem, untickRunsheetItem } from './_redis.js'

// The team leader's run-sheet is shared: the role runs on a weekly rotation and
// the point of publishing it is that anyone can see the day's duties are done.
// That makes concurrent writes the normal case rather than an edge one — a
// handover is exactly when two people are on the same sheet.

/** A stand-in Upstash that records the commands it was given. */
function fakeRedis({ hash = {}, shape = 'array' } = {}) {
  const calls = []
  global.fetch = vi.fn(async url => {
    const [command, ...args] = String(url).split('/').slice(3).map(decodeURIComponent)
    calls.push([command, ...args])
    if (command === 'hgetall') {
      const entries = Object.entries(hash)
      return { json: async () => ({
        result: shape === 'array' ? entries.flat() : Object.fromEntries(entries)
      }) }
    }
    if (command === 'hset') { hash[args[1]] = args[2]; return { json: async () => ({ result: 1 }) } }
    if (command === 'hdel') { delete hash[args[1]]; return { json: async () => ({ result: 1 }) } }
    return { json: async () => ({ result: 'OK' }) }
  })
  return { calls, hash }
}

afterEach(() => vi.restoreAllMocks())

describe('reading a day', () => {
  it('returns who ticked what', async () => {
    fakeRedis({ hash: { 'morning-sweep': JSON.stringify({ by: 'Ben', at: '2026-09-21T20:42:00Z' }) } })
    const ticks = await getRunsheet('2026-09-21')
    expect(ticks['morning-sweep']).toEqual({ by: 'Ben', at: '2026-09-21T20:42:00Z' })
  })

  it('copes with either shape Upstash returns HGETALL in', async () => {
    // Flat [field, value, …] or an object, depending on the endpoint version.
    // Guessing wrong presents as an empty run-sheet, which looks exactly like a
    // day nobody has started — a silent failure rather than a loud one.
    for (const shape of ['array', 'object']) {
      fakeRedis({ hash: { a: JSON.stringify({ by: 'Mat', at: 'x' }) }, shape })
      expect((await getRunsheet('2026-09-21')).a.by).toBe('Mat')
    }
  })

  it('is empty on a day nobody has started', async () => {
    fakeRedis()
    expect(await getRunsheet('2026-09-21')).toEqual({})
  })

  it('skips a malformed field rather than losing the whole sheet', async () => {
    fakeRedis({ hash: { good: JSON.stringify({ by: 'Ben', at: 'x' }), bad: 'not json' } })
    const ticks = await getRunsheet('2026-09-21')
    expect(ticks.good.by).toBe('Ben')
    expect(ticks.bad).toBeUndefined()
  })
})

describe('ticking an item', () => {
  it('records who and when', async () => {
    const { hash } = fakeRedis()
    await tickRunsheetItem('2026-09-21', 'evening-sweep', 'Ben', '2026-09-21T12:00:00Z')
    expect(JSON.parse(hash['evening-sweep'])).toEqual({ by: 'Ben', at: '2026-09-21T12:00:00Z' })
  })

  it('writes one field rather than the whole day', async () => {
    // The correctness point. Read the day as one blob, add a tick, write it
    // back, and a tick made in between is lost — at a handover, which is when
    // two people are most likely to be on the sheet together.
    const { calls } = fakeRedis()
    await tickRunsheetItem('2026-09-21', 'a', 'Ben')
    expect(calls.map(c => c[0])).toContain('hset')
    expect(calls.map(c => c[0])).not.toContain('set')
    expect(calls.map(c => c[0])).not.toContain('get')
  })

  it('does not lose a tick made at the same moment on another item', async () => {
    const { hash } = fakeRedis()
    await Promise.all([
      tickRunsheetItem('2026-09-21', 'morning-sweep', 'Ben'),
      tickRunsheetItem('2026-09-21', 'list-orders', 'Mat')
    ])
    expect(Object.keys(hash).sort()).toEqual(['list-orders', 'morning-sweep'])
  })

  it('keeps the day alive while it is being worked on', async () => {
    // The expiry is refreshed on every write, so a sheet cannot lapse underneath
    // the person filling it in.
    const { calls } = fakeRedis()
    await tickRunsheetItem('2026-09-21', 'a', 'Ben')
    expect(calls.some(c => c[0] === 'expire')).toBe(true)
  })

  it('can be undone', async () => {
    // A checklist you cannot correct is a checklist people stop trusting.
    const { hash } = fakeRedis()
    await tickRunsheetItem('2026-09-21', 'a', 'Ben')
    await untickRunsheetItem('2026-09-21', 'a')
    expect(hash.a).toBeUndefined()
  })
})

describe('the day a tick belongs to', () => {
  it('is part of the key, so days cannot bleed into each other', async () => {
    const { calls } = fakeRedis()
    await tickRunsheetItem('2026-09-21', 'a', 'Ben')
    expect(calls.find(c => c[0] === 'hset')[1]).toBe('runsheet:2026-09-21')
  })
})
