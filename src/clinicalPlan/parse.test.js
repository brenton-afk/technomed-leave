import { describe, it, expect } from 'vitest'
import {
  parseCaseTitle, isSurgicalCase, sanitisePatient, stripIdentifiers,
  extractKit, detectHospital, normaliseSurgeon, describeCase, HOSPITALS, isCancelled, stripCancellation, readBooking
} from './parse.js'

describe('parseCaseTitle', () => {
  it('parses the documented pattern', () => {
    expect(parseCaseTitle('Jackson MARINER - Fowler')).toEqual({
      patient: 'Jackson', procedure: 'MARINER', surgeon: 'Fowler', surgeonSource: 'title'
    })
  })

  it('keeps a multi-part kit intact', () => {
    expect(parseCaseTitle('Vanderheim MARINER + E4 CAGES - Gupta')).toEqual({
      patient: 'Vanderheim', procedure: 'MARINER + E4 CAGES', surgeon: 'Gupta', surgeonSource: 'title'
    })
    expect(parseCaseTitle('Kennedy REFORM / ASCOT / ATHLET - JPW').procedure)
      .toBe('REFORM / ASCOT / ATHLET')
  })

  it('splits on the last separator, so a hyphenated kit survives', () => {
    // A hyphen inside a kit name must survive: the title is sliced at the one
    // separator that locates the surgeon, not tokenised on every dash.
    expect(parseCaseTitle('Horne DAKOTA-2 - Ibbett')).toEqual({
      patient: 'Horne', procedure: 'DAKOTA-2', surgeon: 'Ibbett', surgeonSource: 'title'
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

describe('tolerating real booking titles', () => {
  // The strict `<Patient> <KIT> - <Surgeon>` shape rejected a real Kennedy
  // booking. These are the shapes that must all read as the same case.
  const equivalent = [
    'Kennedy REFORM / ASCOT / ATHLET - JPW',
    'Kennedy REFORM - JPW',
    'Kennedy REFORM-JPW',
    'Kennedy REFORM -JPW',
    'Kennedy REFORM- JPW',
    'Kennedy REFORM: JPW',
    'Kennedy REFORM – JPW',
    'Kennedy REFORM — JPW',
    'JPW - Kennedy REFORM'
  ]

  it.each(equivalent)('reads "%s" as Kennedy / JPW', title => {
    const parsed = parseCaseTitle(title)
    expect(parsed).not.toBeNull()
    expect(parsed.patient).toBe('Kennedy')
    expect(parsed.surgeon).toBe('JPW')
    expect(parsed.surgeonSource).toBe('title')
  })

  it('accepts a title with no system at all', () => {
    expect(parseCaseTitle('Kennedy - JPW')).toMatchObject({ patient: 'Kennedy', surgeon: 'JPW' })
  })

  it('still keeps a multi-part kit together', () => {
    expect(parseCaseTitle('Vanderheim MARINER + E4 CAGES - Gupta').procedure)
      .toBe('MARINER + E4 CAGES')
  })
})

describe('attributing a case by its calendar colour', () => {
  // The colour guide exists so surgeon allocation is visible at a glance, so
  // where a title does not name a surgeon the colour is allowed to.
  it('uses the colour when the title names no surgeon', () => {
    const parsed = parseCaseTitle('Kennedy REFORM', { colourSurgeon: 'JPW' })
    expect(parsed).toMatchObject({ patient: 'Kennedy', surgeon: 'JPW', surgeonSource: 'colour' })
  })

  it('works for a title that is only a patient name', () => {
    expect(parseCaseTitle('Kennedy', { colourSurgeon: 'Gupta' }))
      .toMatchObject({ patient: 'Kennedy', surgeon: 'Gupta', procedure: '' })
  })

  it('prefers the title over the colour when both name a surgeon', () => {
    // A miscoloured booking must still be attributed to the named surgeon, so
    // the colour check can report the mismatch.
    const parsed = parseCaseTitle('Kennedy REFORM - JPW', { colourSurgeon: 'Gupta' })
    expect(parsed.surgeon).toBe('JPW')
    expect(parsed.surgeonSource).toBe('title')
  })

  it('refuses to invent a case from a staffing entry, however it is coloured', () => {
    // On-call and reduced-hours entries are routinely coded Graphite, which is
    // officially Dubey's colour. Without this guard every week would grow a
    // phantom Dubey case.
    const notCases = [
      'Brent on call', 'Brent on-call', 'Ben – late start / early finish',
      'Toni – WFH', 'Erin – office', 'List Order', 'Spine Logistics Meeting',
      'Catch up – Erin & Brent', 'S2AI transfer from RHH', 'Annual leave',
      'NSA Conference', 'Handover: Ben becomes Team Leader',
      'Andrea Weller (Signus) in Hobart'
    ]
    for (const title of notCases) {
      expect(parseCaseTitle(title, { colourSurgeon: 'Dubey' }), title).toBeNull()
    }
  })

  it('still declines when neither the title nor a colour names a surgeon', () => {
    expect(parseCaseTitle('Nguyen DIPLOMAT - Kowalski')).toBeNull()
    expect(parseCaseTitle('Theatre 3 list', { colourSurgeon: null })).toBeNull()
  })

  it('keeps stripping identifiers whichever route is taken', () => {
    const parsed = parseCaseTitle('Kennedy UR 4457821 REFORM', { colourSurgeon: 'JPW' })
    expect(JSON.stringify(parsed)).not.toMatch(/4457821/)
  })
})


describe('reading a booking however it was written', () => {
  // The same case, typed six ways. Bookings are free text entered in a hurry, so
  // the plan cannot depend on a convention being followed — and until this was
  // fixed, every one of these produced a different layout, printed the system
  // twice, or silently lost the consignment status.
  const shapes = [
    ['SHORELINE', 'C4/5 ACDF Shoreline\nKit: Shoreline (consignment)'],
    ['C4/5 ACDF SHORELINE', 'C4/5 ACDF SHORELINE consignment'],
    ['SHORELINE', 'Procedure: C4/5 ACDF with Shoreline — on consignment'],
    ['C4/5 ACDF SHORELINE (consignment)', ''],
    ['SHORELINE', 'C4/5 ACDF\nKit: Shoreline consignment'],
    ['', 'C4/5 ACDF Shoreline, consignment']
  ]

  it.each(shapes)('reads "%s" / "%s" the same way', (title, notes) => {
    const read = describeCase(title, notes)
    expect(read.operation).toBe('C4/5 ACDF')
    expect(read.system).toMatch(/shoreline/i)
    expect(read.supply).toBe('Consignment')
    // The system must not also be sitting inside the operation.
    expect(read.operation).not.toMatch(/shoreline/i)
    expect(read.kit).toBeUndefined()
  })

  it('never repeats the system on the kit line', () => {
    for (const [title, notes] of shapes) {
      const read = describeCase(title, notes)
      if (!read.kit || !read.system) continue
      expect(read.kit.toLowerCase()).not.toBe(read.system.toLowerCase())
    }
  })
})

describe('assigning each fact to one field', () => {
  it('keeps the team\'s own wording for a multi-system case', () => {
    const read = describeCase('REFORM / ASCOT / ATHLET', '')
    expect(read.system).toBe('REFORM / ASCOT / ATHLET')
    expect(read.operation).toBeUndefined()
  })

  it('finds the system in the notes when the title has none', () => {
    // "Kennedy - JPW" with the detail written underneath.
    const read = describeCase('', 'C5/6 ACDF Mariner, consignment')
    expect(read.system).toMatch(/mariner/i)
    expect(read.operation).toBe('C5/6 ACDF')
    expect(read.supply).toBe('Consignment')
  })

  it('puts a TechnoMed loan set on the kit line, not the operation', () => {
    const read = describeCase('DAKOTA-2', 'L4/5 TLIF. TM Locking Distractor also needed')
    expect(read.operation).toBe('L4/5 TLIF')
    expect(read.system).toBe('DAKOTA-2')
    expect(read.kit).toBe('TM Locking Distractor')
  })

  it('keeps instruments that are genuinely a second thing to bring', () => {
    // Patient-specific instruments alongside the implant system: two sets.
    const read = describeCase('STRYKER CCI', 'Kit: Stryker PSI on loan')
    expect(read.system).toBe('STRYKER CCI')
    expect(read.kit).toBe('Stryker PSI')
    expect(read.supply).toBe('Loan')
  })

  it('keeps a qualifier on the operation rather than trimming it away', () => {
    // "Revision of L4/5 fusion" is not the same operation as "L4/5 fusion".
    const read = describeCase('MARINER', 'Revision of L4/5 fusion, Mariner consignment')
    expect(read.operation).toBe('Revision of L4/5 fusion')
  })

  it('stops the operation at the surgery, not at the end of the note', () => {
    const read = describeCase('REFORM', 'C3-C6 ACDF please bring extra plates')
    expect(read.operation).toBe('C3-C6 ACDF')
  })

  it('reads an unknown system by position, so a new one still shows', () => {
    // Adding a system to systems.js is what makes it tidy, not what makes it
    // appear. A system nobody has listed yet must not vanish from the plan.
    const read = describeCase('NEWSYSTEM 9000', 'L5/S1 ALIF')
    expect(read.system).toBe('NEWSYSTEM 9000')
    expect(read.operation).toBe('L5/S1 ALIF')
  })

  it('reports nothing rather than guessing when there is nothing to read', () => {
    expect(describeCase('', '')).toEqual({
      operation: undefined, system: undefined, supply: undefined, kit: undefined
    })
  })

  it('still strips identifiers, whichever field they were written in', () => {
    const read = describeCase('MARINER UR 4457821', 'C5/6 ACDF DOB 14/03/1958')
    expect(JSON.stringify(read)).not.toMatch(/4457821|1958/)
  })
})

// ─── Cancellations ───────────────────────────────────────────────────────────
// "It's currently not up to date, as patient Streets has been cancelled for
// tomorrow." Deleting the booking is the clean way and needs nothing here —
// Google stops returning it. But the team more often renames it, because a
// deleted booking leaves no record that the theatre time was ever held, and a
// renamed one was read as a live case: same patient, same surgeon, same kit, and
// nothing to say nobody is operating.

describe('spotting a booking that has been called off', () => {
  it('reads a cancellation in the title', () => {
    expect(isCancelled('CANCELLED - Streets ACDF - JPW', '')).toBe(true)
    expect(isCancelled('Streets ACDF - JPW (cancelled)', '')).toBe(true)
    expect(isCancelled('Streets ACDF - JPW', 'Cancelled by the surgeon')).toBe(true)
  })

  it('reads the other words the team uses', () => {
    expect(isCancelled('Streets - POSTPONED', '')).toBe(true)
    expect(isCancelled('Streets - abandoned', '')).toBe(true)
    expect(isCancelled('Streets ACDF - cancellation', '')).toBe(true)
  })

  it('leaves a live case alone', () => {
    expect(isCancelled('Streets C4/5 ACDF SHORELINE - JPW', 'Kit: Shoreline')).toBe(false)
    expect(isCancelled('', '')).toBe(false)
    expect(isCancelled(undefined, undefined)).toBe(false)
  })

  it('will not match inside another word', () => {
    // Anchored to a word start on purpose. A substring match would take a real
    // case off the list, which is far worse than showing one that is off.
    expect(isCancelled('Cancellaro L4/5 TLIF - JPW', '')).toBe(false)
  })
})

describe('reading a booking that was renamed rather than deleted', () => {
  it('still gives the case its patient and surgeon', () => {
    // A title reads {Patient} {procedure} - {Surgeon}, so "CANCELLED - Streets
    // ACDF - JPW" put the marker exactly where the patient's name goes and the
    // case came out belonging to a patient called Cancelled. Keeping a cancelled
    // booking on the page is pointless if it does not say which case it was.
    const read = readBooking('CANCELLED - Streets C4/5 ACDF SHORELINE - JPW', 'Kit: Shoreline')
    expect(read.patient).toBe('Streets')
    expect(read.surgeon).toBe('JPW')
  })

  it('handles the marker in brackets at the end', () => {
    const read = readBooking('Streets C4/5 ACDF SHORELINE - JPW (cancelled)', 'Kit: Shoreline')
    expect(read.patient).toBe('Streets')
    expect(read.surgeon).toBe('JPW')
  })

  it('does not disturb a title with a hyphen in it', () => {
    // The first attempt normalised every separator and turned "L4-L5" into
    // "L4 L5". A vertebral level is not a separator.
    expect(stripCancellation('Jackson L4-L5 TLIF - JPW')).toBe('Jackson L4-L5 TLIF - JPW')
    expect(stripCancellation('CANCELLED - Jackson L4-L5 TLIF - JPW')).toBe('Jackson L4-L5 TLIF - JPW')
  })
})

// ─── Two bugs reported from the live calendar ────────────────────────────────
// "Pt Chalmers, Fowler for today should have Mat's name in the title as it is
// in the calendar, but it is not currently displayed." And: "pt Marchetti has been
// added to tomorrow's list, but is listed as cancelled in the app, but not in
// the calendar."
//
// Both are the same failure wearing different clothes — the app saying
// something the calendar does not. One by omission, one by invention.

describe('the rep who attended', () => {
  it('survives a title that also names the surgeon', () => {
    // The bug. normaliseSurgeon tolerates a surname "buried in a longer
    // string", so "Fowler (Mat)" matched Fowler, the whole fragment was
    // consumed as the surgeon, and Mat went with it — silently.
    const read = readBooking('Chalmers MARINER - Fowler (Mat)', 'Kit: Mariner MIS')
    expect(read.rep).toBe('Mat')
    expect(read.patient).toBe('Chalmers')
    expect(read.surgeon).toBe('Fowler')
  })

  it('is read from the convention the team was given', () => {
    // "Pt name>SYSTEM>Surgeon name>(REP NAME)". ">" was not a separator, so a
    // title in this exact format split on nothing and the whole booking came
    // back blank — no patient, no surgeon, no system.
    const read = readBooking('Chalmers>MARINER>Fowler>(Mat)', '')
    expect(read.patient).toBe('Chalmers')
    expect(read.surgeon).toBe('Fowler')
    expect(read.system).toBe('MARINER')
    expect(read.rep).toBe('Mat')
  })

  it('is only ever a name from the roster', () => {
    // A bracketed "(RHH)" is a hospital and "(2 of 3)" is a count. Guessing
    // would put either where a person's name goes.
    expect(readBooking('Chalmers MARINER - Fowler (RHH)', '').rep).toBeNull()
    expect(readBooking('Chalmers MARINER - Fowler (2 of 3)', '').rep).toBeNull()
  })

  it('is absent when the calendar does not name one', () => {
    expect(readBooking('Marchetti ACDF SHORELINE - JPW', '').rep).toBeNull()
  })
})

describe('not inventing a cancellation', () => {
  it('leaves a live case alone when a note merely mentions one', () => {
    // The reported bug. The description was scanned for the word anywhere, so a
    // note *about* a cancellation struck a live case through and labelled it
    // CANCELLED — the app contradicting the calendar, which is worse than
    // showing nothing, because nobody can trust a screen that invents a fact.
    for (const note of [
      'Moved from Tuesday, that list was cancelled',
      'Note: loan set cancellation from Stryker',
      'Rebooked after the 8th was postponed',
      'Check the cancellation policy for the loan kit'
    ]) {
      expect(isCancelled('Marchetti ACDF SHORELINE - JPW', note), note).toBe(false)
    }
  })

  it('still believes the title', () => {
    // Renaming the booking is how the team actually marks one off.
    expect(isCancelled('CANCELLED - Marchetti ACDF - JPW', '')).toBe(true)
    expect(isCancelled('Marchetti ACDF - JPW (cancelled)', '')).toBe(true)
  })

  it('still believes a note that says only that', () => {
    // A line of its own is a deliberate marker rather than a passing mention.
    expect(isCancelled('Marchetti ACDF - JPW', 'CANCELLED')).toBe(true)
    expect(isCancelled('Marchetti ACDF - JPW', 'Kit: Shoreline\nCancelled.')).toBe(true)
  })
})

describe('never silently dropping what the title says', () => {
  it('surfaces words no field claimed', () => {
    // How the rep went missing for weeks: the parser drops what it cannot
    // place, and says nothing about having done so.
    const read = readBooking('Panthi ACDF - Ibbett URGENT bring extra cages', '')
    expect(read.unread).toBe('URGENT bring extra cages')
  })

  it('says nothing when everything was placed', () => {
    // A check that cries wolf gets ignored, and then it is not a check. These
    // all parse completely and must produce no leftover line.
    for (const title of [
      'Chalmers MARINER - Fowler (Mat)',
      'Marchetti C4/5 ACDF SHORELINE - JPW',
      'Kennedy REFORM-JPW',
      'Chalmers>MARINER>Fowler>(Mat)'
    ]) {
      expect(readBooking(title, '').unread, title).toBeUndefined()
    }
  })

  it('stays quiet on a labelled booking, where the title is decoration', () => {
    // There the description is the record and the title is often a placeholder.
    const read = readBooking('Booking', 'Patient: Jackson\nSurgeon: Fowler\nKit: Dakota (Consignment)')
    expect(read.unread).toBeUndefined()
  })
})

// ─── Shapes taken from the live bookings calendar ────────────────────────────
// Every case here is a real booking from 21–22 September, reproduced exactly —
// except the patient surnames, which are invented. The faults are all in the
// *shape* of the entry, never in the name, so there is nothing to be gained by
// committing real ones to the repository.
//
// These were found by reading the actual calendar after two were reported. The
// synthetic fixtures had missed all of them, because they were written from what
// the parser expected rather than from what the team types.

describe('bookings as the team actually writes them', () => {
  it('reads the rep off a labelled booking', () => {
    // Reported: "should have Mat's name in the title as it is in the calendar,
    // but it is not currently displayed".
    const read = readBooking('Chalmers DIPLOMAT + E4 Cages - Fowler (Mat)',
      'Surg: Fowler\nPt: Chalmers\nHosp: RHH\nDate: 21/9/26\n'
      + 'Surgery: L5/S1 PSF and PLIF\nKit: Diplomat and E4 Cages (Consignment)')
    expect(read.rep).toBe('Mat')
    expect(read.surgeon).toBe('Fowler')
    expect(read.system).toBe('Diplomat and E4 Cages')
    expect(read.supply).toBe('Consignment')
  })

  it('does not call a rebooked case cancelled', () => {
    // Reported, and this is the note verbatim. The case had been called off on
    // the Friday and put back on for the Tuesday; the app read the word and
    // struck out the live booking.
    const notes = 'Surg: Atallah\nPt: Marchetti\nDate: 22/9/26\n'
      + 'Surgery: C3-T2 cervical fixation, C4-C7 Lami \nKit: Reform Cervical (Consignment)\nHosp: RHH\n\n'
      + 'This patient was cancelled from Friday 18/9 and rebooked to Tuesday 22/9\n\n'
      + 'Notification received from Toby at 1318hrs Monday 21/9/26 on WA\n\nEntered/amended by Brent'
    expect(isCancelled('Marchetti REFORM CERVICAL- Atallah', notes)).toBe(false)
    expect(readBooking('Marchetti REFORM CERVICAL- Atallah', notes).patient).toBe('Marchetti')
  })

  it('still marks the one that really was called off', () => {
    // Same day, same calendar: the team renames the title when they mean it.
    expect(isCancelled('CANCELLED Sturrock LONESTAR - JPW',
      'Surg: JPW\nPt: Sturrock\nKit: Lonestar (Consignment)')).toBe(true)
  })

  it('does not say the supply twice when two systems share one bracket', () => {
    // "Diplomat (Consignment) / Cascadia" was read whole as the system, and the
    // supply inferred from the same words — "DIPLOMAT (CONSIGNMENT) / CASCADIA ·
    // Consignment" on the card.
    const read = readBooking('Larkin DIPLOMAT / CASCADIA - Ibbett',
      'Surgeon: Ibbett\nPatient: Larkin\nProcedure: L5/S1 PLIF\n'
      + 'Kit: Diplomat (Consignment)  / Cascadia\nHospital: Calvary Lenah Valley')
    expect(read.system).toBe('DIPLOMAT / CASCADIA')
    expect(read.supply).toBe('Consignment')
  })

  it('copes with the supply written against each system', () => {
    // "Diplomat (consignment) /Cascadia (cons)" — named twice, meant once, and
    // "cons" is the team's own shorthand.
    const read = readBooking('Larkin DIPLOMAT / CASCADIA - Ibbett',
      'Surg - Dr Ibbett \nPt - Larkin \nProcedure - L4/5 PLIF/resection of facet cyst \n'
      + 'Kit - Diplomat (consignment) /Cascadia (cons)\nHospital - Calvary Lenah Valley')
    expect(read.system).toBe('DIPLOMAT / CASCADIA')
    expect(read.supply).toBe('Consignment')
  })

  it('never shows a bracket cut off mid-word', () => {
    // "Farr CYLOX (second LOAN kit) - Thani" split on the dash and the system
    // came out "CYLOX (second", printed on the card exactly like that.
    const read = readBooking('Dunne CYLOX (second LOAN kit) - Thani',
      'Surgeon: Thani\nPatient: Dunne\nProcedure: C5/6 ACDF fixation decompression\n'
      + 'Kit: CYLOX (LOAN)\nHospital: Calvary Lenah Valley')
    expect(read.system).toBe('CYLOX')
    expect(read.supply).toBe('Loan')
  })

  it('keeps a patient to their surname when a first name is typed in', () => {
    // "Pt - Larkin (Jane)" appears in the calendar. Surnames only, always.
    const read = readBooking('Larkin DIPLOMAT / CASCADIA - Ibbett',
      'Surg - Dr Ibbett \nPt - Larkin (Jane) \nKit - Diplomat (consignment)')
    expect(read.patient).toBe('Larkin')
    expect(JSON.stringify(read)).not.toMatch(/Jane/i)
  })

  it('reads a surgeon the app has never been told about', () => {
    // Atallah is not in SURGEON_KEYS. A booking must not vanish because the
    // roster of surgeons is out of date.
    const read = readBooking('Marchetti REFORM CERVICAL- Atallah',
      'Surg: Atallah\nPt: Marchetti\nKit: Reform Cervical (Consignment)')
    expect(read.surgeon).toBe('Atallah')
  })
})
