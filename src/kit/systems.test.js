import { describe, it, expect } from 'vitest'
import { groupSystems, systemOf, traysByPlace, kitForNewTray, setLabel } from './systems.js'

// Brent, 20 Nov 2026: one tab per system, trays inside it, "Add a tray" within
// the system. Invented kits.
const kits = [
  { id: 'd2', name: 'Diplomat 2', system: 'Diplomat', home: 'RHH', at: 'RHH', kind: 'consignment', trays: ['Diplomat Pedicle Screws 1'] },
  { id: 'd1', name: 'Diplomat 1', system: 'Diplomat', home: 'CLV', at: 'CLV', kind: 'consignment', trays: ['Diplomat Rods', 'Diplomat Instruments'] },
  { id: 'dl', name: 'Dakota (TM loan)', system: 'Dakota', home: 'office', at: 'office', kind: 'floating', trays: [] },
  { id: 'dk', name: 'Dakota', system: 'Dakota', home: 'RHH', at: 'RHH', kind: 'consignment', trays: ['Dakota 1', 'Dakota 2'], trayAt: { 'Dakota 1': { at: 'CLV' } } }
]

describe('the kit room by system', () => {
  it('makes one entry per system, sets in place order with a TM loan last', () => {
    const g = groupSystems(kits)
    expect(g.map(x => x.name)).toEqual(['Diplomat', 'Dakota'])
    expect(g[0].kits.map(k => k.id)).toEqual(['d1', 'd2'])
    expect(g[1].kits.map(k => k.id)).toEqual(['dk', 'dl'])
  })

  it('takes a set number off a kit with no system', () => {
    expect(systemOf({ name: 'Lonestar 2' })).toBe('Lonestar')
    expect(systemOf({ name: 'Dakota (TM loan)' })).toBe('Dakota')
  })

  it('counts trays where they are, a tray moved on its own included', () => {
    expect(traysByPlace(groupSystems(kits)[1].kits)).toEqual({ CLV: 1, RHH: 1, office: 0 })
  })

  it('adds a tray to the set at that place, or starts a set there', () => {
    const diplomat = groupSystems(kits)[0]
    expect(kitForNewTray(diplomat, { system: 'Diplomat', place: 'RHH', tray: 'Diplomat Pedicle Screws 2' }).kit)
      .toMatchObject({ id: 'd2', trays: ['Diplomat Pedicle Screws 1', 'Diplomat Pedicle Screws 2'] })
    const made = kitForNewTray(diplomat, { system: 'Diplomat', place: 'office', tray: 'Spare' }).kit
    expect(made).toMatchObject({ name: 'Diplomat', system: 'Diplomat', home: 'office', kind: 'consignment', trays: ['Spare'] })
    expect(made.id).toBeUndefined()
    expect(() => kitForNewTray(diplomat, { system: 'Diplomat', place: 'CLV', tray: 'diplomat rods' })).toThrow(/already has/)
    expect(kitForNewTray(null, { system: 'Shoreline', place: 'CLV', tray: 'Shoreline 1', distributor: 'device' }).kit)
      .toMatchObject({ name: 'Shoreline', distributor: 'device', home: 'CLV' })
  })

  it('shows the Mariner Outrigger inside the Mariner tile, and adds new trays to Mariner\'s own set', () => {
    const kits = [
      { id: 'o', name: 'Mariner Outrigger', system: 'Mariner Outrigger', home: 'CLV', kind: 'technomed', trays: ['Outrigger'] },
      { id: 'm', name: 'Mariner', system: 'Mariner', home: 'CLV', kind: 'consignment', trays: ['Mariner Screws 1'] }
    ]
    const g = groupSystems(kits)
    expect(g.map(x => x.name)).toEqual(['Mariner'])
    expect(setLabel(kits[0])).toBe('Mariner Outrigger')
    expect(setLabel(kits[1])).toBe('')
    expect(kitForNewTray(g[0], { system: 'Mariner', place: 'CLV', tray: 'Mariner Screws 2' }).kit.id).toBe('m')
  })

  it('counts a place where a set sits with no trays listed yet, at 0', () => {
    expect(traysByPlace([{ home: 'office', at: 'office', trays: [] }, { home: 'RHH', at: 'RHH', trays: ['A'] }])).toEqual({ office: 0, RHH: 1 })
  })
})
