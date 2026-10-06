import { describe, it, expect } from 'vitest'
import { sanitisePatient, surnameLength, readBooking } from './parse.js'

// ─── "Patient surname is La Pietra" ─────────────────────────────────────────
// The title is read as "surname, then everything else", and the surname was
// taken to be the first word. For most people that is right. For La Pietra it
// took "La" and gave "Pietra" to the operation — so the booking was filed
// under a surname that does not exist, the Dropbox folder was named after it,
// and the usage sheet carried it to a distributor.
//
// It also could not be corrected by hand: typing the space back into the
// booking was undone on the way through, because the same function cleans the
// Pt: field.

describe('surnameLength', () => {
  it('is one word for an ordinary surname', () => {
    expect(surnameLength(['Hollis', 'DIPLOMAT'])).toBe(1)
  })

  it('takes the particle with the name', () => {
    expect(surnameLength(['La', 'Pietra', 'DIPLOMAT'])).toBe(2)
    expect(surnameLength(['De', 'Silva', 'PLIF'])).toBe(2)
  })

  it('takes several particles', () => {
    expect(surnameLength(['Van', 'der', 'Berg', 'ACDF'])).toBe(3)
  })

  it('does not swallow the operation after a particle', () => {
    // "Van ACDF - Thani" is a patient called Van having an ACDF. Joining
    // there eats the operation off the front and leaves the case with none.
    expect(surnameLength(['Van', 'ACDF'])).toBe(1)
    expect(surnameLength(['De', 'PLIF'])).toBe(1)
  })

  it('does not swallow the system after a particle', () => {
    expect(surnameLength(['La', 'Mariner'])).toBe(1)
    expect(surnameLength(['Van', 'DIPLOMAT'])).toBe(1)
  })

  it('never takes every word', () => {
    // A particle with nothing after it is a word that happens to be in the
    // list, not a surname, and taking the lot leaves nothing for the rest.
    expect(surnameLength(['Van'])).toBe(1)
    expect(surnameLength(['De', 'la'])).toBe(1)
  })
})

describe('sanitisePatient', () => {
  it('keeps the space', () => {
    expect(sanitisePatient('La Pietra')).toBe('La Pietra')
  })

  it('capitalises a name typed in a hurry', () => {
    expect(sanitisePatient('la pietra')).toBe('La Pietra')
  })

  it('leaves a particle lower case after the first word', () => {
    // "Van der Berg", which is how the name is written.
    expect(sanitisePatient('van der berg')).toBe('Van der Berg')
  })

  it('still takes the surname out of "Surname, First"', () => {
    expect(sanitisePatient('Hollis, David')).toBe('Hollis')
    expect(sanitisePatient('La Pietra, Maria')).toBe('La Pietra')
  })

  it('still drops a cancellation marker rather than reading it as a name', () => {
    // Unchanged from before: the marker is taken as the one word, shouting
    // included, and the case is matched as cancelled elsewhere.
    expect(sanitisePatient('CANCELLED Hays')).toBe('CANCELLED')
  })

  it('is unchanged for every ordinary surname', () => {
    for (const name of ['Hollis', 'Pennant', 'Quintrell', 'Mardon']) {
      expect(sanitisePatient(name), name).toBe(name)
    }
  })
})

describe('the booking as a whole', () => {
  it('reads La Pietra off a title', () => {
    const got = readBooking('La Pietra DIPLOMAT - Ibbett', '')
    expect(got.patient).toBe('La Pietra')
    expect(got.system).toBe('DIPLOMAT')
  })

  it('reads La Pietra out of an edited Pt: field', () => {
    // The half that made this uncorrectable: editing the booking writes
    // "Pt: La Pietra", and the same truncation ran on the way back in.
    const got = readBooking('Something - Ibbett', 'Pt: La Pietra\nSurg: Ibbett')
    expect(got.patient).toBe('La Pietra')
  })

  it('leaves the operation alone', () => {
    const got = readBooking('Van der Berg ACDF - Thani', '')
    expect(got.patient).toBe('Van der Berg')
    expect(got.operation).toBe('ACDF')
  })
})
