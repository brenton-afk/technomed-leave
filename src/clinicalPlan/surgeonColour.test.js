import { describe, it, expect } from 'vitest'
import {
  accentForCase, accentFor, accentTextFor, guideHexFor,
  contrastRatio, SURGEON_ACCENTS, NAVIGATION_ACCENT
} from './theme.js'
import { GOOGLE_COLOR_NAMES, GOOGLE_COLOR_HEX, SURGEON_COLOUR_NAMES } from './colours.js'
import { findNavigation } from './systems.js'

// "Can you please make sure that the colours remain consistent in the app
// irrespective of the way they are entered in google calendar — I think
// sometimes the 'default colour' is selected and it messes up how they are
// displayed."
//
// Exactly right, and Larkin's booking had no colorId at all, so Google served
// the calendar's default. The colour scheme exists to show surgeon allocation at
// a glance, so the wrong colour does not read as a cosmetic slip: it reads as
// somebody else's case.

/** The guide, as dictated. */
const GUIDE = {
  Ibbett: 'Banana',
  Thani: 'Sage',
  Gupta: 'Basil',
  Atallah: 'Tangerine',
  JPW: 'Flamingo',
  Dubey: 'Graphite',
  Fowler: 'Grape'
}

const hexOf = name => GOOGLE_COLOR_HEX[
  Object.keys(GOOGLE_COLOR_NAMES).find(k => GOOGLE_COLOR_NAMES[k] === name)]

describe('the booking guide', () => {
  it.each(Object.entries(GUIDE))('%s is %s', (surgeon, colourName) => {
    expect(SURGEON_COLOUR_NAMES[surgeon]).toBe(colourName)
    expect(guideHexFor(surgeon)).toBe(hexOf(colourName))
  })

  it('paints the shade the team sees in Google, not an approximation', () => {
    // These used to be a second table of hand-picked hexes: JPW was #F06292
    // against Flamingo's #e67c73, and Fowler's was a guess commented
    // "provisional, chosen to match the Grape family".
    for (const surgeon of Object.keys(GUIDE)) {
      expect(Object.values(GOOGLE_COLOR_HEX)).toContain(guideHexFor(surgeon))
    }
  })
})

describe('however the booking was entered', () => {
  const carried = [
    ['no colour at all', undefined],
    ['the calendar default', '#3f51b5'],
    ['somebody else\'s colour', '#039be5'],
    ['the right colour', null]
  ]

  it.each(Object.keys(GUIDE))('%s keeps their colour', surgeon => {
    for (const [how, hex] of carried) {
      expect(accentForCase({ surgeon, colourHex: hex ?? guideHexFor(surgeon) }), how)
        .toBe(guideHexFor(surgeon))
    }
  })

  it('still colours a surgeon the guide has never heard of', () => {
    // Better the booking's own colour than grey. The guide is not a whitelist.
    expect(accentForCase({ surgeon: 'Nobody', colourHex: '#039be5' })).toBe('#039be5')
  })

  it('gives two different surgeons two different colours', () => {
    const seen = Object.keys(GUIDE).map(s => guideHexFor(s))
    expect(new Set(seen).size).toBe(seen.length)
  })
})

describe('a navigation case', () => {
  it('still belongs to its surgeon', () => {
    // This used to return blueberry for everyone, and that was wrong. Both rules
    // are real — Ibbett is Banana, an AIRO case is Blueberry — and a booking can
    // be both: "Mitchell DIPLOMAT - Ibbett" with "Kit - ... /Cascadia/AIRO".
    // One colour channel cannot carry two facts, and making navigation win meant
    // an Ibbett case was not drawn as one, which is what the scheme is for.
    //
    // The platform is shown as its own marker on the card instead, so both are
    // readable at once. See CaseWeek.test.jsx.
    for (const surgeon of Object.keys(GUIDE)) {
      expect(accentForCase({ surgeon, navigation: 'Curve' })).toBe(guideHexFor(surgeon))
    }
    expect(NAVIGATION_ACCENT).toBe('#4a1c96')
  })

  it('recognises all four platforms', () => {
    for (const text of ['Varioguide', 'Brainlab', 'AIRO scanner', 'Brainlab Curve']) {
      expect(findNavigation(text).length, text).toBeGreaterThan(0)
    }
  })

  it('does not mistake a scoliosis curve for the Curve', () => {
    // "Curve" is a Brainlab platform and also ordinary spinal language. Painting
    // a deformity correction blueberry would say a navigation platform needs
    // booking when it does not.
    for (const text of [
      'T4-L2 PSF correction of the thoracic curve',
      'scoliotic curve correction',
      'main curve 52 degrees'
    ]) {
      expect(findNavigation(text), text).toEqual([])
    }
  })
})

describe('one surgeon, one colour, everywhere', () => {
  // The fix was nearly half-done: the cards were moved onto the guide while the
  // "Surgeons this week" line and the Word export were left on the old sampled
  // table. That would have put a JPW case and the word "JPW" in two different
  // pinks on the same screen, and printed a third opinion — the very
  // inconsistency this change exists to remove.
  it('gives the card, the legend and the export the same answer', () => {
    for (const surgeon of Object.keys(GUIDE)) {
      const guide = guideHexFor(surgeon)
      expect(accentForCase({ surgeon }), `card: ${surgeon}`).toBe(guide)
      expect(accentFor(surgeon), `legend/export bar: ${surgeon}`).toBe(guide)
      // The text variant is the same hue, only darkened enough to read on white.
      expect(contrastRatio(accentTextFor(surgeon), '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('has no colour left that only one surface knows about', () => {
    // SURGEON_ACCENTS survives only for surgeons the guide has no entry for.
    // Anyone in both must resolve to the guide, or the tables disagree again.
    for (const surgeon of Object.keys(SURGEON_ACCENTS)) {
      if (!SURGEON_COLOUR_NAMES[surgeon]) continue
      expect(accentFor(surgeon), surgeon).toBe(guideHexFor(surgeon))
    }
  })
})
