import { describe, it, expect } from 'vitest'
import {
  listKey, theatreFrom, listsForDay, runningOrder, summarise, oursFirstUp, OURS, OTHER
} from './listOrder.js'

// Tomorrow at RHH, as the hospital gave it: 1. an ACDF using a competitor's
// cage, 2. Kon, 3. Rowe. Kon is Fowler operating on Dubey's list, which is why a
// list is a theatre and not a surgeon.

const KON = { id: 'kon', patient: 'Kon', surgeon: 'Fowler', hospital: 'RHH', notes: 'Theatre 11' }
const ROWE = { id: 'rowe', patient: 'Rowe', surgeon: 'Dubey', hospital: 'RHH', notes: 'Theatre 11. All-day list.' }
const ACDF = { kind: OTHER, label: 'ACDF — competitor cage' }

const DUBEYS_LIST = {
  entries: [ACDF, { kind: OURS, eventId: 'kon' }, { kind: OURS, eventId: 'rowe' }],
  updatedBy: 'Brent',
  updatedAt: '2026-09-29T06:30:00.000Z'
}

describe('finding the theatre', () => {
  it('reads it however the booking writes it', () => {
    expect(theatreFrom('Theatre Number 11')).toBe('11')
    expect(theatreFrom('Theatre 15. PM list')).toBe('15')
    expect(theatreFrom('Th 4')).toBe('4')
  })

  it('is absent rather than guessed', () => {
    // Most Calvary bookings never name one.
    expect(theatreFrom('Calvary Lenah Valley')).toBeNull()
    expect(theatreFrom('')).toBeNull()
  })
})

describe('grouping a day into lists', () => {
  it('puts two surgeons in one theatre on one list', () => {
    // The case that rules out keying a list by surgeon.
    const lists = listsForDay([KON, ROWE])
    expect(lists).toHaveLength(1)
    expect(lists[0].theatre).toBe('11')
    expect(lists[0].cases.map(c => c.patient)).toEqual(['Kon', 'Rowe'])
  })

  it('separates theatres at the same hospital', () => {
    const other = { id: 'barr', patient: 'Barr', surgeon: 'Atallah', hospital: 'RHH', notes: 'Theatre 15' }
    expect(listsForDay([KON, ROWE, other])).toHaveLength(2)
  })

  it('still makes a list when nobody wrote a theatre down', () => {
    // A list without a number beats a list nobody can see.
    const lists = listsForDay([{ id: 'x', patient: 'Hays', hospital: 'CALVARY LENAH VALLEY', notes: '' }])
    expect(lists).toHaveLength(1)
    expect(lists[0].theatre).toBeNull()
  })

  it('leaves a cancelled case off the list', () => {
    expect(listsForDay([KON, { ...ROWE, cancelled: true }])[0].cases).toHaveLength(1)
  })

  it('keys a list by hospital and theatre and day', () => {
    expect(listKey('2026-09-30', 'RHH', '11')).toBe('2026-09-30:RHH:11')
    expect(listKey('2026-09-30', 'RHH', null)).toBe('2026-09-30:RHH:main')
  })
})

describe('the running order', () => {
  it('reads back in the order it was given', () => {
    const order = runningOrder(DUBEYS_LIST, [KON, ROWE])
    expect(order.entries.map(e => e.position)).toEqual([1, 2, 3])
    expect(order.entries[0].label).toBe('ACDF — competitor cage')
    expect(order.entries[1].booking.patient).toBe('Kon')
    expect(order.entries[2].booking.patient).toBe('Rowe')
  })

  it('shows each of ours as it is now, not as it was last night', () => {
    // Resolved from the live booking rather than a copy taken at five o'clock,
    // so a kit changed this morning shows changed.
    const edited = { ...ROWE, system: 'DIPLOMAT + E4' }
    const order = runningOrder(DUBEYS_LIST, [KON, edited])
    expect(order.entries[2].booking.system).toBe('DIPLOMAT + E4')
  })

  it('does not lose a case added after the order was taken', () => {
    const late = { id: 'new', patient: 'Marsh', surgeon: 'Dubey', hospital: 'RHH' }
    const order = runningOrder(DUBEYS_LIST, [KON, ROWE, late])
    expect(order.entries).toHaveLength(3)
    // Held apart, so it is obvious it has no position rather than looking last.
    expect(order.unplaced.map(c => c.patient)).toEqual(['Marsh'])
  })

  it('closes the gap when a case in the order has gone', () => {
    const order = runningOrder(DUBEYS_LIST, [ROWE])
    expect(order.entries.map(e => e.position)).toEqual([1, 2])
    expect(order.entries[1].booking.patient).toBe('Rowe')
  })

  it('says when nothing has been recorded yet', () => {
    const order = runningOrder(null, [KON, ROWE])
    expect(order.recorded).toBe(false)
    expect(order.entries).toHaveLength(0)
    expect(order.unplaced).toHaveLength(2)
  })

  it('keeps who took it and when', () => {
    // The evening ring-round is somebody's job, and the team should be able to
    // see it was done and by whom.
    const order = runningOrder(DUBEYS_LIST, [KON, ROWE])
    expect(order.updatedBy).toBe('Brent')
    expect(order.updatedAt).toBe('2026-09-29T06:30:00.000Z')
  })
})

describe('where ours sit, in a sentence', () => {
  const order = entries => runningOrder({ entries }, [KON, ROWE])

  it('answers tomorrow', () => {
    expect(summarise(order(DUBEYS_LIST.entries))).toBe('Ours 2nd and 3rd up')
  })

  it('says first up plainly, because that is the one that costs a 7:30 start', () => {
    expect(summarise(order([{ kind: OURS, eventId: 'rowe' }, ACDF]))).toBe('Ours is first up')
    expect(summarise(order([
      { kind: OURS, eventId: 'rowe' }, ACDF, { kind: OURS, eventId: 'kon' }
    ]))).toBe('Ours is first up, then 3rd')
  })

  it('handles one of ours in the middle', () => {
    expect(summarise(order([ACDF, { kind: OURS, eventId: 'kon' }]))).toBe('Ours 2nd up')
  })

  it('says so when the list has none of ours', () => {
    expect(summarise(runningOrder({ entries: [ACDF] }, []))).toBe('None of ours on this list')
  })

  it('says nothing at all before the order is known', () => {
    // Not "none of ours" — nobody has rung the hospital yet.
    expect(summarise(runningOrder(null, [KON]))).toBeNull()
  })
})

describe('first up', () => {
  it('is the flag the whole evening ring-round exists for', () => {
    expect(oursFirstUp(runningOrder({ entries: [{ kind: OURS, eventId: 'kon' }] }, [KON]))).toBe(true)
    expect(oursFirstUp(runningOrder(DUBEYS_LIST, [KON, ROWE]))).toBe(false)
    expect(oursFirstUp(runningOrder(null, [KON]))).toBe(false)
  })
})
