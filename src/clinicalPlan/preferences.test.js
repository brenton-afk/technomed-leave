import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  preferenceAnchor, guideForBooking, preferencesFor, PREFERENCE_SECTIONS
} from './preferences.js'

// The booking already knows the surgeon and the system. Finding the right card
// by hand is the whole cost, and it is paid at half past seven in a corridor
// by somebody carrying a tray.

const GUIDES = [
  { slug: 'dakota', name: 'Dakota ACDF', restricted: false },
  { slug: 'mariner', name: 'MARINER MIS', restricted: false },
  { slug: 'reform-poct', name: 'REFORM POCT', restricted: false },
  { slug: 'diplomat', name: 'DIPLOMAT', restricted: false },
  { slug: 'firebird-forza', name: 'Firebird NXG + Forza XP', restricted: false },
  { slug: 'surgeon-preferences', name: 'Surgeon Preferences', restricted: true }
]

describe('preferenceAnchor', () => {
  it('finds a surgeon with a card', () => {
    expect(preferenceAnchor('Ibbett')).toBe('p-ibbett')
    expect(preferenceAnchor('thani')).toBe('p-thani')
    expect(preferenceAnchor(' JPW ')).toBe('p-jpw')
  })

  it('returns nothing for a surgeon with no card', () => {
    // Opening the guide at the top is a fair answer for a surgeon with no
    // card. Opening it at somebody else's is not, and the two are one typo
    // apart.
    expect(preferenceAnchor('Hannan')).toBeNull()
    expect(preferenceAnchor('')).toBeNull()
    expect(preferenceAnchor(undefined)).toBeNull()
  })

  it('names sections that actually exist in the guide', () => {
    // The ids live in an HTML file this module cannot import. If somebody
    // renames a section there, every button for that surgeon scrolls nowhere
    // and nothing else would notice.
    const html = readFileSync(
      join(__dirname, '..', '..', 'theatre-guides', 'restricted',
        'surgeon-preferences', 'index.html'), 'utf8')
    for (const name of PREFERENCE_SECTIONS) {
      expect(html, `#p-${name}`).toContain(`id="p-${name}"`)
    }
  })
})

describe('guideForBooking', () => {
  it('matches the system named on the booking', () => {
    // Brent's example: Ibbett-Dakota-ACDF.
    expect(guideForBooking({ system: 'Dakota', operation: 'ACDF' }, GUIDES)?.slug)
      .toBe('dakota')
  })

  it('reads the system out of the operation when that is where it is', () => {
    expect(guideForBooking({ operation: 'L4/5 PLIF with MARINER' }, GUIDES)?.slug)
      .toBe('mariner')
  })

  it('prefers the longer, more specific match', () => {
    // "Firebird NXG + Forza XP" against a booking that says both.
    expect(guideForBooking({ system: 'Firebird and Mariner screws' }, GUIDES)?.slug)
      .toBe('firebird-forza')
  })

  it('does not match on a word every case shares', () => {
    // "Dakota ACDF" must not pair with every cervical case on the strength of
    // "ACDF", or the button sends people to the wrong system daily.
    expect(guideForBooking({ operation: 'C5/6 ACDF' }, GUIDES)).toBeNull()
  })

  it('never offers the restricted preferences guide as a system', () => {
    expect(guideForBooking({ system: 'Surgeon Preferences' }, GUIDES)).toBeNull()
  })

  it('finds nothing in a booking that names nothing', () => {
    expect(guideForBooking({}, GUIDES)).toBeNull()
    expect(guideForBooking({ system: 'Unheard Of' }, GUIDES)).toBeNull()
  })
})

describe('preferencesFor', () => {
  it('answers both halves of Ibbett-Dakota-ACDF', () => {
    const got = preferencesFor({ surgeon: 'Ibbett', system: 'Dakota', operation: 'ACDF' }, GUIDES)
    expect(got.surgeon).toEqual({ surgeon: 'Ibbett', anchor: 'p-ibbett' })
    expect(got.guide.slug).toBe('dakota')
    expect(got.any).toBe(true)
  })

  it('still answers when only the surgeon is known', () => {
    const got = preferencesFor({ surgeon: 'Thani' }, GUIDES)
    expect(got.surgeon.anchor).toBe('p-thani')
    expect(got.guide).toBeNull()
    expect(got.any).toBe(true)
  })

  it('says there is nothing when there is nothing', () => {
    // The button should not be drawn at all rather than open an empty sheet.
    expect(preferencesFor({ surgeon: 'Hannan' }, GUIDES).any).toBe(false)
  })
})
