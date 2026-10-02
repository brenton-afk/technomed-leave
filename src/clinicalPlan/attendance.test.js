import { describe, it, expect } from 'vitest'
import { attendanceNotRequired } from './attendance.js'
import { readBooking } from './parse.js'

// A hospital books a case onto our calendar as a courtesy — our surgeon, our
// navigation — and says on it that nobody from here is wanted in the room.
// Having it in the portal is useful: it is why a theatre is busy, why a surgeon
// is unavailable, and it is the booking somebody rings about later.
//
// What it must not do is look like a case we are attending.

describe('reading "we are not needed"', () => {
  for (const written of [
    'Brainlab F2F Not required',
    'Brainlab F2F not req',
    "F2F not req'd",
    'F2F — not required',
    'No F2F required',
    'no f2f',
    'F2F: no',
    'Rep not required',
    'No rep required',
    'TechnoMed attendance not required'
  ]) {
    it(`reads "${written}"`, () => {
      expect(attendanceNotRequired(written)).toBe(true)
    })
  }

  it('reads it in the middle of a booking', () => {
    expect(attendanceNotRequired(
      'Surg: Ibbett\nPt: Mathieson\nProcedure: L4/5 decompression\n'
      + 'Brainlab F2F Not required\nHosp: RHH')).toBe(true)
  })
})

describe('what it must not read as "we are not needed"', () => {
  // Anchored on an explicit marker — F2F, rep, attendance — rather than on
  // "not required" alone, which turns up about all sorts of things. Reading
  // one of those as "nobody go" keeps somebody away from a case that needed
  // them, so the failure here has to be towards attending.
  for (const written of [
    'Image intensifier not required',
    'Second tray not required',
    'Navigation not required',
    'Cell saver not required',
    'Bloods not required',
    'Brainlab F2F required',
    'F2F required',
    'Brainlab Curve',
    'Surg: Ibbett\nPt: Mathieson\nKit: Dakota'
  ]) {
    it(`leaves "${written}" alone`, () => {
      expect(attendanceNotRequired(written)).toBe(false)
    })
  }

  it('is nothing for an empty booking', () => {
    expect(attendanceNotRequired('')).toBe(false)
    expect(attendanceNotRequired(null)).toBe(false)
  })
})

describe('the booking as a whole', () => {
  const BOOKING = {
    title: 'Mathieson BRAINLAB - Ibbett',
    description: 'Surg: Ibbett\nPt: Mathieson\nHosp: RHH\n'
      + 'Procedure: L4/5 decompression\nBrainlab F2F Not required'
  }

  it('is marked as one we are not needed at', () => {
    expect(readBooking(BOOKING.title, BOOKING.description).notRequired).toBe(true)
  })

  it('still reads as a case, because it is one', () => {
    const read = readBooking(BOOKING.title, BOOKING.description)
    expect(read.patient).toBe('Mathieson')
    expect(read.surgeon).toBe('Ibbett')
    expect(read.operation).toMatch(/decompression/)
    expect(read.navigation).toBe('Brainlab')
  })

  it('leaves an ordinary Brainlab case unmarked', () => {
    const read = readBooking('Mathieson BRAINLAB - Ibbett',
      'Surg: Ibbett\nPt: Mathieson\nHosp: RHH\nBrainlab F2F required')
    expect(read.notRequired).toBeUndefined()
    expect(read.navigation).toBe('Brainlab')
  })
})
