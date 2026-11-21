import { describe, it, expect } from 'vitest'
import { trayKind, groupTrays } from './trayKind.js'

// Brent, 21 Nov 2026: "group instrument trays and implant trays together.
// With the order of trays." Invented trays.
const m = n => Array.from({ length: n }, () => ({ kind: 'instrument' }))
const i = n => Array.from({ length: n }, () => ({ kind: 'implant' }))

describe('which trays are implant trays', () => {
  it('goes by what most lines are', () => {
    expect(trayKind({ name: 'A', lines: [...i(22), ...m(1)] })).toBe('implant')
    expect(trayKind({ name: 'B', lines: [...m(13)] })).toBe('instrument')
    expect(trayKind({ name: 'C', lines: [...m(1), ...i(1)] })).toBe('instrument')
  })
  it('goes by the name when nothing is listed, instruments first', () => {
    expect(trayKind({ name: 'Diplomat Pedicle Screws 1-5', lines: [] })).toBe('implant')
    expect(trayKind({ name: 'Rods and tulips 3-5' })).toBe('implant')
    expect(trayKind({ name: 'TM Screw Removal' })).toBe('instrument')
    expect(trayKind({ name: 'Insertion 2-1' })).toBe('instrument')
    expect(trayKind({ name: 'Tray 7' })).toBe('instrument')
  })
})

describe('grouping', () => {
  it('puts instruments first, implants second, each in the kit order', () => {
    const trays = [
      { name: 'Insertion', lines: m(3) }, { name: 'Torque', lines: m(2) },
      { name: 'Screws', lines: i(5) }, { name: 'Rods', lines: i(4) },
      { name: 'Towers', lines: m(2) }
    ]
    const g = groupTrays(trays)
    expect(g.map(x => x.label)).toEqual(['Instrument trays', 'Implant trays'])
    expect(g[0].trays.map(t => t.name)).toEqual(['Insertion', 'Torque', 'Towers'])
    expect(g[1].trays.map(t => t.name)).toEqual(['Screws', 'Rods'])
  })
  it('leaves out an empty group', () => {
    expect(groupTrays([{ name: 'Insertion', lines: m(1) }]).map(x => x.kind)).toEqual(['instrument'])
  })
})

describe('sterile implants in their own section at the bottom (Brent, 21 Nov 2026)', async () => {
  const { groupTrays: group, isSterileTray } = await import('./trayKind.js')
  const imp = name => ({ name, lines: [{ code: 'A', description: 'Cage', qty: 1, kind: 'implant' }] })
  const inst = name => ({ name, lines: [{ code: 'B', description: 'Inserter', qty: 1, kind: 'instrument' }] })
  it('puts the implant trays of Shoreline, Catenary, Global PLIF, MOBIS and Athlet last, under Sterile implants', () => {
    const g = group([imp('MOBIS Implants'), inst('MOBIS Insertion')], { system: 'MOBIS' })
    expect(g.map(x => x.label)).toEqual(['Instrument trays', 'Sterile implants'])
    expect(g[1].trays.map(t => t.name)).toEqual(['MOBIS Implants'])
    for (const [system, tray] of [['Shoreline', 'Shoreline Sterile Interbodies'], ['Catenary ALIF', 'Catenary ALIF Cages'], ['Global BMD PLIF', 'Global BMD PLIF Interbodies'], ['Athlet', 'Athlet Cages']]) {
      expect(isSterileTray({ name: tray, lines: [] }, system)).toBe(true)
    }
  })
  it('leaves other systems’ implant trays where they were, unless named sterile', () => {
    const g = group([imp('Diplomat Pedicle Screws 1-5'), inst('Diplomat Torque & Reduction')], { system: 'Diplomat' })
    expect(g.map(x => x.label)).toEqual(['Instrument trays', 'Implant trays'])
    expect(isSterileTray({ name: 'Dakota Sterile Plates', lines: [] }, 'Dakota')).toBe(true)
    expect(isSterileTray(inst('Shoreline Instruments'), 'Shoreline')).toBe(false)
  })
  it('keeps a plate-and-screw tray of those systems with the other trays — only boxed interbodies are sterile', () => {
    const plates = { name: 'Shoreline Plate & Screw 1', lines: [{ code: 'P', description: 'Anterior plate 2 level', qty: 1, kind: 'implant' }, { code: 'S', description: 'Screw 4.0 x 14', qty: 8, kind: 'implant' }] }
    expect(isSterileTray(plates, 'Shoreline')).toBe(false)
    expect(isSterileTray({ name: 'Catenary ALIF Implants', lines: [] }, 'Catenary ALIF')).toBe(false)
    const g = group([inst('Shoreline Instruments'), plates, { name: 'Shoreline Sterile Interbodies', lines: [] }], { system: 'Shoreline' })
    expect(g.map(x => x.label)).toEqual(['Instrument trays', 'Implant trays', 'Sterile implants'])
  })
})
