import { describe, it, expect } from 'vitest'
import {
  brainlabService, brainlabLabel, noImplantSystem, invoiceLine, invoiceReference, invoiceDate, sortMonth, monthBounds, RATES
} from './brainlabBilling.js'
import { isNavigationOnly } from './systems.js'
import { parseKitSupplies, systemsToSupply } from './kitSupply.js'

// Operations as Brainlab invoices from June 2024 to October 2026 wrote them,
// with what each was billed. (The whole history — 853 cases from the invoices
// and Toni's booking document — was checked when this was written: 817 agreed
// outright; the rest were VP shunts billed both ways, ENT cases billed $300
// against the $250 rule, and two one-offs. See CLAUDE.md.)
const RHH = [
  ['T3-T8 PSF', 'airo'],
  ['L4/5 PLIF', 'airo'],
  ['T9 - L1 posterior screw fixation + T11 central decompression for T11 pathological fracture and cord compression', 'airo'],
  ['Left parietal lesion for stereotactic needle biopsy. Brainlab Varioguide', 'nav'],
  ['LEFT ZMC ORIF', 'airo'],
  ['C3-5 Lat Mass Fixation', 'airo'],
  ['Varioguide Needle Biopsy', 'nav'],
  ['Stereotactic needle biopsy of left splenial lesion', 'nav'],
  ['Redo L4/5 posterior decompression +/- posterior pedicle screw fixation', 'airo'],
  ['Orbital floor reconstruction, post op spin', 'airo'],
  ['C4-6 cervical laminectomy and lateral mass screw rods and bone graft', 'airo'],
  ['Extension Fusion to L5/S1 and S2AI (Existing T10-L5 Diplomat Construct Insitu)', 'airo'],
  ['SIJ Screw fixation', 'airo'],
  ['Orbital Floor recon and Lefort Osteotomy, post op spin', 'airo'],
  ['T12-L2 Fixation', 'airo'],
  ['Scoliosis Correction', 'airo'],
  ['C0-C6 Occipital-Cervical Fusion', 'airo'],
  ['Thoracic Decompression', 'airo'],
  ['Stereotactic T4-T10 PSF for T6,7,8 fracture', 'airo'],
  ['Unilateral T12-L2 Pedicle Screw fixation for L1 Tumour', 'airo'],
  ['Unilateral Stereotactic SI screw fixation and Anterior Pelvic Plating', 'airo'],
  ['ORIF Naso Ethmoid', 'airo'],
  ['Right nasomaxillary complex fracture ORIF.', 'airo'],
  ['Craniotomy and resection Metastatic Lesion', 'nav'],
  ['Transphenoidal Resection Prolactinoma', 'nav'],
  ['Right Sphenoidotomy', 'nav'],
  ['Left Petrus Apex Biopsy', 'nav'],
  ['Resection AVM', 'nav'],
  ['Cranial Registration', 'nav'],
  ['Revision FESS', 'airo'], // Brent, 22 Nov 2026: ENT at $300, as billed through 2025
  ['FESS (Functional endoscopic sinus surgery)', 'airo']
]

describe('what a case is billed to Brainlab (Brent, 22 Nov 2026)', () => {
  it('RHH: spine, screws and max fax are AIRO; cranial and ENT are navigation', () => {
    for (const [procedure, kind] of RHH) {
      expect(brainlabService({ hospital: 'RHH', procedure }).kind, procedure).toBe(kind)
    }
  })

  it('RHH: a VP shunt is AIRO only under Ibbett (Brent, 22 Nov 2026)', () => {
    expect(brainlabService({ hospital: 'RHH', surgeon: 'Ibbett', procedure: 'VP shunt insertion' }).kind).toBe('airo')
    expect(brainlabService({ hospital: 'RHH', surgeon: 'Fowler', procedure: 'Stereotactic VP shunt Insertion' }).kind).toBe('nav')
    expect(brainlabService({ hospital: 'RHH', surgeon: 'Fowler', procedure: 'VP shunt insertion' }).check).toBeUndefined()
  })

  it('Calvary: only the Varioguide biopsies are billed', () => {
    expect(brainlabService({ hospital: 'CLV', procedure: 'Brainlab Stereotactic Needle Biopsy', kit: 'Varioguide 2.0 (Consignment)' }).kind).toBe('nav')
    expect(brainlabService({ hospital: 'Calvary Lenah Valley', procedure: '(L) frontal burr hole biopsy of lesion' }).kind).toBe('nav')
    expect(brainlabService({ hospital: 'CLV', procedure: 'L4/5 PLIF', kit: 'Diplomat' }).kind).toBe(null)
    expect(brainlabService({ hospital: 'CLV', procedure: 'Posterior Fossa Craniotomy' }).kind).toBe(null)
  })

  it("the booking's own Brainlab line wins", () => {
    expect(brainlabService({ hospital: 'CLV', procedure: 'Posterior Fossa Craniotomy', brainlab: 'AIRO' })).toMatchObject({ kind: 'airo', said: true })
    expect(brainlabService({ hospital: 'RHH', procedure: 'L4/5 PLIF', brainlab: 'Not billed' }).kind).toBe(null)
    expect(brainlabService({ hospital: 'RHH', procedure: 'VP shunt', brainlab: 'Navigation' })).toMatchObject({ kind: 'nav', said: true })
    expect(brainlabLabel('')).toBe(null)
    expect(brainlabLabel('F2F not required')).toBe(null)
  })

  it('a Varioguide is navigation, not a kit to supply', () => {
    expect(isNavigationOnly('Varioguide 2.0')).toBe(true)
    expect(parseKitSupplies('Varioguide 2.0 (Consignment)')[0].navigation).toBe(true)
    expect(systemsToSupply({ kit: 'Varioguide 2.0 (Consignment)' })).toEqual([])
    expect(isNavigationOnly('Diplomat 2')).toBe(false)
  })

  it('a biopsy, a shunt or sinus surgery takes no implant system', () => {
    expect(noImplantSystem('Brainlab Stereotactic Needle Biopsy')).toBe(true)
    expect(noImplantSystem('VP shunt insertion')).toBe(true)
    expect(noImplantSystem('Revision FESS')).toBe(true)
    expect(noImplantSystem('L4/5 PLIF')).toBe(false)
    expect(noImplantSystem('Craniotomy and cervical fixation')).toBe(false)
  })
})

describe('the month and its invoice', () => {
  it('writes each line the way every invoice since 2024 has', () => {
    expect(invoiceReference('2026-11')).toBe('NOVEMBER 2026 Clinical Support')
    expect(invoiceDate('2026-08-01')).toBe('1.8.26')
    expect(invoiceLine({ surgeon: 'JPW', patient: 'Surname', date: '2026-08-11', procedure: 'L4/5 PLIF', hospital: 'RHH' }, 'airo'))
      .toBe('Surgeon: JPW\nPatient: Surname\nSurgery Date: 11.8.26\nSurgery: L4/5 PLIF (AIRO)\nHospital: RHH')
    expect(invoiceLine({ surgeon: 'Thani', patient: 'Surname', date: '2026-11-23', procedure: 'Stereotactic needle biopsy', hospital: 'CLV' }, 'nav'))
      .toBe('Surgeon: Thani\nPatient: Surname\nSurgery Date: 23.11.26\nSurgery: Stereotactic needle biopsy (CURVE)\nHospital: Calvary Lenah Valley')
    expect(monthBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })

  const base = { surgeon: 'Fowler', patient: 'A', hospital: 'RHH', date: '2026-11-03' }
  it('puts every navigation case in exactly one list, and asks rather than guesses', () => {
    const m = sortMonth([
      { ...base, id: 'a', procedure: 'L4/5 PLIF', reps: ['Ben'] },
      { ...base, id: 'b', procedure: 'Craniotomy and resection of lesion', reps: ['Mat'] },
      { ...base, id: 'c', procedure: 'T12-L2 Fixation', reps: [] },
      { ...base, id: 'd', procedure: 'Stereotactic biopsy', reps: [], notRequired: true },
      { ...base, id: 'e', procedure: 'L4/5 PLIF', reps: ['Ben'], cancelled: true },
      { ...base, id: 'f', procedure: 'VP shunt insertion', reps: ['Ben'] },
      { ...base, id: 'g', procedure: 'Carpal tunnel release', reps: ['Ben'] },
      { ...base, id: 'h', hospital: 'CLV', procedure: 'Stereotactic needle biopsy', reps: ['Brent'] },
      { ...base, id: 'i', hospital: 'CLV', procedure: 'L4/5 PLIF', reps: ['Brent'] }
    ])
    // A Fowler VP shunt is navigation; only Ibbett's are AIRO.
    expect(m.bill.map(r => [r.id, r.amount])).toEqual([['a', 300], ['b', 250], ['f', 250], ['h', 250]])
    expect(m.ask.map(r => [r.id, r.question])).toEqual([['c', 'attended']])
    expect(m.noF2F.map(r => r.id)).toEqual(['d'])
    // A Calvary PLIF and a carpal tunnel are not Brainlab cases at all.
    expect(m.notBilled.map(r => r.id)).toEqual(['e'])
    expect(m.net).toBe(1050)
    expect(m.gst).toBe(105)
    expect(m.total).toBe(1155)
  })

  it('answers at month end settle the open ones', () => {
    const cases = [
      { ...base, id: 'c', procedure: 'T12-L2 Fixation', reps: [] },
      { ...base, id: 'f', procedure: 'VP shunt insertion', reps: ['Ben'] },
      { ...base, id: 'x', procedure: 'L4/5 PLIF', reps: ['Ben'] }
    ]
    const m = sortMonth(cases, { c: { attended: true }, f: { kind: 'airo' }, x: { kind: 'none' } })
    expect(m.ask).toEqual([])
    expect(m.bill.map(r => [r.id, r.amount])).toEqual([['c', RATES.airo], ['f', RATES.airo]])
    expect(m.notBilled.map(r => [r.id, r.reason])).toEqual([['x', 'Marked not billed']])
    const n = sortMonth(cases, { c: { attended: false } })
    expect(n.notBilled.map(r => [r.id, r.reason])).toEqual([['c', 'Not attended']])
  })
})

describe('the booking line', () => {
  it('is "Brainlab billing:", never a bare Brainlab mention', async () => {
    const { parseLabelledDescription } = await import('./labelledFields.js')
    const { readBooking } = await import('./parse.js')
    expect(parseLabelledDescription('Kit: Mariner\nSpinal Brainlab - AIRO').brainlab).toBeUndefined()
    expect(parseLabelledDescription('Patient: Surname\nBrainlab billing: Navigation').brainlab).toBe('Navigation')
    const read = readBooking('Surname Biopsy - Thani', 'Patient: Surname\nSurgeon: Thani\nHospital: CLV\nProcedure: Stereotactic needle biopsy\nBrainlab billing: Not billed')
    expect(read.brainlab).toBe('Not billed')
    expect(brainlabService({ hospital: 'CLV', procedure: read.operation, brainlab: read.brainlab }).kind).toBe(null)
  })
})

describe('front-of-the-neck cases are not Brainlab cases (October 2026 invoice)', () => {
  it('ACDFs and corpectomies are attended for the implants, not billed', () => {
    for (const p of ['C4/5 ACDF', 'C5/6 + C6/7 ACDF', 'C5,C6 Corpectomy', 'L5/S1 ALIF']) {
      expect(brainlabService({ hospital: 'RHH', procedure: p }).kind, p).toBe(null)
    }
    expect(brainlabService({ hospital: 'RHH', procedure: 'C4/5 ACDF', kit: 'Dakota + AIRO' }).kind).toBe('airo')
    expect(brainlabService({ hospital: 'RHH', procedure: 'Posterior cervical C3-5 decompression +/- lateral mass screws' }).kind).toBe('airo')
  })
})

describe('what August and September 2026 taught it', () => {
  it('a removal alone is not a Brainlab case', () => {
    expect(brainlabService({ hospital: 'RHH', procedure: 'Removal of T11-L1' }).kind).toBe(null)
    expect(brainlabService({ hospital: 'RHH', procedure: 'T9-L2 Removal of construct' }).kind).toBe(null)
    expect(brainlabService({ hospital: 'RHH', procedure: 'Removal and revision T10-L2 fixation' }).kind).toBe('airo')
  })
  it('"(no attendance)" and "(TM not required)" are not people', () => {
    const base = { surgeon: 'Ibbett', patient: 'A', hospital: 'RHH', date: '2026-08-27', procedure: 'L1/2 pedicle screw fixation' }
    const m = sortMonth([{ ...base, id: 'a', reps: ['TM not required'] }, { ...base, id: 'b', reps: ['no attendance'] }, { ...base, id: 'c', reps: ['Ben'] }])
    expect(m.bill.map(r => r.id)).toEqual(['c'])
    expect(m.ask.map(r => r.id)).toEqual(['a', 'b'])
  })
})

describe("Calvary's Varioguide on the kit (Brent, 22 Nov 2026)", async () => {
  const { kitWithVarioguide } = await import('./brainlabBilling.js')
  it('fills in Varioguide 2.0 for a Calvary needle biopsy, and nowhere else', () => {
    expect(kitWithVarioguide({ hospital: 'CLV', procedure: 'Brainlab Stereotactic Needle Biopsy', kit: '' })).toBe('Varioguide 2.0')
    expect(kitWithVarioguide({ hospital: 'Calvary Lenah Valley', procedure: 'Varioguide biopsy', kit: 'Varioguide 2.0 (Consignment)' })).toBe('Varioguide 2.0 (Consignment)')
    expect(kitWithVarioguide({ hospital: 'RHH', procedure: 'Stereotactic needle biopsy', kit: '' })).toBe('')
    expect(kitWithVarioguide({ hospital: 'CLV', procedure: 'L4/5 PLIF', kit: 'Diplomat' })).toBe('Diplomat')
    expect(kitWithVarioguide({ hospital: 'CLV', procedure: 'Stereotactic biopsy', kit: 'Brainlab' })).toBe('Brainlab / Varioguide 2.0')
  })
})
