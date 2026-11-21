import { describe, it, expect } from 'vitest'
import { codesForSystem, codeCounts } from './_resourcePrices.js'

// Invented lines in the workbook's layout — no real codes or prices.
const line = (range, code, description, extra = {}) => ({ code, description, range, type: 'Implant', rebate: `PL${code}`, price: 1, setting: 'Fixed', ...extra })
const book = {
  meta: { readAt: '2026-11-18T00:00:00Z', file: 'Price_Lists.xlsx' },
  lists: {
    signus: [line('Diplomat', 'D1', 'Screw'), line('Diplomat', 'D2', 'Rod'), line('Cylox', 'C1', 'Cage')],
    e4: [line('Global BMD', 'G1', 'BMD ALIF Standalone 12mm'), line('Global BMD', 'G2', 'BMD Titanium PLIF 10mm'), line('Global BMD', 'G3', '12mm BMD Graft')],
    'kt-private': [line('FIREBIRD', 'F1', 'Screw')],
    'kt-rhh': [line('FIREBIRD', 'F1', 'Screw'), line('FIREBIRD', 'F2', 'Rod')],
    device: [line('Mariner MIS', 'M1', 'Screw'), line('Mariner', 'M2', 'Rod'), line('Mariner Outrigger', 'O1', 'Connector')],
    globus: [line('RELINE Open', 'R1', 'Screw'), line('X-CORE II', 'X1', 'Cage')]
  }
}

describe('rebate codes under each system', () => {
  it('gives each system its own lines by the range, without prices unless asked', () => {
    const d = codesForSystem(book, 'Diplomat')
    expect(d.lists).toHaveLength(1)
    expect(d.lists[0].lines.map(l => l.code)).toEqual(['D1', 'D2'])
    expect(d.lists[0].lines[0]).toEqual({ code: 'D1', description: 'Screw', range: 'Diplomat', type: 'Implant', rebate: 'PLD1' })
    expect(codesForSystem(book, 'Diplomat', { withPrices: true }).lists[0].lines[0].price).toBe(1)
  })
  it('splits Global BMD into the Catenary ALIF and the PLIF, and Mariner from its Outrigger', () => {
    expect(codesForSystem(book, 'Catenary ALIF').lists[0].lines.map(l => l.code)).toEqual(['G1'])
    expect(codesForSystem(book, 'Global BMD PLIF').lists[0].lines.map(l => l.code)).toEqual(['G2', 'G3'])
    expect(codesForSystem(book, 'Mariner').lists[0].lines.map(l => l.code)).toEqual(['M1', 'M2'])
    expect(codesForSystem(book, 'Mariner Outrigger').lists[0].lines.map(l => l.code)).toEqual(['O1'])
  })
  it('keeps KT’s private and RHH lists apart', () => {
    const f = codesForSystem(book, 'Orthofix Firebird')
    expect(f.lists.map(l => l.hospital)).toEqual(['RHH', 'private'])
  })
  it('counts each system for its card, and knows nothing of a system with no range', () => {
    expect(codeCounts(book, ['Diplomat', 'Orthofix Firebird', 'REline', 'Nuvasive', 'TM Screw Removal'])).toEqual({ Diplomat: 2, 'Orthofix Firebird': 2, REline: 1, Nuvasive: 1 })
    expect(codesForSystem(book, 'TM Screw Removal').lists).toEqual([])
    expect(codesForSystem(null, 'Diplomat').lists).toEqual([])
  })
})
