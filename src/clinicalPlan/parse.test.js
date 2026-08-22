import { describe, it, expect } from 'vitest'
import {
  parseCaseTitle, isSurgicalCase, sanitisePatient, stripIdentifiers,
  extractKit, detectHospital, normaliseSurgeon, HOSPITALS
} from './parse.js'

describe('parseCaseTitle', () => {
  it('parses the documented pattern', () => {
    expect(parseCaseTitle('Jackson MARINER - Fowler')).toEqual({
      patient: 'Jackson', procedure: 'MARINER', surgeon: 'Fowler'
    })
  })

  it('keeps a multi-part kit intact', () => {
    expect(parseCaseTitle('Vanderheim MARINER + E4 CAGES - Gupta')).toEqual({
      patient: 'Vanderheim', procedure: 'MARINER + E4 CAGES', surgeon: 'Gupta'
    })
    expect(parseCaseTitle('Kennedy REFORM / ASCOT / ATHLET - JPW').procedure)
      .toBe('REFORM / ASCOT / ATHLET')
  })

  it('splits on the last separator, so a hyphenated kit survives', () => {
    expect(parseCaseTitle('Horne DAKOTA-2 - Ibbett')).toEqual({
      patient: 'Horne', procedure: 'DAKOTA-2', surgeon: 'Ibbett'
    })
  })

  it('accepts en and em dashes as the separator', () => {
    expect(parseCaseTitle('Gill STRYKER CCI – Fowler').surgeon).toBe('Fowler')
    expect(parseCaseTitle('Gill STRYKER CCI — Fowler').surgeon).toBe('Fowler')
  })

  it('tolerates a title or a suffix on the surgeon', () => {
    expect(parseCaseTitle('Panthi SHORELINE - Dr Gupta').surgeon).toBe('Gupta')
    expect(parseCaseTitle('Panthi SHORELINE - Gupta (RHH)').surgeon).toBe('Gupta')
  })

  it('classifies everything else as a non-case item', () => {
    const nonCases = [
      'Spine Logistics Meeting (Erin, Brent, Toni, Ben, Mat)',
      'List Order',
      'Toni – WFH',
      'Brent on call',
      'Andrea Weller (Signus) in Hobart',
      'S2AI transfer from RHH',
      // A known surgeon name alone is not a case: no patient and no kit.
      'Fowler',
      // No surgeon on the right-hand side.
      'Jackson MARINER - unknown person',
      ''
    ]
    for (const title of nonCases) {
      expect(isSurgicalCase(title), title).toBe(false)
    }
  })
})

describe('privacy (§10)', () => {
  it('keeps a surname only', () => {
    expect(sanitisePatient('Jackson')).toBe('Jackson')
    expect(sanitisePatient('Jackson, Mary')).toBe('Jackson')
    expect(sanitisePatient('Mary Jackson')).toBe('Mary') // first token, still one name
  })

  it('strips MRN/UR numbers and dates of birth', () => {
    expect(stripIdentifiers('Jackson UR 4457821 DOB 14/03/1958')).toBe('Jackson')
    expect(stripIdentifiers('Fox MRN#998877 1958-03-14')).toBe('Fox')
    expect(stripIdentifiers('Smith 12345')).toBe('Smith')
  })

  it('never lets an identifier through a parsed case', () => {
    const parsed = parseCaseTitle('Jackson 4457821 MARINER DOB 14/03/1958 - Fowler')
    expect(parsed.patient).toBe('Jackson')
    expect(JSON.stringify(parsed)).not.toMatch(/4457821|1958/)
  })

  it('drops a numeric patient token rather than rendering it', () => {
    expect(sanitisePatient('4457821')).toBe('')
    expect(parseCaseTitle('4457821 MARINER - Fowler')).toBeNull()
  })

  it('preserves legitimate surname punctuation', () => {
    expect(sanitisePatient("O'Brien")).toBe("O'Brien")
    expect(sanitisePatient('Smith-Jones')).toBe('Smith-Jones')
  })
})

describe('kit and hospital', () => {
  it('reads an explicit Kit line from the description', () => {
    expect(extractKit('Kit: Stryker PSI')).toBe('Stryker PSI')
    expect(extractKit('Notes here\nKit: Dakota (consignment)\nmore')).toBe('Dakota (consignment)')
    expect(extractKit('no kit line here at all')).toBeUndefined()
    expect(extractKit('')).toBeUndefined()
  })

  it('detects the hospital from location or description', () => {
    expect(detectHospital('RHH', '')).toBe(HOSPITALS.RHH)
    expect(detectHospital('Royal Hobart Hospital', '')).toBe(HOSPITALS.RHH)
    expect(detectHospital('Calvary Lenah Valley', '')).toBe(HOSPITALS.CALVARY)
    expect(detectHospital('', 'theatre 4, lenah valley')).toBe(HOSPITALS.CALVARY)
    expect(detectHospital('Offsite', '', { caseEvent: false })).toBe(HOSPITALS.OFFSITE)
  })

  it('defaults a case with no location to RHH and a non-case to OFFSITE', () => {
    expect(detectHospital('', '', { caseEvent: true })).toBe(HOSPITALS.RHH)
    expect(detectHospital('', '', { caseEvent: false })).toBe(HOSPITALS.OFFSITE)
  })
})

describe('normaliseSurgeon', () => {
  it('recognises every configured surgeon key', () => {
    for (const key of ['Hannan', 'Dubey', 'Thani', 'Fowler', 'Ibbett', 'JPW', 'Gupta', 'Atallah', 'Garg']) {
      expect(normaliseSurgeon(key)).toBe(key)
      expect(normaliseSurgeon(key.toLowerCase())).toBe(key)
    }
  })

  it('returns null for an unknown name', () => {
    expect(normaliseSurgeon('Nobody')).toBeNull()
    expect(normaliseSurgeon('')).toBeNull()
  })
})
