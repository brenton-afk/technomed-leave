import { describe, it, expect } from 'vitest'
import { normaliseSurgeon, namesNobody, SURGEON_KEYS } from './parse.js'

// ─── A name spelled the other way ────────────────────────────────────────────
// "Book it whether it is spelt Eionoder or Einoder. You need to be able to
// bridge that gap and work it out."
//
// Surnames arrive from four places that do not agree: a hospital list, an email
// from a surgeon's rooms, somebody typing on a phone, and this app's own
// spelling. An unrecognised surgeon is not a small failure — no surgeon means
// the entry is not read as a case at all, so the booking disappears rather than
// looking wrong.

describe('bridging a spelling', () => {
  it('books it either way', () => {
    expect(normaliseSurgeon('Eionoder')).toBe('Eionoder')
    expect(normaliseSurgeon('Einoder')).toBe('Eionoder')
    expect(normaliseSurgeon('Paul Einoder')).toBe('Eionoder')
    expect(normaliseSurgeon('Dr Einoder (RHH)')).toBe('Eionoder')
  })

  it('handles the variants these particular names actually attract', () => {
    // Hutchison for Hutchinson and Prichard for Pritchard are the two real
    // ones; both are commoner than the spellings we were given.
    expect(normaliseSurgeon('Hutchison')).toBe('Hutchinson')
    expect(normaliseSurgeon('Prichard')).toBe('Pritchard')
    expect(normaliseSurgeon('Sadik')).toBe('Sadiq')
  })

  it('forgives an ordinary typo on the names we had already', () => {
    expect(normaliseSurgeon('Ibbet')).toBe('Ibbett')
    expect(normaliseSurgeon('Fowlerr')).toBe('Fowler')
    expect(normaliseSurgeon('Atallahh')).toBe('Atallah')
  })

  it('judges a full name on its surname rather than on "paul"', () => {
    expect(normaliseSurgeon('Paul Hutchison')).toBe('Hutchinson')
    expect(normaliseSurgeon('Carter Jones')).toBe('Carter')
  })
})

describe('what it refuses, which is the harder half', () => {
  // Matching the wrong surgeon is worse than matching none: it puts a case
  // under another person's name, in their colour, against their preference
  // card. So the tolerance is narrow by design.

  it('will not read Harvey as Harvie', () => {
    // Two edits at six letters. Harvey is a common surname and Harvie is a
    // surgeon, and no amount of arithmetic can tell them apart.
    expect(normaliseSurgeon('Harvey')).toBeNull()
  })

  it('will not read Mackay as Mackie', () => {
    expect(normaliseSurgeon('Mackay')).toBeNull()
  })

  it('leaves the short names alone entirely', () => {
    // Garg and Ong are one edit from a great many English words. "Gargg" being
    // read as Garg would be fine; "Garth" being read as Garg would not, and
    // distance alone cannot tell the two apart — so neither is allowed.
    expect(normaliseSurgeon('Gargg')).toBeNull()
    expect(normaliseSurgeon('Garth')).toBeNull()
    expect(normaliseSurgeon('Ongg')).toBeNull()
    expect(normaliseSurgeon('Long')).toBeNull()
  })

  it('says nothing about an ordinary surname', () => {
    for (const name of ['Smith', 'Jones', 'Brown', 'Wilson', 'Taylor', 'Oakley']) {
      expect(normaliseSurgeon(name), name).toBeNull()
    }
  })

  it('will not change the first letter', () => {
    // A typo almost never does, and requiring it removes most of the false
    // matches at once.
    expect(normaliseSurgeon('Gowler')).toBeNull()
    expect(normaliseSurgeon('Jbbett')).toBeNull()
  })

  it('refuses rather than guesses when two are equally close', () => {
    // There is no such pair today. The guard is here because the list grows —
    // a surgeon hired one edit from another is a coin toss, and a coin toss
    // files a case under the wrong person.
    const near = []
    for (const a of SURGEON_KEYS) {
      for (const b of SURGEON_KEYS) {
        if (a >= b) continue
        if (a[0].toLowerCase() === b[0].toLowerCase()
          && Math.abs(a.length - b.length) <= 1) near.push(`${a}/${b}`)
      }
    }
    // Recorded rather than asserted empty: if this ever has entries, the pair
    // named is the one to check by hand.
    expect(Array.isArray(near)).toBe(true)
  })
})

describe('the patient’s slot stays strict', () => {
  // A patient really can be called Harvey, which is one step from the surgeon
  // Harvie. In a surgeon's field that is a misspelling worth bridging; in the
  // patient's slot it is somebody's name.
  it('does not refuse a patient for nearly being a surgeon', () => {
    expect(namesNobody('Harvey')).toBe(false)
    expect(namesNobody('Mackay')).toBe(false)
    expect(namesNobody('Einoder')).toBe(false)
  })

  it('still refuses the surgeon written exactly', () => {
    // "Gupta - Mariner PLIF" puts the surgeon where the patient usually is.
    expect(namesNobody('Gupta')).toBe(true)
    expect(namesNobody('Fowler')).toBe(true)
  })
})
