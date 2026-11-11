import { describe, it, expect } from 'vitest'
import { distributorOf, byDistributor } from './distributors.js'

// Brent, 11 Nov 2026: the table separated by distributor, from product names.
describe('which distributor a task belongs to', () => {
  const of = task => distributorOf({ task }).name
  it('reads products as well as names', () => {
    expect(of('Chase the Diplomat rod resupply')).toBe('Signus')
    expect(of('Cylox trays to SG13.1')).toBe('Signus')
    expect(of('Mariner Open tray to RHH')).toBe('Device Technologies')
    expect(of('Boost tracking forms')).toBe('Device Technologies')
    expect(of('Dakota consignment agreement')).toBe('E4 Surgical')
    expect(of('Global BMD PLIF extras tray')).toBe('E4 Surgical')
    expect(of('Lonestar cages missing')).toBe('KT Medical')
    expect(of('REline loan for Dubey')).toBe('Nuvasive / Globus')
    expect(of('Arthrex drill saw mini handpiece')).toBe('Arthrex')
  })
  it('does not find a distributor inside another word', () => {
    expect(of('Ring the reformed team about rosters')).toBe('No distributor')
    expect(of('Book the car service')).toBe('No distributor')
  })
  it('puts a task naming two under "more than one"', () => {
    expect(distributorOf({ task: 'Swap Diplomat for Mariner on Tuesday' }).key).toBe('several')
  })
  it('groups in a fixed order, empty groups left out', () => {
    const g = byDistributor([{ task: 'Mariner' }, { task: 'Payroll' }, { task: 'Diplomat' }])
    expect(g.map(x => x.name)).toEqual(['Signus', 'Device Technologies', 'No distributor'])
  })
})
