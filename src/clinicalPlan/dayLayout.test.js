import { describe, it, expect } from 'vitest'
import {
  layOutDay, hourForNewCase, hourToTime, inPreferredOrder, FIRST_HOUR
} from './dayLayout.js'

// The times are a layout, not a schedule. Nobody knows when a case will run —
// the list order lands the evening before and then moves all day — so what these
// have to do is make the day readable in Google's week view, where a booking
// spanning 08:00 to 17:00 is the whole column and six of them are six slabs of
// colour on top of each other.

describe('laying out a day', () => {
  const hours = cases => layOutDay(cases).map(s => s.hour)

  it('gives every case one hour, one after another', () => {
    expect(hours([{ surgeon: 'Ibbett' }, { surgeon: 'Thani' }, { surgeon: 'Fowler' }]))
      .toEqual([8, 9, 10])
  })

  it('keeps the order it was given, even when surgeons alternate', () => {
    // A list that runs Ibbett, Thani, Ibbett is an ordinary list, and it is the
    // order the hospital read out. This used to regroup by surgeon, which
    // silently undid a running order somebody had just been told on the phone.
    const day = [
      { surgeon: 'Ibbett' }, { surgeon: 'Thani' },
      { surgeon: 'Ibbett' }, { surgeon: 'Thani' }, { surgeon: 'Ibbett' }
    ]
    expect(layOutDay(day).map(s => [s.hour, s.surgeon])).toEqual([
      [8, 'Ibbett'], [9, 'Thani'], [10, 'Ibbett'], [11, 'Thani'], [12, 'Ibbett']
    ])
  })

  it('never puts two cases in the same hour', () => {
    const day = Array.from({ length: 7 }, (_, i) => ({ surgeon: ['A', 'B', 'C'][i % 3] }))
    const used = hours(day)
    expect(new Set(used).size).toBe(used.length)
  })

  it('lays them out in the order they already appear', () => {
    // So adding a booking does not reshuffle the day around it.
    expect(layOutDay([{ surgeon: 'Thani' }, { surgeon: 'Ibbett' }])[0].surgeon).toBe('Thani')
  })

  it('gives a booking with no readable surgeon its own hour', () => {
    // It is still a case somebody has to be at, and it still has a place in the
    // running order. Hiding it behind a named case is how one gets missed.
    const slots = layOutDay([{ surgeon: '' }, { surgeon: 'Ibbett' }, { surgeon: '' }])
    expect(slots.map(s => s.hour)).toEqual([8, 9, 10])
  })

  it('runs into the evening rather than overlapping', () => {
    // A twelve-case day is not a real day, but running late is still readable
    // and stacking is not.
    const many = Array.from({ length: 12 }, (_, i) => ({ surgeon: `S${i}` }))
    const used = hours(many)
    expect(used).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
    expect(new Set(used).size).toBe(12)
  })

  it('handles an empty day', () => {
    expect(layOutDay([])).toEqual([])
    expect(layOutDay()).toEqual([])
  })
})

describe('placing one new case', () => {
  it('starts the day at eight', () => {
    expect(hourForNewCase([], 'Ibbett')).toBe(FIRST_HOUR)
  })

  it('goes to the end of the day', () => {
    // Not beside the surgeon's other cases, which is where it used to go. Where
    // it belongs in the running order is not knowable when the booking is made;
    // it goes last and gets moved when the hospital rings.
    const day = [{ surgeon: 'Ibbett', hour: 8 }, { surgeon: 'Thani', hour: 9 }]
    expect(hourForNewCase(day, 'Ibbett')).toBe(10)
  })

  it('goes to the end for a surgeon not there yet', () => {
    const day = [{ surgeon: 'Ibbett', hour: 8 }, { surgeon: 'Thani', hour: 9 }]
    expect(hourForNewCase(day, 'Fowler')).toBe(10)
  })

  it('never takes an hour something else already has', () => {
    // Two bookings at one time is the thing this exists to stop. A case an hour
    // later than it might have been costs nothing.
    const day = [{ surgeon: 'Ibbett', hour: 8 }, { surgeon: 'Thani', hour: 9 }]
    expect(hourForNewCase(day, 'Ibbett')).toBe(10)
    expect(hourForNewCase(day, 'Ibbett')).not.toBe(9)
  })

  it('ignores bookings with no hour of their own', () => {
    // The all-day entries and the leave notes, which are not cases in a column.
    const day = [{ surgeon: 'Ibbett', hour: null }, { surgeon: 'Thani', hour: 8 }]
    expect(hourForNewCase(day, 'Fowler')).toBe(9)
  })
})

describe('the time written to the calendar', () => {
  it('is a whole hour', () => {
    expect(hourToTime(8)).toBe('08:00:00')
    expect(hourToTime(13)).toBe('13:00:00')
  })
})

describe('a day that keeps itself tidy', () => {
  // Placing a new booking well is not enough. Delete the 9am case and there is
  // a hole; move one to another day and there is a hole behind it. The admin
  // assistant was packing them by hand afterwards, which is the app's job.
  const day = (...surgeons) => surgeons.map(s => ({ surgeon: s }))

  it('closes the gap when a case is taken out', () => {
    const after = day('Ibbett', 'Thani')          // the middle one deleted
    expect(layOutDay(after).map(s => s.hour)).toEqual([8, 9])
  })

  it('leaves no hour unused in the middle', () => {
    const used = layOutDay(day('A', 'B', 'C', 'D')).map(s => s.hour).sort((a, b) => a - b)
    for (let i = 1; i < used.length; i++) expect(used[i] - used[i - 1]).toBe(1)
  })

  it('is stable — tidying a tidy day changes nothing', () => {
    // Otherwise every save would rewrite every booking on the day, and the
    // calendar would show a dozen edits nobody made.
    const cases = day('Ibbett', 'Ibbett', 'Thani')
    const once = layOutDay(cases).map(s => s.hour)
    const twice = layOutDay(cases).map(s => s.hour)
    expect(twice).toEqual(once)
  })

  it('leaves a day alone that is already in order', () => {
    // A booking moved onto a day lands at the end, and stays there until
    // somebody moves it. The tidy closes gaps; it does not have opinions.
    const slots = layOutDay(day('Ibbett', 'Thani', 'Ibbett'))
    expect(slots.map(s => s.hour)).toEqual([8, 9, 10])
  })
})

describe('the running order the hospital gave us', () => {
  const day = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('puts the cases in the order asked for', () => {
    expect(inPreferredOrder(day, ['c', 'a', 'b']).map(c => c.id)).toEqual(['c', 'a', 'b'])
  })

  it('leaves the day alone when no order was given', () => {
    expect(inPreferredOrder(day, null).map(c => c.id)).toEqual(['a', 'b', 'c'])
    expect(inPreferredOrder(day, []).map(c => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps a case the order does not mention behind the ones it does', () => {
    // A booking that arrived after the hospital rang has no place in that list
    // yet. Guessing one would quietly undo what somebody was told on the phone.
    expect(inPreferredOrder(day, ['c', 'a']).map(c => c.id)).toEqual(['c', 'a', 'b'])
  })

  it('ignores an id for a case that is not on the day', () => {
    // The list was set, then a case was cancelled. What is left keeps its order.
    expect(inPreferredOrder(day, ['gone', 'c', 'b', 'a']).map(c => c.id))
      .toEqual(['c', 'b', 'a'])
  })

  it('lays the calendar out in that order', () => {
    const slots = layOutDay(inPreferredOrder(day, ['c', 'a', 'b']))
    expect(slots.map(s => s.hour)).toEqual([8, 9, 10])
    expect(inPreferredOrder(day, ['c', 'a', 'b']).map(c => c.id)).toEqual(['c', 'a', 'b'])
  })
})
