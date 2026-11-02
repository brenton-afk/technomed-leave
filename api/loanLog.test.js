import { describe, it, expect, vi } from 'vitest'

// "Once the request for a loan set is sent to the distributor, the portal is
// updated to say that the request was made, by whom and at what time and date
// the loan set was requested." — Brent, 2 Nov 2026. Fake booking ids.

const lists = new Map()
const store = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, key, ...args) => {
    if (cmd === 'lpush') lists.set(key, [args[0], ...(lists.get(key) || [])])
    if (cmd === 'ltrim') lists.set(key, (lists.get(key) || []).slice(args[0], Number(args[1]) + 1))
    if (cmd === 'lrange') return (lists.get(key) || []).slice(args[0], Number(args[1]) + 1)
    if (cmd === 'del') store.delete(key)
    if (cmd === 'get') return store.get(key) || null
    return null
  }),
  redisSetBody: vi.fn(async (key, value) => { store.set(key, value) })
}))

const { recordLoanRequest, loanLogFor } = await import('./_bookingNotices.js')

describe('the booking remembers every loan email', () => {
  it('who sent it, when, to whom and for which set — and a call-off too', async () => {
    const loan = status => ({ distributor: 'device', status, date: '2026-11-12', hospital: 'CLV', systems: ['Mariner MIS'] })
    await recordLoanRequest({ eventId: 'evt-1', name: 'Device Technologies — loan set request', loan: loan('request') }, 'Brent')
    await recordLoanRequest({ eventId: 'evt-1', name: 'Calvary loan sets — loan set ordered',
      loan: { ...loan('request'), distributor: 'hosp-CLV' } }, 'Brent')
    await recordLoanRequest({ eventId: 'evt-1', name: 'Device Technologies — loan set no longer needed', loan: loan('cancel') }, 'Mat')

    const log = await loanLogFor('evt-1')
    expect(log.map(l => [l.status, l.to, l.by, l.hospital])).toEqual([
      ['cancel', 'Device Technologies', 'Mat', false],
      ['request', 'Calvary loan sets', 'Brent', true],
      ['request', 'Device Technologies', 'Brent', false]
    ])
    expect(log[2].systems).toEqual(['Mariner MIS'])
    expect(Number.isNaN(Date.parse(log[2].at))).toBe(false)
    // The state that decides the next email is still cleared on a call-off.
    expect(store.has('loanreq:evt-1:device')).toBe(false)
  })
})
