import { describe, it, expect } from 'vitest'
import { isPreOpNoise, withoutPreOpNoise } from './preOpNoise.js'

// Hospital booking forms carry a block about getting the patient ready for
// theatre. All of it matters and none of it to us — nothing in it changes which
// tray is needed, when anybody arrives, or what is already in the patient.

describe('what gets dropped', () => {
  it('drops the workup a booking form carries', () => {
    for (const line of [
      'Bloods and ECG completed 2 weeks prior',
      'FBC, U&E, coags done',
      'Group and hold required',
      'Patient fasting from midnight',
      'Consent form signed',
      'Pre-admission clinic booked',
      'Anaesthetic review completed',
      'Chest x-ray normal',
      'COVID swab negative'
    ]) {
      expect(isPreOpNoise(line), line).toBe(true)
    }
  })
})

describe('what is kept', () => {
  it('keeps everything about the kit and the day', () => {
    for (const line of [
      'Diplomat set back from CSSD, ready for Friday',
      'AIRO CT support — pedicle screws at RHH',
      'Second up. Aimee on site 8:30',
      'Loan kit (RHH) transferred to Calvary via Smartways',
      'Cage is Life Health Care’s, not ours',
      'Theatre 11. All-day list.',
      'Has Shoreline in-situ from 29.9.2022'
    ]) {
      expect(isPreOpNoise(line), line).toBe(false)
    }
  })

  it('keeps a line that mentions both', () => {
    // Half a note is worse than a note nobody needed, and the team writes both
    // in one sentence often enough to matter.
    for (const line of [
      'Bloods done — cell saver requested for this one',
      'ECG leads to be placed clear of the AIRO gantry',
      'Consent signed, Diplomat set ordered'
    ]) {
      expect(isPreOpNoise(line), line).toBe(false)
    }
  })

  it('keeps an empty or ordinary line', () => {
    expect(isPreOpNoise('')).toBe(false)
    expect(isPreOpNoise(null)).toBe(false)
    expect(isPreOpNoise('Entered by Brent')).toBe(false)
  })
})

describe('filtering a booking’s notes', () => {
  it('leaves the two lines somebody needed', () => {
    const notes = [
      'Bloods and ECG completed 2 weeks prior',
      'Patient fasting from midnight',
      'Diplomat screws only, backing up ALIF',
      'Consent form signed',
      'AIRO CT support — pedicle screws at RHH'
    ]
    expect(withoutPreOpNoise(notes)).toEqual([
      'Diplomat screws only, backing up ALIF',
      'AIRO CT support — pedicle screws at RHH'
    ])
  })

  it('copes with nothing at all', () => {
    expect(withoutPreOpNoise([])).toEqual([])
    expect(withoutPreOpNoise()).toEqual([])
  })
})
