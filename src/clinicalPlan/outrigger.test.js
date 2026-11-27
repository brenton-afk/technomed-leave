import { describe, it, expect } from 'vitest'
import { needsOutrigger, kitWithAutoOutrigger, OUTRIGGER_KIT } from './outrigger.js'
import { kitWithDaySupplies, parseKitSupplies } from './kitSupply.js'
import { tmLoanDispatches, dispatchTask } from './dispatch.js'
import { suggestSystems } from './systemSuggestions.js'

// Brent, 19 Nov 2026: "extension, revision and connecting cases get an
// automatic allocation of Mariner outrigger as a DNO (Do not open) tray … At
// Calvary it lives on shelf as a consignment. If the extension case is at RHH,
// it will need to be flagged that the kit needs to be transferred from Calvary
// to RHH."

describe('which cases get the Outrigger on standby', () => {
  it.each([
    'Extension of L3-5 fixation to T12',
    'Revision L4/5 PLIF',
    'Connecting to existing construct T10-L2',
    'L2/3 PLIF, extend up from existing L3-5',
    'Redo posterior fusion L4-S1'
  ])('%s', procedure => expect(needsOutrigger({ procedure })).toBe(true))

  it.each([
    'L4/5 PLIF',
    'ACDF revision C5/6',
    'Revision ALIF L5/S1',
    'Removal of L4-5 screws',
    'Posterior cervical extension C3-6',
    'Sterotactic redo left sided craniotomy and excision open biopsy of enhancing lesion',
    'Redo burr holes for chronic subdural',
    'Revision of VP shunt',
    'Redo'
  ])('not: %s', procedure => expect(needsOutrigger({ procedure })).toBe(false))

  it('"No Outrigger" in the notes leaves it off, and a kit naming it is never changed', () => {
    expect(needsOutrigger({ procedure: 'Extension L2-5', notes: 'No outrigger please' })).toBe(false)
    expect(kitWithAutoOutrigger({ procedure: 'Extension L2-5', kit: 'Mariner Open / Outrigger (Consignment)' }))
      .toBe('Mariner Open / Outrigger (Consignment)')
  })
})

describe('on the booking', () => {
  const kit = kitWithAutoOutrigger({ procedure: 'Extension of L3-5 fixation to T12', kit: 'Mariner Open (Consignment)' })

  it('is added as a DNO tray beside the rest of the kit', () => {
    expect(kit).toBe(`Mariner Open (Consignment) / ${OUTRIGGER_KIT}`)
    expect(kitWithAutoOutrigger({ procedure: 'Revision L4/5 PLIF', kit: '' })).toBe(OUTRIGGER_KIT)
  })

  it('at Calvary it is off the shelf: consignment, nothing to move', () => {
    const line = kitWithDaySupplies({ kit, hospital: 'CLV' })
    expect(line).toBe('Mariner Open (Consignment) / Mariner Outrigger (DNO) (Consignment)')
    expect(tmLoanDispatches([{ id: 'e1', date: '2026-11-24', hospital: 'CLV', surgeon: 'Thani', supplies: parseKitSupplies(line) }])).toEqual([])
  })

  it('at RHH it is borrowed from Calvary, and the week says to transfer it the working day before', () => {
    const line = kitWithDaySupplies({ kit, hospital: 'RHH' })
    expect(line).toContain('Mariner Outrigger (DNO) (Calvary Loan)')
    const [move] = tmLoanDispatches([{ id: 'e1', date: '2026-11-24', hospital: 'RHH', surgeon: 'Thani', supplies: parseKitSupplies(line) }])
    expect(move).toMatchObject({ kind: 'transfer', from: 'Calvary', to: 'RHH', date: '2026-11-23' })
    expect(dispatchTask(move).what).toBe('Transfer the Mariner Outrigger kit from Calvary to RHH')
  })

  it('the Add booking buttons offer it for a revision too', () => {
    const r = suggestSystems({ operation: 'Revision L4/5 PLIF', surgeon: 'Thani', hospital: 'CLV' })
    expect([...r.systems, ...r.extras]).toContain('Mariner Outrigger')
  })
})
