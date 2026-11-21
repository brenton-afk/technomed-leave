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
