import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  findImplantProcedures, impliesImplants, impliedNeeds
} from './procedureImplants.js'
import { preferenceFor, SURGEON_PREFERENCES } from './surgeonPreferences.js'
import { implantQuestion } from './deduceKit.js'
import { isNavigationOnly } from './systems.js'
import { systemsToSupply } from './kitSupply.js'
import { readBooking, namesNobody } from './parse.js'

// ─── Reading more out of a booking than it says ──────────────────────────────
// "I want a rule set that if the operation description includes acronyms like
// ALIF, PLIF, ACDF, the portal should know that the implants will be required
// to correspond with that booking request and then cross reference against
// surgeon preferences. We have to build the knowledge in the app back end so it
// can deduce better from non-descript information in the booking."

describe('what the operation says about the implants', () => {
  it('knows the acronyms carry implants', () => {
    for (const word of ['ACDF', 'ALIF', 'PLIF', 'TLIF', 'PSF']) {
      expect(impliesImplants(`C5/6 ${word}`), word).toBe(true)
    }
  })

  it('reads them written out in full, which is how half of them arrive', () => {
    expect(impliedNeeds('Anterior cervical discectomy and fusion C5/6'))
      .toMatch(/cervical cage and plate/)
    expect(impliedNeeds('L5/S1 posterior lumbar interbody fusion'))
      .toMatch(/pedicle screws/)
  })

  it('finds one written without a space, as the lists write them', () => {
    // "L4/5PLIF" is a real shape, and a leading \b would miss it.
    expect(impliesImplants('L4/5PLIF')).toBe(true)
  })

  it('does not see one inside an ordinary word', () => {
    expect(impliesImplants('uplift of the fragment')).toBe(false)
    expect(impliesImplants('Faciliating access')).toBe(false)
  })

  it('tells a decompression from a fusion', () => {
    // The one that carries nothing. Recognised deliberately rather than left
    // to fall through, so it is a known answer and not an unknown operation.
    expect(impliesImplants('L3/4 Laminectomy')).toBe(false)
    expect(findImplantProcedures('L3/4 Laminectomy')).toHaveLength(1)
  })

  it('keeps an ALIF apart from a PLIF', () => {
    // One letter, and the difference between a cage from the front and a cage
    // with pedicle screws behind it — which is also the AIRO call.
    expect(impliedNeeds('L5/S1 ALIF')).toBe('anterior lumbar interbody cage')
    expect(impliedNeeds('L5/S1 PLIF')).toMatch(/pedicle screws/)
  })

  it('answers for both halves of a two-operation booking', () => {
    // Ordered from two distributors, so one answer would leave one unordered.
    const needs = impliedNeeds('C5/6 ACDF and L4/5 PLIF')
    expect(needs).toMatch(/cervical cage and plate/)
    expect(needs).toMatch(/pedicle screws/)
  })

  it('says nothing about an operation it does not know', () => {
    expect(impliesImplants('Washout of wound')).toBe(false)
    expect(impliesImplants('Exploration')).toBe(false)
  })
})

describe('crossing it with what the surgeon uses', () => {
  it('asks rather than answering, when nobody has recorded a preference', () => {
    const q = implantQuestion({ operation: 'C5/6 ACDF', surgeon: 'Ibbett' })
    expect(q.acronyms).toEqual(['ACDF'])
    expect(q.suggestion).toBeNull()
    // Named, because this is a gap in what the office has written down rather
    // than a gap in the booking, and it will not close by itself.
    expect(q.asked).toMatch(/nothing recorded for Ibbett/)
  })

  it('stays quiet where the booking already names a system', () => {
    expect(implantQuestion({ operation: 'L4/5 PLIF', surgeon: 'Gupta', system: 'Mariner' }))
      .toBeNull()
    expect(implantQuestion({ operation: 'L4/5 PLIF', surgeon: 'Gupta', kit: 'Mariner (DT Loan)' }))
      .toBeNull()
  })

  it('stays quiet on a case nobody is packing for', () => {
    const off = { operation: 'C5/6 ACDF', surgeon: 'Ibbett', cancelled: true }
    expect(implantQuestion(off)).toBeNull()
    expect(implantQuestion({ ...off, cancelled: false, notRequired: true })).toBeNull()
  })

  it('proposes the surgeon’s own system once one is recorded', () => {
    // The table is dictated and starts empty, so this works against a row
    // rather than against the file — the behaviour is what is being tested,
    // and it must not start failing the day the real list arrives.
    const rows = [{ surgeon: 'Ibbett', acronym: 'ACDF', system: 'Dakota', since: '2026-10-09' }]
    SURGEON_PREFERENCES.push(...rows)
    try {
      expect(preferenceFor('Ibbett', 'ACDF')?.system).toBe('Dakota')
      expect(implantQuestion({ operation: 'C5/6 ACDF', surgeon: 'Ibbett' }).asked)
        .toBe('ACDF — Dakota?')
    } finally {
      SURGEON_PREFERENCES.length -= rows.length
    }
  })

  it('lets a hospital-specific preference win over the general one', () => {
    const rows = [
      { surgeon: 'Gupta', acronym: 'PLIF', system: 'Mariner', since: '2026-10-09' },
      { surgeon: 'Gupta', acronym: 'PLIF', system: 'Diplomat', hospital: 'CLV', since: '2026-10-09' }
    ]
    SURGEON_PREFERENCES.push(...rows)
    try {
      expect(preferenceFor('Gupta', 'PLIF', 'CLV').system).toBe('Diplomat')
      expect(preferenceFor('Gupta', 'PLIF', 'RHH').system).toBe('Mariner')
    } finally {
      SURGEON_PREFERENCES.length -= rows.length
    }
  })

  it('will not propose one kit for a booking with two operations', () => {
    // "ACDF and PLIF" is two preferences and two systems, and running them
    // together proposes one kit for an operation that needs two.
    const rows = [{ surgeon: 'Ibbett', acronym: 'ACDF', system: 'Dakota', since: '2026-10-09' }]
    SURGEON_PREFERENCES.push(...rows)
    try {
      const q = implantQuestion({ operation: 'C5/6 ACDF and L4/5 PLIF', surgeon: 'Ibbett' })
      expect(q.acronyms).toEqual(['ACDF', 'PLIF'])
      expect(q.suggestion).toBeNull()
    } finally {
      SURGEON_PREFERENCES.length -= rows.length
    }
  })

  it('starts empty, and is fine that way', () => {
    // A half-filled table is the ordinary state of this file. Everything built
    // on it still asks the question; it simply cannot propose an answer.
    expect(Array.isArray(SURGEON_PREFERENCES)).toBe(true)
    expect(implantQuestion({ operation: 'L4/5 PLIF', surgeon: 'Gupta' })).toBeTruthy()
  })
})

// ─── Navigation is not a kit we supply ───────────────────────────────────────
// "The spinal Brainlab AIRO is only relevant to us in the sense that we need
// the little AIRO badge applied to the booking, but instrument kits are not
// required... it will not require consignment or loan kits so shouldn't be
// included moving forward."
describe('navigation on a kit line', () => {
  const OAKLEY = 'Mariner / Spinal Brainlab / AIRO'

  it('is not asked about', () => {
    expect(systemsToSupply({ kit: OAKLEY })).toEqual(['Mariner'])
  })

  it('tells a platform from a system', () => {
    for (const nav of ['AIRO', 'Spinal Brainlab', 'Brainlab AIRO', 'Curve navigation']) {
      expect(isNavigationOnly(nav), nav).toBe(true)
    }
    for (const kit of ['Mariner', 'Dakota', 'Reform Cervical']) {
      expect(isNavigationOnly(kit), kit).toBe(false)
    }
  })

  it('keeps a system that merely happens to use navigation', () => {
    // AIRO_SIGNALS matches Mariner on purpose — a Mariner case needs a badge —
    // so testing for navigation alone would throw the system away with it.
    // Asked as one entry it survives whole; written with a separator the kit
    // line splits first and only the AIRO half goes.
    expect(isNavigationOnly('Mariner + AIRO')).toBe(false)
    expect(systemsToSupply({ kit: 'Mariner + AIRO' })).toEqual(['Mariner'])
    expect(systemsToSupply({ kit: 'Mariner (Consignment)' })).toEqual(['Mariner'])
  })

  it('does not quietly drop a word it does not recognise', () => {
    // An unrecognised word on a kit line is not something to throw away.
    expect(isNavigationOnly('AIRO trolley thing')).toBe(false)
  })

  it('leaves the kit text alone, because the badge is read out of it', () => {
    // The whole reason the words are there. Dropping them from the text would
    // take the AIRO badge off the booking, which is the one thing Brent does
    // want from them.
    const read = readBooking('Oakley MARINER - Gupta',
      `Surg: Gupta\nPt: Oakley\nHosp: CLV\nProcedure: L4/5 PLIF\nKit: ${OAKLEY}`)
    expect(read.navigation).toBe('AIRO')
    // The words are still on the booking — in this convention the Kit: label
    // is the system field — so the badge keeps working. Only the question
    // about supplying them went away.
    expect(read.system).toMatch(/AIRO/)
    expect(systemsToSupply(read)).toEqual(['Mariner'])
  })
})

// ─── A booking the hospital has not named yet ────────────────────────────────
// "There was a booking for Monday that was entered without a patient name as it
// wasn't yet confirmed. The portal missed it, probably because it didn't have a
// patient name."
describe('a booking with no patient name', () => {
  const BODY = 'Surg: Gupta\nHosp: RHH\nProcedure: L4/5 PLIF\nKit: Mariner (Consignment)'

  it('reaches the week instead of being dropped', () => {
    const read = readBooking('MARINER - Gupta', BODY)
    expect(read).not.toBeNull()
    expect(read.awaitingName).toBe(true)
    expect(read.surgeon).toBe('Gupta')
    expect(read.system).toBe('Mariner')
  })

  it('does not invent a surname out of the title', () => {
    // The worse of the two failures. A card with a name on it looks answered,
    // so nobody questions it and nobody goes looking for what is missing.
    for (const title of ['MARINER - Gupta', 'TBA MARINER - Gupta', 'Spine list - Gupta']) {
      expect(readBooking(title, BODY).patient, title).toBeNull()
    }
  })

  it('still reads a real surname', () => {
    expect(readBooking('Davie ATHLET - Gupta', BODY).patient).toBe('Davie')
  })

  it('keeps the surnames that every "looks like a name" rule breaks', () => {
    // This app has already filed a patient as "La". A list of what a name is
    // *not* is the only kind of rule that does not throw these away.
    for (const name of ['La Pietra', "O'Brien", 'Van der Berg', 'Oakley', 'Davie']) {
      expect(namesNobody(name), name).toBe(false)
    }
  })

  it('refuses the things that turn up where a surname should be', () => {
    for (const not of ['Mariner', 'Dakota', 'AIRO', 'TBA', 'TBC', 'RHH',
      'Spine', 'Theatre 3', 'Gupta']) {
      expect(namesNobody(not), not).toBe(true)
    }
  })

  it('does not turn a meeting or a leave day into a blank card', () => {
    // The surgeon alone is not enough. Every one of these names one.
    expect(readBooking('Spine MDT - Gupta', 'Surg: Gupta')).toBeNull()
    expect(readBooking('Gupta leave', 'Surg: Gupta')).toBeNull()
  })
})

describe('both cards say the same things', () => {
  // "You need a rule built in that the changes you make in one version MUST
  // correspond to both versions. I don't want to have to redo every change for
  // both versions." Earned three times over; kept as a test.
  const source = readFileSync(join(__dirname, '..', 'pages', 'CaseWeek.jsx'), 'utf8')
  const phone = source.slice(source.indexOf('function CaseCard'), source.indexOf('function WeekCase'))
  const week = source.slice(source.indexOf('function WeekCase'))

  const both = (what, pattern) => {
    it(what, () => {
      expect(phone, `CaseCard — ${what}`).toMatch(pattern)
      expect(week, `WeekCase — ${what}`).toMatch(pattern)
    })
  }

  both('asks what is going in, where the booking did not say',
    /implantQuestion\(surgicalCase\)/)
  both('says a booking is waiting on its name', /patientLabel\(surgicalCase\)/)
  both('leaves navigation out of the supply line', /suppliesFor\(surgicalCase\)/)
})
