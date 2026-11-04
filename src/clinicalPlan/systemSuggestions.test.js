import { describe, it, expect } from 'vitest'
import { suggestSystems, groupsFor, SYSTEM_GROUPS } from './systemSuggestions.js'
import { SYSTEM_BUTTONS } from './inventory.js'

// Brent's rules, 3 Nov 2026. Operations only — no patient details.
describe('system suggestions', () => {
  it('offers pedicle screws, not ACDF systems, for a thoracolumbar fixation', () => {
    const { systems } = suggestSystems({ operation: 'T10-L2 posterior fixation', surgeon: 'Thani', hospital: 'RHH' })
    expect(systems).toEqual(['Diplomat', 'Mariner MIS', 'Mariner Open'])
    expect(systems).not.toContain('Lonestar')
  })

  it('puts the surgeon first for an ACDF', () => {
    expect(suggestSystems({ operation: 'C5/6 ACDF', surgeon: 'JPW' }).systems[0]).toBe('Lonestar')
    expect(suggestSystems({ operation: 'C5/6 ACDF', surgeon: 'Thani' }).systems.slice(0, 2)).toEqual(['CYLOX', 'Shoreline'])
    expect(suggestSystems({ operation: 'ACDF C4/5', surgeon: 'Fowler', hospital: 'RHH' }).systems[0]).toBe('Dakota')
  })

  it('offers the Locking Distractor with Ibbett ACDFs at Calvary', () => {
    const s = suggestSystems({ operation: 'ACDF C6/7', surgeon: 'Ibbett', hospital: 'CLV' })
    expect(s.systems[0]).toBe('Dakota')
    expect(s.extras).toContain('TM Locking Distractor')
  })

  it('ALIF is Catenary only', () => {
    expect(suggestSystems({ operation: 'L5/S1 ALIF' }).systems).toEqual(['Global BMD ALIF'])
  })

  it('JPW PLIF leads with Forza XP and Firebird', () => {
    expect(suggestSystems({ operation: 'L4/5 PLIF', surgeon: 'JPW' }).systems.slice(0, 2)).toEqual(['Forza XP', 'Orthofix Firebird'])
  })

  it('posterior cervical is Reform, Northstar first for Dubey', () => {
    expect(suggestSystems({ operation: 'Posterior cervical fusion C3-6' }).systems[0]).toBe('Reform Cervical')
    expect(suggestSystems({ operation: 'Posterior cervical fusion', surgeon: 'Dubey' }).systems[0]).toBe('Northstar')
  })

  it('a combined booking offers both groups', () => {
    expect(groupsFor('C5/6 ACDF and L4/5 PLIF')).toEqual(['acdf', 'plif'])
  })

  it('an unrecognised operation suggests nothing, so every button shows', () => {
    expect(suggestSystems({ operation: 'Lumbar decompression' }).systems).toEqual([])
  })

  it('names systems the way the buttons do', () => {
    for (const g of Object.values(SYSTEM_GROUPS)) {
      for (const s of [...g.systems, ...g.extras]) expect(SYSTEM_BUTTONS).toContain(s)
    }
  })

  it('pre-ticks the surgeon\'s usual systems', () => {
    expect(suggestSystems({ operation: 'C5/6 ACDF', surgeon: 'Thani' }).picks).toEqual(['CYLOX'])
    expect(suggestSystems({ operation: 'C6/7 ACDF', surgeon: 'Ibbett', hospital: 'CLV' }).picks).toEqual(['Dakota', 'TM Locking Distractor'])
    expect(suggestSystems({ operation: 'L4/5 PLIF', surgeon: 'Gupta' }).picks).toEqual(['Mariner MIS', 'Global BMD PLIF'])
    expect(suggestSystems({ operation: 'L5/S1 ALIF', surgeon: 'Fowler' }).picks).toEqual(['Global BMD ALIF'])
    // No usual system recorded: nothing ticked, the buttons are just narrowed.
    expect(suggestSystems({ operation: 'T10-L2 fixation', surgeon: 'Fowler' }).picks).toEqual([])
  })

  it('Gupta: Shoreline ACDF, Reform for C1/2, Diplomat offered for extensions', () => {
    expect(suggestSystems({ operation: 'ACDF C5/6', surgeon: 'Gupta' }).picks).toEqual(['Shoreline'])
    expect(suggestSystems({ operation: 'C1/2 fusion', surgeon: 'Gupta' }).picks).toEqual(['Reform Cervical'])
    expect(suggestSystems({ operation: 'L2-L5 fixation extension', surgeon: 'Gupta' }).systems.slice(0, 2)).toEqual(['Mariner MIS', 'Diplomat'])
  })

  it('corpectomy offers Athlet and Ascot', () => {
    expect(suggestSystems({ operation: 'C5 ACCF' }).systems.slice(0, 2)).toEqual(['Athlet', 'Ascot'])
    expect(suggestSystems({ operation: 'C5/6 ACDF' }).systems).not.toContain('Ascot')
  })

  it('offers Firebird and Forza XP only to JPW, and Atallah at RHH (Brent, 4 Nov 2026)', () => {
    expect(suggestSystems({ operation: 'L5/S1 posterior fixation', surgeon: 'Gupta' }).systems).not.toContain('Orthofix Firebird')
    expect(suggestSystems({ operation: 'L4/5 PLIF', surgeon: 'Fowler' }).systems).not.toContain('Forza XP')
    expect(suggestSystems({ operation: 'L4/5 PLIF', surgeon: 'JPW' }).systems).toContain('Orthofix Firebird')
    expect(suggestSystems({ operation: 'L4/5 PLIF', surgeon: 'Atallah', hospital: 'RHH' }).systems).toContain('Forza XP')
    expect(suggestSystems({ operation: 'L4/5 PLIF', surgeon: 'Atallah', hospital: 'CLV' }).systems).not.toContain('Forza XP')
  })

  it('offers TM Screw Removal only for an extension, revision or removal', () => {
    expect(suggestSystems({ operation: 'L5/S1 posterior fixation', surgeon: 'Gupta' }).extras).not.toContain('TM Screw Removal')
    expect(suggestSystems({ operation: 'L4/5 PLIF' }).extras).not.toContain('TM Screw Removal')
    expect(suggestSystems({ operation: 'L3/4 extension of fixation', surgeon: 'Gupta' }).extras).toContain('TM Screw Removal')
    expect(suggestSystems({ operation: 'Revision L4/5 PLIF' }).extras).toContain('TM Screw Removal')
    expect(suggestSystems({ operation: 'Removal of pedicle screws' }).systems).toContain('TM Screw Removal')
  })

  it('offers the Mariner Outrigger only for an extension', () => {
    expect(suggestSystems({ operation: 'T10-L2 fixation' }).extras).not.toContain('Mariner Outrigger')
    expect(suggestSystems({ operation: 'Extension of fixation to T10' }).extras).toContain('Mariner Outrigger')
  })
})
