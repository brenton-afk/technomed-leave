import { describe, it, expect } from 'vitest'
import {
  accentForCase, accentFor, accentTextFor, guideHexFor,
  contrastRatio, SURGEON_ACCENTS, NAVIGATION_ACCENT
} from './theme.js'
import {
  GOOGLE_COLOR_NAMES, GOOGLE_COLOR_HEX, SURGEON_COLOUR_NAMES, guideColorIdFor,
  SURGEON_SERVICES
} from './colours.js'
import { findNavigation } from './systems.js'
import { readBooking, normaliseSurgeon, SURGEON_KEYS } from './parse.js'

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
    // Asserted as "no Curve badge" rather than "no badges at all", which is
    // what this test has always been about. A PSF scoliosis correction does now
    // carry AIRO — it goes in over pedicle screws — and that is correct; it is
    // the blueberry Curve badge that would be wrong.
    for (const text of [
      'T4-L2 PSF correction of the thoracic curve',
      'scoliotic curve correction',
      'main curve 52 degrees'
    ]) {
      expect(findNavigation(text), text).not.toContain('Curve')
    }
    expect(findNavigation('scoliotic curve correction')).toEqual([])
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

describe('deriving the colour a booking should carry', () => {
  // What the save endpoint does on every write: read the booking, normalise the
  // surgeon, look up the guide. Pure, so it is pinned here rather than through
  // the API — and it is the chain that decides what lands in Google.
  const colourFor = (title, description) => {
    const read = readBooking(title, description)
    return guideColorIdFor(normaliseSurgeon(read?.surgeon || '') || '')
  }

  it('works from a labelled booking', () => {
    expect(colourFor('Marsh DIPLOMAT - Ibbett',
      'Surg - Dr Ibbett\nPt - Marsh\nKit - Diplomat (Consignment)')).toBe('5')  // Banana
  })

  it('works from a title alone', () => {
    expect(colourFor('Chalmers MARINER - Fowler', '')).toBe('3')                // Grape
  })

  it('reads through an honorific or an initial', () => {
    // The live convention writes "Dr Ibbett" and "Mr J Fowler"; the guide is
    // keyed on the surname.
    expect(colourFor('Marsh DIP - Ibbett', 'Surg: Dr Ibbett\nPt: Marsh')).toBe('5')
    expect(colourFor('Chalmers MAR - Fowler', 'Surg: Mr J Fowler\nPt: Chalmers')).toBe('3')
  })

  it('covers every surgeon in the guide', () => {
    for (const [surgeon, name] of Object.entries(GUIDE)) {
      expect(colourFor(`Marsh KIT - ${surgeon}`, ''), surgeon).toBe(
        Object.keys(GOOGLE_COLOR_NAMES).find(k => GOOGLE_COLOR_NAMES[k] === name))
    }
  })

  it('leaves a booking alone when the guide has no opinion', () => {
    // A surgeon the app has never been told about keeps whatever colour the
    // person who made the booking chose. Guessing would be worse than nothing.
    expect(colourFor('Marsh KIT - Novak', 'Surg: Novak\nPt: Marsh')).toBeNull()
  })
})

describe('a navigation case with no surgeon of ours', () => {
  // The refinement: blueberry belongs to the max fax AIRO spins, the Varioguide
  // needle biopsies and the cranial registrations for other specialties. Those
  // have no spine surgeon, so there is no colour to inherit.
  it('is blueberry', () => {
    expect(accentForCase({ surgeon: 'Wilson', navigation: 'AIRO' })).toBe(NAVIGATION_ACCENT)
    expect(accentForCase({ navigation: 'Varioguide' })).toBe(NAVIGATION_ACCENT)
    expect(accentForCase({ surgeon: '', navigation: 'Curve' })).toBe(NAVIGATION_ACCENT)
  })

  it('but one of ours keeps their colour', () => {
    // An RHH pedicle screw case has AIRO and Brainlab support by definition, and
    // it is still Ibbett's case. The platform shows as a badge instead.
    for (const surgeon of Object.keys(GUIDE)) {
      expect(accentForCase({ surgeon, navigation: 'AIRO' }), surgeon).toBe(guideHexFor(surgeon))
    }
  })
})

describe('which platform a case needs', () => {
  // AIRO follows from what is being implanted, not from the word: every RHH
  // case putting in pedicle or lateral mass screws has AIRO CT and navigation
  // support by definition, and the booking rarely says so.
  it.each([
    ['L5/S1 MIS Pedicle Screw Fixation', 'AIRO'],
    ['lateral mass screws C3-C6', 'AIRO'],
    ['Kit: Reform Cervical (Consignment)', 'AIRO'],
    ['Kit - Diplomat /Cascadia/AIRO', 'AIRO'],
    ['Varioguide needle biopsy', 'Curve'],
    ['Brainlab Curve cranial registration', 'Curve']
  ])('%s → %s', (text, platform) => {
    expect(findNavigation(text)).toContain(platform)
  })

  it('leaves an ordinary case alone', () => {
    // "L4/5 PLIF" used to be listed here as an ordinary case. It is not one: a
    // PLIF goes in over pedicle screws and now earns AIRO, which is the whole
    // point of the rule change. Its place is taken by an anterior approach,
    // which genuinely needs no navigation.
    for (const text of ['C5/6 ACDF', 'L5/S1 ALIF', 'T4-L2 correction of the thoracic curve']) {
      expect(findNavigation(text), text).toEqual([])
    }
  })

  it('names the platform rather than the vendor when it knows which', () => {
    // A case should not carry both "AIRO" and "Brainlab".
    expect(findNavigation('Brainlab AIRO spin')).toEqual(['AIRO'])
    expect(findNavigation('Brainlab support')).toEqual(['Brainlab'])
  })
})

describe('lateral mass and Reform Cervical', () => {
  it('are the same product under two names', () => {
    // Reform Cervical screws *are* lateral mass screws. A booking may name the
    // anatomy or the product, so both have to be recognised — and neither is
    // redundant, which is worth pinning before somebody tidies one away.
    expect(findNavigation('C3-C6 lateral mass screws')).toEqual(['AIRO'])
    expect(findNavigation('Kit: Reform Cervical (Consignment)')).toEqual(['AIRO'])
    expect(findNavigation('C4-C7 lateral mass fixation, Reform Cervical')).toEqual(['AIRO'])
  })
})

describe('what earns an AIRO badge', () => {
  const airo = text => findNavigation(text).includes('AIRO')

  it('badges the procedures that go in over pedicle screws', () => {
    // "All cases with references to PSF, PLIF, pedicle screws and pedicle screw
    // fixations need an AIRO badge."
    //
    // A booking that says "L4/5 PLIF" often never writes the word "screws" —
    // the screws are assumed by anyone reading it clinically, and were
    // invisible to a test that only looked for them.
    expect(airo('L4/5 PLIF')).toBe(true)
    expect(airo('TLIF L4/5')).toBe(true)
    expect(airo('PSF T10-pelvis')).toBe(true)
    expect(airo('pedicle screw fixation L4-S1')).toBe(true)
    expect(airo('Pedicle Screw Fixations')).toBe(true)
    expect(airo('L4/5 laminectomy and fusion with pedicle screws')).toBe(true)
  })

  it('still badges the ways it already knew about', () => {
    expect(airo('AIRO CT support')).toBe(true)
    expect(airo('lateral mass screws')).toBe(true)
    expect(airo('Kit: Reform Cervical (Loan set)')).toBe(true)
  })

  it('badges a Global BMD PLIF case through its product name', () => {
    // The cage is named after the procedure, and that cage goes in with pedicle
    // screw fixation — so the badge is right, not an accident of the string.
    expect(airo('Kit: Diplomat (Consignment) + Global BMD PLIF')).toBe(true)
  })

  it('leaves alone the approaches that do not use pedicle screws', () => {
    // A false badge books an AIRO and a radiographer that nobody needs, which
    // is its own kind of expensive.
    // The interbody approaches split on whether they are instrumented from
    // behind: PLIF and TLIF are, ALIF and DLIF are not. One letter apart, and
    // the wrong call books an AIRO and a radiographer nobody needs.
    expect(airo('L5/S1 ALIF')).toBe(false)
    expect(airo('C4/5, C5/6 ACDF')).toBe(false)
    expect(airo('Left L3/4 DLIF')).toBe(false)
    expect(airo('Craniotomy for tumour resection')).toBe(false)
  })

  it('catches PLIF however it is written', () => {
    // "Any reference to PLIF means the case requires AIRO. This can't be
    // missed." A plural or a missing space is not a different procedure.
    for (const text of [
      'L4/5 PLIF', 'PLIFs at two levels', 'PLIFS', 'L4/5PLIF', 'plif',
      '(PLIF)', 'PLIF/TLIF', 'Kit: Global BMD PLIF',
      'posterior lumbar interbody fusion'
    ]) {
      expect(airo(text), text).toBe(true)
    }
  })

  it('does not fire on a word that merely contains the letters', () => {
    // The character before has to be something other than a letter, which is
    // what keeps "uplift" out without a trailing boundary that would lose
    // "PLIFs".
    expect(airo('uplifting news from the ward')).toBe(false)
    expect(airo('transplifting the graft')).toBe(false)
    expect(airo('PSFL')).toBe(false)
  })

  it('keeps anterior approaches out when spelled in full', () => {
    expect(airo('anterior lumbar interbody fusion')).toBe(false)
  })

  it('badges a fixation that never says the word screws', () => {
    // Cramond, 28 September. Three signals on one booking and the matcher
    // caught none of them: "Pedicle Fixation" without "screws", "Monoaxial
    // Screws" without "pedicle", and a Mariner kit, which is a pedicle screw
    // system by definition.
    const cramond = [
      'Crammond MARINER - Atallah',
      'Procedure: T10-L2 Pedicle Fixation for T12 Fracture',
      'Kit: Mariner (Monoaxial Screws)',
      'Hospital: RHH'
    ].join('\n')
    expect(airo(cramond)).toBe(true)

    // Each on its own, since any one of them may be all a booking says.
    expect(airo('T10-L2 Pedicle Fixation for T12 Fracture')).toBe(true)
    expect(airo('Kit: Mariner (Monoaxial Screws)')).toBe(true)
    expect(airo('Kit: Mariner')).toBe(true)
  })

  it('treats a pedicle screw system as enough on its own', () => {
    // A booking always names its kit, even when the procedure line is a
    // fracture level and nothing else. This is the signal most likely to still
    // be there when the others are not.
    for (const kit of ['Mariner', 'Diplomat (Consignment)', 'Orthofix Firebird']) {
      expect(airo(`Kit: ${kit}`), kit).toBe(true)
    }
  })

  it('leaves the systems that put in no screws alone', () => {
    // Cages, plates and a retractor. Badging these would book a scanner for an
    // anterior cervical case that needs no navigation at all.
    for (const kit of ['Dakota', 'CYLOX', 'Athlet + Ascot', 'Lonestar', 'Shoreline']) {
      expect(airo(`Kit: ${kit}`), kit).toBe(false)
    }
  })
})

describe('the maxillofacial surgeons', () => {
  // Technomed supports Max Fax mostly at RHH and occasionally at Calvary, and
  // nearly always for the same job: AIRO support for a post-operative CT once a
  // facial fracture is reduced and fixated.
  const MAXFAX = ['Garg', 'Varidel', 'Silifent', 'Ong', 'Carter']

  it('are read as surgeons', () => {
    // "Consultant: Dr Garg" on a forwarded booking has to find a surgeon, or
    // the booking is not read as a case at all.
    for (const name of MAXFAX) {
      expect(normaliseSurgeon(name), name).toBe(name)
      expect(normaliseSurgeon(`Dr ${name}`), name).toBe(name)
    }
  })

  it('share one colour, deliberately', () => {
    // Google has eleven and the spine guide already uses eight; there are not
    // five distinct ones left. These cases are occasional and nearly always the
    // same job, so a colour that reads "Max Fax" beats five nobody could tell
    // apart.
    const ids = MAXFAX.map(guideColorIdFor)
    expect(new Set(ids).size).toBe(1)
    expect(ids[0]).toBeTruthy()
  })

  it('do not take a colour the spine team is using', () => {
    const spine = ['Dubey', 'Thani', 'Fowler', 'Ibbett', 'JPW', 'Gupta', 'Atallah']
      .map(guideColorIdFor)
    expect(spine).not.toContain(guideColorIdFor('Garg'))
  })

  it('are offered under their own heading', () => {
    const maxfax = SURGEON_SERVICES.find(g => g.service === 'Max Fax')
    expect(maxfax.surgeons.sort()).toEqual([...MAXFAX].sort())
    const spine = SURGEON_SERVICES.find(g => g.service === 'Spine')
    expect(spine.surgeons).not.toContain('Garg')
  })

  it('leaves no surgeon out of the pickers', () => {
    // A surgeon the parser knows but no picker offers is one nobody can book.
    const offered = new Set(SURGEON_SERVICES.flatMap(g => g.surgeons))
    for (const key of SURGEON_KEYS) expect(offered.has(key), key).toBe(true)
  })
})
