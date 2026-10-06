import { describe, it, expect } from 'vitest'
import { isOrthopaedic, SURGEON_COLOUR_NAMES, SURGEON_SERVICES } from './colours.js'
import { SURGEON_KEYS, readBooking } from './parse.js'
import { accentForCase } from './theme.js'

// ─── An orthopaedic case on a spine week ────────────────────────────────────
// A different service: different kit, different theatres, a different set of
// people. The week is read by somebody carrying spine trays, so a case that is
// not one has to be obvious at a glance and in a word.

describe('the two surgeon lists agree', () => {
  it('names the same people', () => {
    // There are two: SURGEON_KEYS drives the parser and SURGEON_COLOUR_NAMES
    // drives the colour. A surgeon in one and not the other either has no
    // colour or is not recognised as a surgeon at all — and Harvie was in
    // neither, so a booking naming them was not read as a case.
    expect([...SURGEON_KEYS].sort())
      .toEqual(Object.keys(SURGEON_COLOUR_NAMES).sort())
  })

  it('puts every surgeon in a service', () => {
    const placed = SURGEON_SERVICES.flatMap(s => s.surgeons)
    for (const surgeon of SURGEON_KEYS) {
      expect(placed, surgeon).toContain(surgeon)
    }
  })
})

describe('Harvie', () => {
  it('is recognised as a surgeon', () => {
    const got = readBooking('Duncan SYNTHES VA PROXIMAL TIBIA - Harvie',
      'Surgeon: Harvie\nPatient: Duncan\nHospital: RHH')
    expect(got).not.toBeNull()
    expect(got.surgeon).toBe('Harvie')
    expect(got.patient).toBe('Duncan')
  })

  it('is orthopaedic', () => {
    expect(isOrthopaedic('Harvie')).toBe(true)
  })

  it('has a colour no spine surgeon has', () => {
    const theirs = accentForCase({ surgeon: 'Harvie' })
    for (const spine of ['Thani', 'Gupta', 'Ibbett', 'Fowler', 'JPW', 'Atallah', 'Dubey']) {
      expect(accentForCase({ surgeon: spine }), spine).not.toBe(theirs)
    }
  })
})

describe('isOrthopaedic', () => {
  it('says no for a spine surgeon', () => {
    for (const spine of ['Thani', 'Gupta', 'Ibbett', 'JPW']) {
      expect(isOrthopaedic(spine), spine).toBe(false)
    }
  })

  it('says no for nothing at all', () => {
    expect(isOrthopaedic('')).toBe(false)
    expect(isOrthopaedic(undefined)).toBe(false)
  })
})

describe('an operation named after the same bones as the kit', () => {
  // The trap this service brings. A spine system is a brand — Diplomat,
  // Mariner — so striking its words out of the operation is safe. An
  // orthopaedic set is named after the bone it goes on, and the stripper
  // reduced "Left proximal tibia, lateral and medial plates" to "Left".
  const kit = 'Synthes VA Proximal Tibia Set, Small Frag, '
    + 'Sterile Lateral VA Plates and Medial LCP Plates (Consignment)'

  const read = procedure => readBooking('Duncan SYNTHES VA PROXIMAL TIBIA - Harvie',
    `Surgeon: Harvie\nPatient: Duncan\nHospital: RHH\nProcedure: ${procedure}\nKit: ${kit}`)

  it('keeps the bone and the side', () => {
    // Losing which bone, or which side, is not a tidier operation. It is a
    // different one, on a card somebody packs a tray from.
    expect(read('Left proximal tibia, lateral and medial plates').operation)
      .toBe('Left proximal tibia, lateral and medial plates')
  })

  it('keeps the conjunction, so the line is still English', () => {
    expect(read('Lateral and medial plating').operation).toMatch(/lateral and medial/i)
  })

  it('still takes the system off a spine operation', () => {
    // The behaviour this must not break: a brand name is not an operation.
    const spine = readBooking('Mardon DIPLOMAT ACDF - Fowler', '')
    expect(spine.operation || '').not.toMatch(/diplomat/i)
    expect(spine.system).toMatch(/DIPLOMAT/i)
  })

  it('reads the supply off the kit', () => {
    expect(read('Left proximal tibia plating').supply).toBe('Consignment')
  })
})
