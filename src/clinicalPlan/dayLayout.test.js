import { describe, it, expect } from 'vitest'
import { layOutDay, hourForNewCase, hourToTime, FIRST_HOUR } from './dayLayout.js'

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

  it("keeps a surgeon's cases together", () => {
    // The point of the grouping: their colour reads as one run down the column
    // rather than three bands with other people's between them.
    const day = [
      { surgeon: 'Ibbett' }, { surgeon: 'Thani' },
      { surgeon: 'Ibbett' }, { surgeon: 'Thani' }, { surgeon: 'Ibbett' }
    ]
    const slots = layOutDay(day)
    const ibbett = slots.filter(s => s.surgeon === 'Ibbett').map(s => s.hour)
    const thani = slots.filter(s => s.surgeon === 'Thani').map(s => s.hour)
    expect(ibbett).toEqual([8, 9, 10])
    expect(thani).toEqual([11, 12])
  })

  it('never puts two cases in the same hour', () => {
    const day = Array.from({ length: 7 }, (_, i) => ({ surgeon: ['A', 'B', 'C'][i % 3] }))
    const used = hours(day)
    expect(new Set(used).size).toBe(used.length)
  })

  it('lays the groups out in the order they already appear', () => {
    // So adding a booking does not reshuffle the day around it.
    expect(layOutDay([{ surgeon: 'Thani' }, { surgeon: 'Ibbett' }])[0].surgeon).toBe('Thani')
  })

  it('does not give every unnamed booking a lane of its own', () => {
    // Three unreadable bookings would otherwise take three hours between them
    // and push the real cases out of the morning.
    const slots = layOutDay([{ surgeon: '' }, { surgeon: 'Ibbett' }, { surgeon: '' }])
    expect(slots.map(s => s.hour)).toEqual([8, 10, 9])
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

  it("follows the surgeon's own cases", () => {
    const day = [{ surgeon: 'Ibbett', hour: 8 }, { surgeon: 'Ibbett', hour: 9 }]
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

  it('regroups a surgeon whose cases were scattered', () => {
    // A booking moved onto a day lands at the end; the next tidy pulls it back
    // beside the rest of that surgeon's list.
    const scattered = day('Ibbett', 'Thani', 'Ibbett')
    const slots = layOutDay(scattered)
    expect(slots.filter(s => s.surgeon === 'Ibbett').map(s => s.hour)).toEqual([8, 9])
    expect(slots.filter(s => s.surgeon === 'Thani').map(s => s.hour)).toEqual([10])
  })
})
