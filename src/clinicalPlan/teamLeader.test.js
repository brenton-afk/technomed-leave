import { describe, it, expect } from 'vitest'
import {
  weekOf, withinWeek, coverNow, cleanLeader, leaderFrom, rosteredLeader
} from './teamLeader.js'
import { STAFF } from '../staffConfig.js'

// The duty leader rings the hospitals for the running orders and is the person
// everybody asks. It was a calendar entry that had to be remembered and moved,
// so it drifted — Mat showed as team leader through a week he was on TOIL.
//
// 07:00 Monday to 17:00 Friday. The weekend belongs to whoever is on call,
// which is a separate rota and a different job.

const BEN = STAFF.find(s => s.firstName === 'Ben')
const MAT = STAFF.find(s => s.firstName === 'Mat')

describe('which week a day belongs to', () => {
  it('is the Monday of that week', () => {
    // Monday 5 October 2026 through Sunday the 11th.
    for (const day of ['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-11']) {
      expect(weekOf(day), day).toBe('2026-10-05')
    }
  })

  it('puts Sunday with the week behind it, not the one coming', () => {
    expect(weekOf('2026-10-11')).toBe('2026-10-05')
    expect(weekOf('2026-10-12')).toBe('2026-10-12')
  })

  it('is nothing for a date that is not one', () => {
    expect(weekOf('')).toBe(null)
    expect(weekOf('soon')).toBe(null)
  })
})

describe('when the leader is on', () => {
  it('starts at seven on Monday, not midnight', () => {
    expect(withinWeek('2026-10-05', 6)).toBe(false)
    expect(withinWeek('2026-10-05', 7)).toBe(true)
  })

  it('runs through the middle of the week', () => {
    for (const day of ['2026-10-06', '2026-10-07', '2026-10-08']) {
      expect(withinWeek(day, 3), day).toBe(true)
      expect(withinWeek(day, 22), day).toBe(true)
    }
  })

  it('ends at five on Friday', () => {
    expect(withinWeek('2026-10-09', 16)).toBe(true)
    expect(withinWeek('2026-10-09', 17)).toBe(false)
  })

  it('is never on at the weekend', () => {
    // That belongs to the on-call rota, which is a different job.
    for (const hour of [0, 9, 13, 23]) {
      expect(withinWeek('2026-10-10', hour)).toBe(false)
      expect(withinWeek('2026-10-11', hour)).toBe(false)
    }
  })
})

describe('who is covering right now', () => {
  const leader = { email: BEN.email }

  it('is the team leader inside the week', () => {
    const now = coverNow({ date: '2026-10-07', hour: 10, leader })
    expect(now.role).toBe('leader')
    expect(now.person.firstName).toBe('Ben')
    expect(now.label).toBe('Ben is team leader')
  })

  it('is the on-call person at the weekend', () => {
    // Said plainly rather than blended: ringing the duty leader and waking the
    // on-call rep are different conversations.
    const now = coverNow({ date: '2026-10-10', hour: 10, leader, onCall: MAT })
    expect(now.role).toBe('onCall')
    expect(now.person.firstName).toBe('Mat')
    expect(now.label).toBe('Mat is on call')
  })

  it('is the on-call person on Friday evening', () => {
    const now = coverNow({ date: '2026-10-09', hour: 18, leader, onCall: MAT })
    expect(now.role).toBe('onCall')
  })

  it('says so when nobody has been set', () => {
    const now = coverNow({ date: '2026-10-07', hour: 10 })
    expect(now.person).toBe(null)
    expect(now.label).toMatch(/Nobody is set/)
  })

  it('says so when nobody is on call either', () => {
    const now = coverNow({ date: '2026-10-10', hour: 10, leader })
    expect(now.person).toBe(null)
    expect(now.label).toMatch(/nobody is on call/i)
  })
})

describe('setting it', () => {
  it('records who it is and who changed it', () => {
    const entry = cleanLeader({ email: BEN.email, setBy: 'brenton@technomed.com.au' })
    expect(entry.firstName).toBe('Ben')
    expect(entry.setBy).toBe('brenton@technomed.com.au')
    expect(entry.setAt).toBeTruthy()
  })

  it('refuses somebody who is not on the roster', () => {
    expect(cleanLeader({ email: 'someone@elsewhere.com' })).toBe(null)
    expect(cleanLeader({})).toBe(null)
  })

  it('is case-insensitive about an address', () => {
    expect(cleanLeader({ email: BEN.email.toUpperCase() })?.firstName).toBe('Ben')
  })

  it('reads a stored entry back to the person', () => {
    expect(leaderFrom({ email: BEN.email })?.firstName).toBe('Ben')
    expect(leaderFrom({ email: 'gone@technomed.com.au' })).toBe(null)
    expect(leaderFrom(null)).toBe(null)
  })
})

describe('the standing rota', () => {
  // Ben has the week commencing 12 October 2026 and every second week after
  // it; Mat has the ones between. Brent is deliberately not in the cycle — he
  // covers when somebody is away, and a person who only ever covers should not
  // be in a rota that is meant to describe what normally happens.
  it('gives Ben the anchor week', () => {
    expect(rosteredLeader('2026-10-12')?.firstName).toBe('Ben')
  })

  it('alternates a week each from there', () => {
    expect(rosteredLeader('2026-10-19')?.firstName).toBe('Mat')
    expect(rosteredLeader('2026-10-26')?.firstName).toBe('Ben')
    expect(rosteredLeader('2026-11-02')?.firstName).toBe('Mat')
    expect(rosteredLeader('2026-11-09')?.firstName).toBe('Ben')
  })

  it('works backwards too', () => {
    // The week before the anchor is Mat's, which is what makes "ordinarily
    // Mat, but Brent is covering" a rota plus an override rather than two
    // unrelated facts. Plain % gives -1 here and would have picked nobody.
    expect(rosteredLeader('2026-10-05')?.firstName).toBe('Mat')
    expect(rosteredLeader('2026-09-28')?.firstName).toBe('Ben')
    expect(rosteredLeader('2026-09-21')?.firstName).toBe('Mat')
  })

  it('answers for any day of the week, not only the Monday', () => {
    for (const day of ['2026-10-12', '2026-10-14', '2026-10-16', '2026-10-18']) {
      expect(rosteredLeader(day)?.firstName, day).toBe('Ben')
    }
  })

  it('keeps Brent out of the cycle', () => {
    // He leads when needed, which is an override, not a turn.
    const names = new Set()
    for (let i = -8; i < 20; i++) {
      const monday = new Date(Date.UTC(2026, 9, 12) + i * 7 * 86400000)
        .toISOString().slice(0, 10)
      names.add(rosteredLeader(monday)?.firstName)
    }
    expect([...names].sort()).toEqual(['Ben', 'Mat'])
  })

  it('holds up a year out', () => {
    // 52 weeks on from an even week is the same person.
    expect(rosteredLeader('2027-10-11')?.firstName).toBe('Ben')
  })

  it('is nothing for a date that is not one', () => {
    expect(rosteredLeader('')).toBe(null)
    expect(rosteredLeader('next week')).toBe(null)
  })
})
