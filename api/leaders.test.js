import { describe, it, expect, vi, beforeEach } from 'vitest'

// Turns run Friday to Thursday (Brent, 5 Nov 2026): "tomorrow team leader is
// Brent until the following Thursday and then it changes to Ben."
const store = new Map()
vi.mock('./_redis.js', () => ({
  getTeamLeader: async turn => store.get(`turn:${turn}`) || null,
  getDayLeaders: async dates => Object.fromEntries(dates.filter(d => store.has(`day:${d}`)).map(d => [d, store.get(`day:${d}`)]))
}))

const { leadersOn, turnLeader, leaderEmailOn } = await import('./_leaders.js')

describe('who leads, day by day', () => {
  beforeEach(() => store.clear())

  it('has Brent from Friday 6 to Thursday 12 November, covering for Mat, then Ben from Friday 13', async () => {
    const week = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']
    const byDay = await leadersOn(['2026-11-06', ...week])
    for (const d of ['2026-11-06', ...week.slice(0, 4)]) {
      expect(byDay[d].firstName, d).toBe('Brent')
      expect(byDay[d].source).toBe('set')
      expect(byDay[d].rostered.firstName).toBe('Mat')
    }
    expect(byDay['2026-11-13'].firstName).toBe('Ben')
    expect(byDay['2026-11-13'].source).toBe('roster')
    expect(byDay['2026-11-13'].turn).toBe('2026-11-13')
    expect(byDay['2026-11-13'].ends).toBe('2026-11-19')
  })

  it('lets a saved turn and a changed day override the rota, in that order', async () => {
    store.set('turn:2026-11-13', { email: 'mat@technomed.com.au', name: 'Mat Usher', firstName: 'Mat' })
    store.set('day:2026-11-17', { email: 'aimee@technomed.com.au', name: 'Aimee Vulinovich', firstName: 'Aimee' })
    const byDay = await leadersOn(['2026-11-16', '2026-11-17'])
    expect(byDay['2026-11-16'].firstName).toBe('Mat')
    expect(byDay['2026-11-17'].firstName).toBe('Aimee')
    expect(byDay['2026-11-17'].turnLeader.firstName).toBe('Mat')
    expect((await turnLeader('2026-11-19')).firstName).toBe('Mat')
  })

  it('names the right person for allocation and the usage escalation', async () => {
    expect(await leaderEmailOn('2026-11-12')).toBe('brenton@technomed.com.au')
    expect(await leaderEmailOn('2026-11-13')).toBe('ben@technomed.com.au')
  })
})
