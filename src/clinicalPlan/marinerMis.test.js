import { describe, it, expect } from 'vitest'
import { resolveKit, systemsInKit } from './systems.js'

// Brent, 4 Nov 2026: a booking read as "Mariner percutaneous screw system" AND
// "Mariner MIS". They are the same set; anything that says percutaneous, perc
// or MIS screws means Mariner MIS, and it is named once.
describe('Mariner MIS under any name', () => {
  it.each([
    ['Mariner percutaneous screw system / Mariner MIS', 'Mariner MIS'],
    ['Mariner percutaenous screw system and Mariner MIS (Distributor Loan)', 'Mariner MIS (Distributor Loan)'],
    ['percutaneous pedicle screws', 'Mariner MIS'],
    ['Perc screws', 'Mariner MIS'],
    ['MIS screws', 'Mariner MIS'],
    ['Mariner (MIS)', 'Mariner MIS'],
    ['Mariner Perc', 'Mariner MIS'],
    ['MIS', 'Mariner MIS'],
    ['Diplomat / MIS', 'Diplomat / Mariner MIS']
  ])('%s → %s', (written, means) => {
    expect(resolveKit(written)).toBe(means)
  })

  it('leaves Mariner Open, plain Mariner and open screws alone', () => {
    expect(resolveKit('Mariner Open')).toBe('Mariner Open')
    expect(resolveKit('Mariner')).toBe('Mariner')
    expect(resolveKit('Diplomat (Consignment) (open screws)')).toBe('Diplomat (Consignment) (open screws)')
    expect(resolveKit('Mariner Outrigger')).toBe('Mariner Outrigger')
  })

  it('counts as one Mariner for the loan logic', () => {
    expect(systemsInKit(resolveKit('Perc screws + Mariner MIS'))).toEqual(['Mariner'])
  })
})
