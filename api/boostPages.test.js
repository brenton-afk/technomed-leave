import { describe, it, expect } from 'vitest'
import { splitBoostReadings, boostPagesFromWhole, cleanBoostPages, splitPages } from './_boostPages.js'

const boost = { productName: 'Boost DBM Allograft', referenceCode: 'B-1' }
const screw = { productName: 'Pedicle screw', referenceCode: 'S-1' }

describe('telling the Boost tracking form apart', () => {
  it('finds the tracking page and drops its graft when the chargeable form has the sticker', () => {
    const { readings, boostPages } = splitBoostReadings([
      { items: [screw, boost], boostTrackingPages: [] },
      { items: [boost], boostTrackingPages: [1] }
    ])
    expect(boostPages).toEqual([1])
    expect(readings[1].items).toEqual([])
    expect(readings[0].items).toHaveLength(2)
  })

  it('keeps the graft when only the tracking form names it, so it is still restocked', () => {
    const { readings, boostPages } = splitBoostReadings([
      { items: [screw] },
      { items: [boost], boostTrackingPages: [1] }
    ])
    expect(boostPages).toEqual([1])
    expect(readings[1].items).toEqual([boost])
  })

  it('a scan with no tracking form is untouched', () => {
    const input = [{ items: [boost] }]
    expect(splitBoostReadings(input)).toEqual({ readings: input, boostPages: [] })
  })

  it('reads page numbers from a whole-form reading and keeps only real pages', () => {
    expect(boostPagesFromWhole({ boostTrackingPages: [2, 9, 'x'] }, 3)).toEqual([1])
    expect(cleanBoostPages([3, -1, 0, 0], 2)).toEqual([0])
    expect(cleanBoostPages('nope', 2)).toEqual([])
  })

  it('splits the pages between the distributors and the Boost team', () => {
    expect(splitPages(['a', 'b', 'c'], [1])).toEqual({ usagePages: ['a', 'c'], trackingPages: ['b'] })
  })
})
