import { describe, it, expect } from 'vitest'
import {
  parseCaseTitle, isSurgicalCase, sanitisePatient, stripIdentifiers,
  extractKit, detectHospital, normaliseSurgeon, describeCase, HOSPITALS
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
