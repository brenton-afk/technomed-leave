import { describe, it, expect } from 'vitest'
import { alreadyInCalendar } from './bookingSources.js'

// The queue deduplicated against itself but never against the calendar. A case
// booked by hand on Monday was offered again on Tuesday when the hospital's
// confirmation arrived, and the only way to say "we have this" was to dismiss
// it — which reads as "this is not happening".

const DIARY = [
  { date: '2026-10-13', patient: 'La Pietra', surgeon: 'Ibbett', id: 'ev1' },
  { date: '2026-10-14', patient: 'Hollis', surgeon: 'Thani', id: 'ev2' },
  { date: '2026-10-15', patient: 'Pennant', surgeon: '', id: 'ev3' }
]

describe('alreadyInCalendar', () => {
  it('finds the case that is already booked', () => {
    expect(alreadyInCalendar(
      { date: '2026-10-13', patient: 'La Pietra', surgeon: 'Ibbett' }, DIARY)?.id).toBe('ev1')
  })

  it('ignores case and spacing in the surname', () => {
    expect(alreadyInCalendar(
      { date: '2026-10-13', patient: '  la pietra ', surgeon: 'ibbett' }, DIARY)?.id).toBe('ev1')
  })

  it('matches on the day and the surname, not on everything else', () => {
    // The calendar entry has been through the team's hands — operation
    // shortened, system corrected, rep added — so requiring the rest to agree
    // would miss exactly the bookings that have had the most attention.
    expect(alreadyInCalendar({
      date: '2026-10-14', patient: 'Hollis', surgeon: 'Thani',
      operation: 'C5/6 ACDF with instrumentation', system: 'DIPLOMAT'
    }, DIARY)?.id).toBe('ev2')
  })

  it('still matches when the email does not say who is operating', () => {
    // An email that names no surgeon is not a different case from the
    // calendar entry that does.
    expect(alreadyInCalendar({ date: '2026-10-13', patient: 'La Pietra' }, DIARY)?.id)
      .toBe('ev1')
  })

  it('still matches when the calendar entry does not name one', () => {
    expect(alreadyInCalendar(
      { date: '2026-10-15', patient: 'Pennant', surgeon: 'Garg' }, DIARY)?.id).toBe('ev3')
  })

  it('does not match two different surgeons on one day', () => {
    // Same surname, same day, different surgeon: two cases, and the one time
    // offering it again is right.
    expect(alreadyInCalendar(
      { date: '2026-10-13', patient: 'La Pietra', surgeon: 'Garg' }, DIARY)).toBeNull()
  })

  it('does not match a different day', () => {
    expect(alreadyInCalendar(
      { date: '2026-10-20', patient: 'La Pietra', surgeon: 'Ibbett' }, DIARY)).toBeNull()
  })

  it('refuses to guess from a candidate that says nothing', () => {
    expect(alreadyInCalendar({}, DIARY)).toBeNull()
    expect(alreadyInCalendar({ date: '2026-10-13' }, DIARY)).toBeNull()
    expect(alreadyInCalendar(null, DIARY)).toBeNull()
  })

  it('copes with an empty diary', () => {
    expect(alreadyInCalendar({ date: '2026-10-13', patient: 'La Pietra' }, [])).toBeNull()
    expect(alreadyInCalendar({ date: '2026-10-13', patient: 'La Pietra' })).toBeNull()
  })
})
