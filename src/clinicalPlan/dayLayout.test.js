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
