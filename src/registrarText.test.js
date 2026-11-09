import { describe, it, expect } from 'vitest'
import { levelsFrom, registrarDraft, registrarMessage, isScrewFixation } from './usageText.js'
import { systemsInKit } from './clinicalPlan/systems.js'
import { inventoryFor } from './clinicalPlan/inventory.js'

// Brent, 4 Nov 2026: the registrar text "needs to be really simple" — patient,
// consultant, system, a line per screw level, rods, cross connector, graft and
// cages. No reference codes or lot numbers. Invented case.
describe('levels from the booking', () => {
  it('spans a range', () => {
    expect(levelsFrom('T12-L2 posterior fixation')).toEqual(['T12', 'L1', 'L2'])
    expect(levelsFrom('L4/5 PLIF')).toEqual(['L4', 'L5'])
    expect(levelsFrom('L3–S1 fusion')).toEqual(['L3', 'L4', 'L5', 'S1'])
    expect(levelsFrom('C5/6, C6/7 ACDF')).toEqual(['C5', 'C6', 'C7'])
    expect(levelsFrom('Lumbar decompression')).toEqual([])
  })
})

describe('the registrar text', () => {
  const record = { patientSurname: 'Sample', surgeonSurname: 'Fowler', procedure: 'Fixation' }
  const items = [
    { productName: 'DIPLOMAT screw', size: '6.5 x 45mm', referenceCode: 'DP-6545', lotNumber: 'L123', distributor: 'Signus' },
    { productName: 'Straight Ti rod', size: '150mm', referenceCode: 'R-150', distributor: 'Signus' },
    { productName: 'Boost DBM Allograft', referenceCode: 'B-1', distributor: 'Australian Biotechnologies' }
  ]
  const booking = { procedure: 'T12-L2 posterior fixation', kit: 'Diplomat (Consignment)' }

  it('starts from the booking and the scan, without codes', () => {
    const d = registrarDraft(record, items, booking, { systemsInKit, inventoryFor })
    expect(d).toMatchObject({
      patient: 'Sample', consultant: 'Mr Fowler', system: 'Signus Diplomat',
      levels: ['T12', 'L1', 'L2'], rods: 'Straight Ti rod 150mm', crossConnector: false,
      graft: 'Boost DBM Allograft (Australian Biotechnologies)', cages: ''
    })
  })

  it('reads simply, and leaves blank levels out', () => {
    const d = registrarDraft(record, items, booking, { systemsInKit, inventoryFor })
    d.screws = { 'T12 Left': '6.5 x 45mm', 'T12 Right': '6.5 x 45mm', 'L2 Left': '6.5 x 50mm', 'L2 Right': '6.5 x 50mm' }
    expect(registrarMessage(d)).toBe([
      'Patient: Sample',
      'Consultant: Mr Fowler',
      'System: Signus Diplomat',
      'T12 Left: 6.5 x 45mm',
      'T12 Right: 6.5 x 45mm',
      'L2 Left: 6.5 x 50mm',
      'L2 Right: 6.5 x 50mm',
      'Rods: Straight Ti rod 150mm',
      'Bone graft: Boost DBM Allograft (Australian Biotechnologies)'
    ].join('\n'))
    expect(registrarMessage(d)).not.toMatch(/DP-6545|L123|R-150/)
  })
})

// Brent, 9 Nov 2026: "only … for fixation cases (… pedicles and lateral
// masses) NOT for ACDF or ALIF."
describe('which cases get screw levels', () => {
  it('fixation into pedicles or lateral masses does', () => {
    for (const p of ['T3-T6 pedicle screw fixation', 'L4/5 PLIF, fixation, decompression + graft', 'C2, C4-5 Lateral Mass fixation',
      'T11-L3 PSF for L1 burst fracture', 'L2/3 PSF and posterolateral graft', 'Extension Fusion to L5/S1 and S2AI', 'L3/4 TLIF', 'T12-L2 posterior fixation'])
      expect(isScrewFixation(p), p).toBe(true)
  })
  it('an ACDF, ALIF or corpectomy does not, even when the plate is called fixation', () => {
    for (const p of ['C5/6 ACDF fixation decompression', 'C5/6, C6/7 ACDF', 'L5/S1 ALIF fixation and decompression', 'C6 corpectomy and fixation', 'C3 corpectomy', 'Lumbar decompression'])
      expect(isScrewFixation(p), p).toBe(false)
  })
  it('an ALIF with posterior percutaneous screws does', () => {
    expect(isScrewFixation('L4/5 ALIF + percutaneous pedicle screws')).toBe(true)
  })
  it('the draft leaves the levels empty for an ACDF', () => {
    const d = registrarDraft({ patientSurname: 'Sample' }, [], { procedure: 'C5/6 ACDF', kit: 'CYLOX' }, { systemsInKit, inventoryFor })
    expect(d.levels).toEqual([])
    expect(d.fixation).toBe(false)
  })
})
