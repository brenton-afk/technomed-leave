import { describe, it, expect } from 'vitest'
import { readMoveRequest, placesSaid, matchesSearch, kitVocabulary } from './moveRequest.js'

const kits = [
  { id: 'dip-rhh', name: 'Diplomat 2', system: 'Diplomat', home: 'RHH', at: 'RHH', trays: ['Diplomat Torque & Reduction', 'Diplomat Pedicle Screws 1-5', 'Diplomat Rods'] },
  { id: 'dip-clv', name: 'Diplomat 1', system: 'Diplomat', home: 'CLV', at: 'CLV', trays: ['Diplomat Torque & Reduction', 'Diplomat Pedicle Screws 1-5'] },
  { id: 'mar-rhh', name: 'Mariner', system: 'Mariner', home: 'RHH', at: 'RHH', trays: ['Mariner MIS Reduction Towers', 'Mariner Screws'] },
  { id: 'dak-loan', name: 'Dakota TM loan', system: 'Dakota', home: 'office', kind: 'floating', at: 'office', trays: ['Dakota Instruments', 'Dakota Interbodies'] }
]

describe('a spoken move', () => {
  it("Brent's own sentence finds the RHH tray and both places", () => {
    const r = readMoveRequest('I want to move the Diplomat torque and reduction tray from RHH to Calvary.', kits)
    expect(r).toMatchObject({ from: 'RHH', to: 'CLV' })
    expect(r.choices[0]).toMatchObject({ kitId: 'dip-rhh', trays: ['Diplomat Torque & Reduction'], at: 'RHH' })
  })
  it('without "from", offers each set that has the tray', () => {
    const r = readMoveRequest('send the diplomat torque and reduction to RHH', kits)
    expect(r.to).toBe('RHH')
    expect(r.choices[0]).toMatchObject({ kitId: 'dip-clv' })
  })
  it('copes with a word heard slightly wrong and numbers said as words', () => {
    const r = readMoveRequest('move the marriner reduction towers to calvary', kits)
    expect(r.choices[0]).toMatchObject({ kitId: 'mar-rhh', trays: ['Mariner MIS Reduction Towers'] })
    expect(readMoveRequest('diplomat pedicle screws one to five from calvary to the royal', kits).choices[0])
      .toMatchObject({ kitId: 'dip-clv', trays: ['Diplomat Pedicle Screws 1-5'] })
  })
  it('a whole kit', () => {
    const r = readMoveRequest('Transfer the entire Dakota kit from the office to Calvary', kits)
    expect(r).toMatchObject({ from: 'office', to: 'CLV' })
    expect(r.choices[0]).toMatchObject({ kitId: 'dak-loan', trays: null })
  })
  it('nothing recognised gives no choices', () => {
    expect(readMoveRequest('what is for lunch', kits).choices).toEqual([])
    expect(placesSaid('from Royal Hobart Hospital to Lenah Valley')).toMatchObject({ from: 'RHH', to: 'CLV' })
  })
})

describe('the search inside a system', () => {
  it('every word must match, loosely', () => {
    expect(matchesSearch('torque', 'Diplomat Torque & Reduction')).toBe(true)
    expect(matchesSearch('torq reduc', 'Diplomat Torque & Reduction')).toBe(true)
    expect(matchesSearch('torque rhh', 'Diplomat Torque & Reduction RHH')).toBe(true)
    expect(matchesSearch('rods', 'Diplomat Torque & Reduction')).toBe(false)
    expect(matchesSearch('', 'anything')).toBe(true)
  })
  it('primes a recording with the kit names', () => {
    expect(kitVocabulary(kits)).toEqual(expect.arrayContaining(['Diplomat', 'Torque', 'Reduction', 'Mariner']))
  })
})
