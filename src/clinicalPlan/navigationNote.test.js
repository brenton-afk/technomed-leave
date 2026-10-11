import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { findNavigation } from './systems.js'

// ─── AIRO, written rather than badged ────────────────────────────────────────
// "Remove the AIRO badge from all AIRO bookings — just have AIRO listed in the
// notes for all pedicle screw cases, PLIF, TLIF, PSF (Pedicle Screw Fixation),
// C1/2 fixations, Reform lateral mass cases, max fax post-op spins, etc (all
// the previous rules)."
//
// A badge is for something exceptional, and one that appears on most of a week
// stops being read. AIRO is on every pedicle screw case we do, which is most of
// the spine list — the pill was decorating the ordinary.
//
// The rules themselves are unchanged, and two were added: C1/2 and the max fax
// spins had never been detected at all.

describe('the rules Brent listed', () => {
  const badged = text => expect(findNavigation(text), text).toEqual(['AIRO'])

  it('covers the screws, by acronym and in full', () => {
    for (const operation of [
      'L4/5 PLIF', 'L4/5 TLIF', 'T10-L2 PSF', 'L1-L5 Pedicle Screw Fixation',
      'L4/5 posterior lumbar interbody fusion', 'T10-L2 posterior spinal fusion'
    ]) badged(operation)
  })

  it('covers the lateral mass cases', () => {
    badged('C3-C6 Reform Lateral Mass')
    badged('Posterior cervical lateral mass fixation')
  })

  it('covers C1/2, which it never did', () => {
    // The one place in the spine where a screw passes the vertebral artery
    // with no margin — the case most in need of navigation, and the one the
    // app was silent about. Written every way the rooms write it.
    for (const operation of [
      'C1/2 Fixation', 'C1-2 fusion', 'C1-C2 fusion', 'C1/C2 fixation',
      'Atlanto-axial fusion', 'Odontoid screw fixation', 'Magerl screws'
    ]) badged(operation)
  })

  it('covers the max fax post-op spins, which it never did', () => {
    // The spin IS the AIRO, and it is most of what that service calls us for.
    for (const operation of [
      'Max fax post op spin', 'Post operative CT',
      'ORIF mandible with post-op spin'
    ]) badged(operation)
  })

  it('still leaves alone what it always left alone', () => {
    // An ACDF is anterior cervical and carries no posterior screws; a
    // decompression carries no implants at all.
    expect(findNavigation('C5/6 ACDF')).toEqual([])
    expect(findNavigation('L3/4 Laminectomy')).toEqual([])
  })

  it('still skips a removal, which was last week’s rule', () => {
    // "AIRO is not required for a removal of pedicle screws."
    expect(findNavigation('L1-L3 pedicle screw removal')).toEqual([])
    expect(findNavigation('C1/2 screw removal')).toEqual([])
    // And still badges one where something is going back in.
    expect(findNavigation('Revision L1-L3 pedicle screws')).toEqual(['AIRO'])
  })
})

describe('how it is shown', () => {
  const source = readFileSync(join(__dirname, '..', 'pages', 'CaseWeek.jsx'), 'utf8')

  it('is not a badge any more', () => {
    expect(source).not.toMatch(/NavigationBadge/)
    expect(source).not.toMatch(/NAVIGATION_ACCENT/)
  })

  it('reads as a note, not a pill', () => {
    const note = source.slice(source.indexOf('function NavigationNote'))
    // A pill is a background and a radius. This has neither.
    expect(note.slice(0, note.indexOf('\n}'))).not.toMatch(/borderRadius|background/)
  })

  it('is on the desktop column, and inside the booking on a phone', () => {
    // It came off the tile: it reads AIRO on every pedicle screw case, which
    // is most of a spine list, so it said the same thing on most of the week.
    // "Still be able to go into each booking and get the extra info" is only
    // true if it is in there, so it is.
    const week = source.slice(source.indexOf('function WeekCase'))
    expect(week).toMatch(/<NavigationNote\b/)

    const sheet = readFileSync(
      join(__dirname, '..', 'pages', 'cases', 'EditBooking.jsx'), 'utf8')
    expect(sheet).toMatch(/findNavigation\(/)
    expect(sheet).toMatch(/\{navigation && \(/)
  })

  it('is worked out every time rather than stored', () => {
    // A booking whose procedure is corrected gets the right answer without
    // anybody editing a second field.
    const note = source.slice(source.indexOf('function NavigationNote'))
    expect(note).toMatch(/surgicalCase\?\.navigation/)
  })
})
