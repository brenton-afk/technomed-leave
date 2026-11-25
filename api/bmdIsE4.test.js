import { describe, it, expect } from 'vitest'
import { detectDistributor, isExcludedProduct } from './_distributors.js'
import { normaliseResupply } from './_resupply.js'

// Brent, 25 Nov 2026: "the portal can assume that all Global Biomedica (Global
// BMD) implants are E4 implants"; haemostats "can be omitted from all scans of
// resupply and usage".
describe('Global BMD is E4, haemostats are nobody', () => {
  it('reads Catenary and every Global Biomedica spelling as E4', () => {
    for (const t of ['Catenary ALIF cage 14x30', 'Global Biomedica', 'Global Bio Medica Pty Ltd', 'GLOBAL BMD PLIF', 'GBM cage']) {
      expect(detectDistributor(t)).toBe('e4')
    }
  })
  it('drops Floseal, Gelfoam, Spongistan, Surgiflo from a resupply paper', () => {
    expect(isExcludedProduct('SURGIFLO haemostatic matrix')).toBe(true)
    const r = normaliseResupply({ supplier: 'E4 Surgical', lines: [
      { referenceCode: 'X1', description: 'Catenary cage' },
      { referenceCode: 'SP1', description: 'Spongistan 7x5' },
      { referenceCode: 'FS', description: 'FloSeal 10ml' }
    ] })
    expect(r.lines.map(l => l.referenceCode)).toEqual(['X1'])
    expect(r.distributorKey).toBe('e4')
  })
})
