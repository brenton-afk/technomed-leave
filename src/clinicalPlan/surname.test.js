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
    expect(sanitisePatient('CANCELLED Hays')).toBe('Cancelled')
  })

  it('calms a name written in capitals, as hospitals write them', () => {
    // Theatre lists and hospital emails shout. The card should not.
    expect(sanitisePatient('MARSH')).toBe('Marsh')
    expect(sanitisePatient('LA PIETRA')).toBe('La Pietra')
  })

  it('leaves a name that is mixed case on purpose alone', () => {
    // McDonald and O'Brien are written that way deliberately, and a blanket
    // lower-casing of everything after the first letter destroys both.
    expect(sanitisePatient('McDonald')).toBe('McDonald')
    expect(sanitisePatient("O'Brien")).toBe("O'Brien")
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

describe('a description already written with the name cut in half', () => {
  // "The title has changed correctly but when you edit in edit booking it
  // still just says La in the patient name, then in the description it has
  // pietra ATHLET and ASCOT. It's all over the place."
  //
  // Fixing the parser did nothing for this booking, because the damage is in
  // the stored text and the stored text wins: a labelled "Pt:" beats the
  // title, and the app itself had written "Pt: La" with "Procedure: Pietra
  // ATHLET and ASCOT" back when a surname was one word.
  const title = 'La Pietra ATHLET and ASCOT - Ibbett'
  const severed = 'Pt: La\nProcedure: Pietra ATHLET and ASCOT\nSurg: Ibbett'

  it('puts the name back together', () => {
    expect(readBooking(title, severed).patient).toBe('La Pietra')
  })

  it('takes the stranded half off the front of the procedure', () => {
    const got = readBooking(title, severed)
    expect(got.operation || '').not.toMatch(/Pietra/)
    expect(got.system).toBe('ATHLET and ASCOT')
  })

  it('takes it off the kit line too, which is where it actually was', () => {
    // Reported with a screenshot: the card read "Pietra ATHLET AND ASCOT
    // PLATE · Loan". The stranded half sits at the front of whichever
    // labelled field the app wrote it into — the procedure on one booking,
    // the kit on another — so it comes off all of them.
    const got = readBooking('La Pietra ATHLET AND ASCOT PLATE - Gupta',
      'Pt: La\nProcedure: C6 corpectomy fixation\nKit: Pietra ATHLET AND ASCOT PLATE\nSurg: Gupta')
    expect(got.patient).toBe('La Pietra')
    expect(got.system).toBe('ATHLET AND ASCOT PLATE')
    expect(got.operation).toBe('C6 corpectomy fixation')
  })

  it('leaves a correctly written description alone', () => {
    const got = readBooking(title, 'Pt: La Pietra\nSurg: Ibbett')
    expect(got.patient).toBe('La Pietra')
  })

  it('does not touch an ordinary booking', () => {
    // The repair only fires where the labelled patient is a bare particle and
    // the title continues it. Both conditions together describe one thing: a
    // name this app cut in half.
    const got = readBooking('Hollis DIPLOMAT - Ibbett',
      'Pt: Hollis\nProcedure: C5/6 ACDF\nSurg: Ibbett')
    expect(got.patient).toBe('Hollis')
    expect(got.operation).toBe('C5/6 ACDF')
  })

  it('does not fire when the title disagrees about the patient', () => {
    // "Pt: La" with a title about somebody else is two different bookings in
    // one entry, not a severed name, and guessing would merge them.
    const got = readBooking('Hollis DIPLOMAT - Ibbett',
      'Pt: La\nProcedure: Something\nSurg: Ibbett')
    expect(got.patient).toBe('La')
  })
})
