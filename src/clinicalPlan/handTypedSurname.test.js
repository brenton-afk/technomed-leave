import { describe, it, expect } from 'vitest'
import { readBooking, surnameFromField, handTypedSurnameLength } from './parse.js'

// ─── Surnames typed straight into Google Calendar, read whole ────────────────
// "All surnames must be added accurately without any post editing." Fake names.

describe('a booking typed into Google with a two-word surname', () => {
  it.each([
    ['Testa Rossa CYLOX - Ibbett', 'Testa Rossa'],
    ['Testa Rossa ACDF - Thani', 'Testa Rossa'],
    ['Testa Rossa L4/5 PLIF - Thani', 'Testa Rossa'],
    ['Testa Rossa - Ibbett', 'Testa Rossa'],
    ['Lloyd-Jones DIPLOMAT - Ibbett', 'Lloyd-Jones'],
    ['Van der Berg DIPLOMAT - Ibbett', 'Van der Berg']
  ])('%s → %s', (title, surname) => {
    expect(readBooking(title, '').patient).toBe(surname)
  })

  it('stops at an operation, anatomy, a system or a hospital', () => {
    expect(readBooking('Marsh Revision Fusion - Ibbett', '').patient).toBe('Marsh')
    expect(readBooking('Marsh Hip Replacement - Ibbett', '').patient).toBe('Marsh')
    expect(readBooking('Marsh Reform - Ibbett', '').patient).toBe('Marsh')
    expect(readBooking('Marsh Calvary DIPLOMAT - Ibbett', '').patient).toBe('Marsh')
  })

  it('reads the whole name when the Pt line and the title agree', () => {
    const description = 'Surg - Ibbett\nPt - Testa Rossa (Jo)\nProcedure - L4/5 TLIF\nKit - CYLOX'
    expect(readBooking('Testa Rossa CYLOX - Ibbett', description).patient).toBe('Testa Rossa')
  })

  it('keeps a first name on the Pt line out of the surname', () => {
    const description = 'Surg - Ibbett\nPt - Marsh Donna\nProcedure - L5/S1 PLIF\nKit - DIPLOMAT'
    expect(readBooking('Marsh DIPLOMAT - Ibbett', description).patient).toBe('Marsh')
  })

  it('never lengthens past three words', () => {
    expect(handTypedSurnameLength(['Aa', 'Bb', 'Cc', 'Dd', 'ACDF'])).toBe(3)
  })
})

describe('a surname field from an email, dictation or a usage form', () => {
  it.each([
    ['Van der Berg', 'Van der Berg'],
    ['Testa Rossa', 'Testa Rossa'],
    ['TESTA ROSSA', 'Testa Rossa'],
    ['Smith, John', 'Smith'],
    ['VAN DER BERG Johanna', 'Van der Berg'],
    ["O'BRIEN Patricia", "O'brien"],
    ['Mrs Testa Rossa', 'Testa Rossa'],
    ['Smith DOB 12/3/1958', 'Smith']
  ])('%s → %s', (value, surname) => {
    expect(surnameFromField(value)).toBe(surname)
  })
})

describe('the RHH theatre list', () => {
  it('keeps every capitalised word of the surname and drops the given name', async () => {
    const { readPatientCell } = await import('./parseTheatreList.js')
    expect(readPatientCell('VAN DER BERG Johanna')).toBe('Van der Berg')
    expect(readPatientCell('LLOYD JONES Mary 12/3/1958')).toBe('Lloyd Jones')
    expect(readPatientCell('DE SILVA Ana')).toBe('De Silva')
    expect(readPatientCell('KT Lonestar')).toBeNull()
  })
})

describe('a usage form', () => {
  it('files a multi-word surname whole, not by its last word', async () => {
    const { normaliseCase } = await import('../../api/_usageCase.js')
    const record = normaliseCase({ patientSurname: 'VAN DER BERG Johanna', surgeonName: 'Dr A Thani', items: [] },
      { repName: 'Toni Test', repEmail: 'toni@technomed.com.au', scanDate: '2026-11-01' })
    expect(record.patientSurname).toBe('Van der Berg')
    expect(record.surgeonSurname).toBe('Thani')
  })
})
