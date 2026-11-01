import { describe, it, expect } from 'vitest'
import { readBooking, parseCaseTitle, knownSurnameLength, sanitisePatient, normaliseEvent } from './parse.js'
import { replaceSurname } from './labelledFields.js'

// ─── Task 4: a surname the portal was told, not one it guessed ────────────────
// Fake names throughout. "Testa Rossa" stands for any two-word surname that
// does not start with a particle — the particle list covers Van der Berg and La
// Pietra; nothing read off a title can tell "Testa Rossa" from a first name
// and a surname, or from a surname and an operation.

describe('a surname recorded on the event', () => {
  it('is read whole from the title', () => {
    expect(parseCaseTitle('Testa Rossa CYLOX - Ibbett').patient).toBe('Testa')
    expect(parseCaseTitle('Testa Rossa CYLOX - Ibbett', { knownPatient: 'Testa Rossa' }).patient)
      .toBe('Testa Rossa')
  })

  it('is read whole from a labelled booking', () => {
    const description = 'Surg - Dr Ibbett\nPt - Testa Rossa Bianca (Jo)\nProcedure - L4/5 TLIF\nKit - CYLOX (Loan)'
    expect(readBooking('Testa Rossa Bianca CYLOX - Ibbett', description).patient).toBe('Testa')
    expect(readBooking('Testa Rossa Bianca CYLOX - Ibbett', description,
      { knownPatient: 'Testa Rossa Bianca' }).patient).toBe('Testa Rossa Bianca')
  })

  it('does not leave the rest of the name in the procedure', () => {
    const read = readBooking('Testa Rossa ACDF - Ibbett', '', { knownPatient: 'Testa Rossa' })
    expect(read.patient).toBe('Testa Rossa')
    expect(read.operation || '').not.toMatch(/Rossa/)
  })

  it('gives way when somebody has retyped the booking in Google', () => {
    // The app must never say something the calendar does not.
    expect(readBooking('Marsh CYLOX - Ibbett', '', { knownPatient: 'Testa Rossa' }).patient)
      .toBe('Marsh')
  })

  it('does not change a particle surname the parser already reads', () => {
    expect(readBooking('Van der Berg DIPLOMAT - Ibbett', '').patient).toBe('Van der Berg')
  })

  it('matches regardless of case', () => {
    expect(knownSurnameLength(['TESTA', 'ROSSA', 'ACDF'], 'Testa Rossa')).toBe(2)
    expect(sanitisePatient('TESTA ROSSA', { known: 'Testa Rossa' })).toBe('Testa Rossa')
  })

  it('is carried from the event into the week plan', () => {
    const event = {
      id: 'e', summary: 'x', start: { dateTime: '2026-11-04T09:00:00+11:00' },
      end: { dateTime: '2026-11-04T10:00:00+11:00' },
      extendedProperties: { private: { tmPatient: 'Testa Rossa' } }
    }
    expect(normaliseEvent(event).knownPatient).toBe('Testa Rossa')
    expect(normaliseEvent({ ...event, extendedProperties: undefined, knownPatient: 'Testa Rossa' })
      .knownPatient).toBe('Testa Rossa')
  })
})

describe('replacing a surname in the Pt line', () => {
  it('keeps a first name after a single-word surname', () => {
    expect(replaceSurname('Mitchell (Jo)', 'Marsh')).toBe('Marsh (Jo)')
  })

  it('replaces every word of a multi-word surname', () => {
    expect(replaceSurname('Van der Berg (Jo)', 'Marsh', 'Van der Berg')).toBe('Marsh (Jo)')
  })

  it('completes a surname the app had cut short, without doubling it', () => {
    expect(replaceSurname('Testa Rossa (Jo)', 'Testa Rossa', 'Testa')).toBe('Testa Rossa (Jo)')
  })
})
