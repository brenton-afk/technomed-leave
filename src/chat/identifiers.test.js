import { describe, it, expect } from 'vitest'
import { identifiersIn, identifierWarning } from './identifiers.js'

// A warning that fires on every second message is one people stop reading, and
// then it is worse than nothing. So the false positives matter more than the
// catches here: the "says nothing about" block is the important half of this
// file, and every line in it is something the team actually types.

const warns = text => identifiersIn(text).length > 0

describe('what it warns about', () => {
  it('catches a date of birth', () => {
    expect(warns('Rowe 12/3/1958 is second up')).toBe(true)
    expect(warns('DOB 12-03-58')).toBe(true)
    expect(warns('1958-03-14')).toBe(true)
  })

  it('catches a UR number', () => {
    expect(warns('Patient 8001112 on the list')).toBe(true)
    expect(warns('UR 4471902')).toBe(true)
  })

  it('catches a labelled identifier even without the number', () => {
    expect(warns('will get the MRN from theatre')).toBe(true)
  })

  it('catches a full name where something says it is a patient', () => {
    expect(warns('spoke to Mr David Thompson')).toBe(true)
    expect(warns('Pt Rowe John second up')).toBe(true)
    expect(warns('Patient: Rowe John')).toBe(true)
  })

  it('does not try to spot a full name from capitals alone', () => {
    // Deliberate, and a real miss: "Rowe John is second up" says nothing. The
    // alternative was warning on "X-Core Mini", "Global Biomedica", "Reform
    // Cervical" and half the trade — and a warning nobody reads is worse than
    // no warning. A date of birth and a UR number are the identifiers that
    // matter, and both are caught on their own shape.
    expect(warns('Rowe John is second up tomorrow')).toBe(false)
  })
})

describe('what it says nothing about', () => {
  it('leaves surnames alone', () => {
    // The whole vocabulary of an ordinary day.
    for (const message of [
      'Rowe is second up tomorrow',
      'Kon first, then Rowe',
      'Diplomat set back from CSSD, ready for Friday',
      'Petrusma moved to Calvary',
      'ACDF competitor cage first up at RHH'
    ]) {
      expect(warns(message), message).toBe(false)
    }
  })

  it('leaves spinal levels alone', () => {
    // "L4/5" and "C5/6" are the reason the date pattern insists on a year.
    for (const message of [
      'L4/5 PLIF Wednesday',
      'C5/6 C6/7 ACDF',
      'T10-L2 pedicle fixation',
      'L5/S1 ALIF at 8'
    ]) {
      expect(warns(message), message).toBe(false)
    }
  })

  it('leaves the numbers of the trade alone', () => {
    for (const message of [
      'Theatre 11 all day',
      '2 Diplomat sets at Calvary',
      'X-Core Mini 12mm and 14mm',
      'on site by 0730'
    ]) {
      expect(warns(message), message).toBe(false)
    }
  })

  it('leaves surgeons and places alone', () => {
    // Two capitalised words in a row is not a patient when we know one of them.
    for (const message of [
      'Peters Willke list moved',
      'Royal Hobart theatre 11',
      'Lenah Valley tomorrow',
      'Life Health Care cage',
      'Device Technologies confirmed the loan',
      'Wednesday September looks heavy'
    ]) {
      expect(warns(message), message).toBe(false)
    }
  })

  it('says nothing about an empty message', () => {
    expect(identifiersIn('')).toEqual([])
    expect(identifiersIn(null)).toEqual([])
  })
})

describe('the warning itself', () => {
  it('names what it found', () => {
    expect(identifierWarning('Rowe 12/3/1958')).toMatch(/date of birth/)
    expect(identifierWarning('UR 8001112')).toMatch(/UR or MRN/)
  })

  it('reads as one sentence when it found several', () => {
    const warning = identifierWarning('Rowe John, DOB 12/3/1958, UR 8001112')
    expect(warning).toMatch(/ and /)
    expect(warning).toMatch(/Surnames only/)
  })

  it('is nothing at all when there is nothing to say', () => {
    expect(identifierWarning('Rowe is second up')).toBeNull()
  })
})
