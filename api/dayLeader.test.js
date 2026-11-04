import { describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
})

import { getDayLeaders, setDayLeader } from './_redis.js'

// Brent, 4 Nov 2026: the team leader as "a daily editable tab in the days,
// underneath the date". The week's rota stays the default; a day has its own
// entry only when somebody changed that day.
describe('team leader for one day', () => {
  it('stores a day, reads back only the days that were changed, and clears', async () => {
    const store = new Map()
    global.fetch = vi.fn(async url => {
      const [command, ...args] = String(url).split('/').slice(3).map(decodeURIComponent)
      if (command === 'set') store.set(args[0], args[1])
      if (command === 'del') store.delete(args[0])
      return { ok: true, json: async () => ({ result: command === 'get' ? (store.get(args[0]) ?? null) : 'OK' }) }
    })
    await setDayLeader('2026-11-04', { email: 'brenton@technomed.com.au', firstName: 'Brent' })
    expect(await getDayLeaders(['2026-11-03', '2026-11-04'])).toEqual({
      '2026-11-04': { email: 'brenton@technomed.com.au', firstName: 'Brent' }
    })
    await setDayLeader('2026-11-04', null)
    expect(await getDayLeaders(['2026-11-04'])).toEqual({})
  })
})
