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

  it('has Brent from Friday 6 to Thursday 12 November, then Mat from Friday 13 (Brent, 8 Nov 2026)', async () => {
    const week = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']
    const byDay = await leadersOn(['2026-11-06', ...week])
    for (const d of ['2026-11-06', ...week.slice(0, 4)]) {
      expect(byDay[d].firstName, d).toBe('Brent')
      expect(byDay[d].source).toBe('set')
      expect(byDay[d].rostered.firstName).toBe('Ben')
    }
    expect(byDay['2026-11-13'].firstName).toBe('Mat')
    expect(byDay['2026-11-13'].source).toBe('roster')
    expect(byDay['2026-11-13'].turn).toBe('2026-11-13')
    expect(byDay['2026-11-13'].ends).toBe('2026-11-19')
  })

  it('has Brent on the weekend of 7–8 November, not the turn before (Brent, 7 Nov 2026)', async () => {
    const byDay = await leadersOn(['2026-11-07', '2026-11-08'])
    expect(byDay['2026-11-07'].firstName).toBe('Brent')
    expect(byDay['2026-11-08'].firstName).toBe('Brent')
  })

  it('the week view asks about all seven days, so a weekend is never Monday’s turn', async () => {
    const { readFileSync } = await import('fs')
    const route = readFileSync(require('path').join(process.cwd(), 'api/calendar/today.js'), 'utf8')
    expect(route).toMatch(/leadersOn\(\[0, 1, 2, 3, 4, 5, 6\]/)
  })

  it('lets a saved turn and a changed day override the rota, in that order', async () => {
    const after = '2026-11-09T00:00:00.000Z'
    store.set('turn:2026-11-13', { email: 'ben@technomed.com.au', name: 'Ben Cassidy', firstName: 'Ben', setAt: after })
    store.set('day:2026-11-17', { email: 'aimee@technomed.com.au', name: 'Aimee Vulinovich', firstName: 'Aimee', setAt: after })
    const byDay = await leadersOn(['2026-11-16', '2026-11-17'])
    expect(byDay['2026-11-16'].firstName).toBe('Ben')
    expect(byDay['2026-11-17'].firstName).toBe('Aimee')
    expect(byDay['2026-11-17'].turnLeader.firstName).toBe('Ben')
    expect((await turnLeader('2026-11-19')).firstName).toBe('Ben')
  })

  it('a turn or day saved before Brent set the roster on 8 Nov no longer overrides it', async () => {
    store.set('turn:2026-11-13', { email: 'ben@technomed.com.au', name: 'Ben Cassidy', firstName: 'Ben', setAt: '2026-11-07T22:00:00.000Z' })
    store.set('day:2026-11-11', { email: 'ben@technomed.com.au', name: 'Ben Cassidy', firstName: 'Ben', setAt: '2026-11-06T22:00:00.000Z' })
    const byDay = await leadersOn(['2026-11-11', '2026-11-16'])
    expect(byDay['2026-11-11'].firstName).toBe('Brent')
    expect(byDay['2026-11-16'].firstName).toBe('Mat')
  })

  it('the Christmas shutdown is led by whoever is on call (Brent, 8 Nov 2026)', async () => {
    const byDay = await leadersOn(['2026-12-22', '2026-12-23', '2026-12-26', '2026-12-27', '2026-12-30', '2026-12-31', '2027-01-03', '2027-01-04'])
    expect(byDay['2026-12-22'].firstName).toBe('Ben') // Ben's turn, 18–24 Dec
    expect(byDay['2026-12-23'].firstName).toBe('Aimee')
    expect(byDay['2026-12-26'].firstName).toBe('Aimee')
    expect(byDay['2026-12-27'].firstName).toBe('Ben')
    expect(byDay['2026-12-30'].firstName).toBe('Ben')
    expect(byDay['2026-12-31'].firstName).toBe('Mat')
    expect(byDay['2027-01-03'].firstName).toBe('Mat')
    expect(byDay['2027-01-04'].firstName).toBe('Ben') // Ben's turn, 1–7 Jan
  })

  it('never puts Brent on a day while he is away, 19 Dec – 11 Jan', async () => {
    const dates = []
    for (let t = Date.UTC(2026, 11, 19); t <= Date.UTC(2027, 0, 11); t += 86400000) dates.push(new Date(t).toISOString().slice(0, 10))
    const byDay = await leadersOn(dates)
    for (const d of dates) expect(byDay[d].firstName, d).not.toBe('Brent')
  })

  it('names the right person for allocation and the usage escalation', async () => {
    expect(await leaderEmailOn('2026-11-12')).toBe('brenton@technomed.com.au')
    expect(await leaderEmailOn('2026-11-13')).toBe('mat@technomed.com.au')
  })
})
