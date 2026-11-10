import { describe, it, expect } from 'vitest'
import { codeMatch, compareResupply, candidateCases, findCases } from './_resupply.js'

// 10 Nov 2026: Mat's Shoreline resupply read "2 still owed" when the docket
// had them (codes read short off the stickers), and Erin's Boost docket, which
// names no patient, never offered the case. Invented patients.

describe('the same product, written differently', () => {
  it('matches a code read short, with or without the maker’s prefix', () => {
    expect(codeMatch('85-6509', 'SEA-85-6509')).toBeGreaterThan(0)
    expect(codeMatch('SEA-85-09', 'SEA-85-0922')).toBeGreaterThan(0)
    expect(codeMatch('ABT-AB-DT401', 'AB-DT401')).toBeGreaterThan(0)
    expect(codeMatch('AB0010-55001', 'AB0010-55001')).toBe(3)
  })
  it('does not match different products', () => {
    expect(codeMatch('SEA-85-2109', 'SEA-85-6509')).toBe(0)
    expect(codeMatch('AB0010-55001', 'AB0010-55002')).toBe(0)
    expect(codeMatch('', 'SEA-85-6509')).toBe(0)
  })
})

describe('a Shoreline resupply counted against the usage', () => {
  const record = { id: 'u1', items: [
    { id: 'a', referenceCode: '85-6509', productName: 'Shoreline RT Interbody', quantity: 1, distributorKey: 'device' },
    { id: 'b', referenceCode: 'SEA-85-2109', productName: 'SHORELINE ACS Locking Cover', quantity: 1, distributorKey: 'device' },
    { id: 'c', referenceCode: 'SEA-85-09', productName: 'SHORELINE ACS Anterior Plate - 2 Hole', quantity: 1, distributorKey: 'device' },
    { id: 'd', referenceCode: 'SEA-85-32.16', productName: 'SHORELINE ACS 3.5mm Variable S/D Screw', quantity: 2, distributorKey: 'device' }
  ] }
  const lines = [
    { referenceCode: 'SEA-85-6509', description: 'Shoreline RT Interbody 6mm', quantity: 1 },
    { referenceCode: 'SEA-85-2109', description: 'Locking cover', quantity: 1 },
    { referenceCode: 'SEA-85-0922', description: 'Anterior plate 2 hole 22mm', quantity: 1 },
    { referenceCode: 'SEA-85-3216', description: '3.5mm variable screw 16mm', quantity: 2 }
  ]
  it('owes nothing when everything came back', () => {
    const { totals, extras } = compareResupply(record, 'device', lines)
    expect(totals).toMatchObject({ used: 5, now: 5, owing: 0 })
    expect(extras).toEqual([])
  })
  it('still owes what is missing, and lists a stranger apart', () => {
    const { totals, extras } = compareResupply(record, 'device', [...lines.slice(0, 3), { referenceCode: 'SEA-99-1111', description: 'Something else', quantity: 1 }])
    expect(totals.owing).toBe(2)
    expect(extras.map(l => l.referenceCode)).toEqual(['SEA-99-1111'])
  })
})

describe('finding the case for a docket with no patient on it', () => {
  const boost = (id, surname, date, code = 'AB-DT401') => ({
    id, patientSurname: surname, surgeonSurname: 'Thani', hospital: 'CLV', date, folderName: `${surname}_x`,
    items: [{ id: 'i', referenceCode: code, productName: 'BOOST Ultrafibres 2.5g', quantity: 1, distributorKey: 'device_boost' }]
  })
  const records = [boost('old', 'Oldcase', '2026-08-24', 'ABT-AB-DT401'), boost('new', 'Recent', '2026-11-03', 'BOOST 2.5')]
  const resupply = { distributorKey: 'device', documentDate: '2026-11-06', patientSurname: '', caseReference: '',
    lines: [{ referenceCode: 'ABT-AB-DT401', description: '2.5G BOOST ULTRAFIBRES', quantity: 1 }] }

  it('offers the distributor’s recent case first, not one from August', () => {
    const c = candidateCases(resupply, records)
    expect(c.map(x => x.record.id)).toEqual(['new', 'old'])
    expect(c[0].why).toContain('recent case')
  })
  it('finds any case by surname when it is not offered', () => {
    expect(findCases('rec', records).map(r => r.id)).toEqual(['new'])
    expect(findCases('r', records)).toEqual([])
  })
})

// Mat, 10 Nov 2026 (second report): the plate's code was read "SEA-85-09"
// off an obscured sticker; the docket says "SEA-85-0509".
describe('a code with characters lost from the middle', () => {
  it('matches when the descriptions agree too', async () => {
    const { codesRelated } = await import('./_resupply.js')
    expect(codesRelated('SEA-85-09', 'SEA-85-0509')).toBe(true)
    expect(codesRelated('SEA-85-0511', 'SEA-85-0509')).toBe(false)
    const record = { items: [{ id: 'p', referenceCode: 'SEA-85-09', productName: 'SHORELINE ACS Anterior Plate - 2 Hole', quantity: 1, distributorKey: 'device' }] }
    const { totals, extras } = compareResupply(record, 'device', [{ referenceCode: 'SEA-85-0509', description: '9MM 2-HOLE ANTERIOR PLATE', quantity: 1 }])
    expect(totals.owing).toBe(0)
    expect(extras).toEqual([])
  })
  it('does not match a related code for a different product', () => {
    const record = { items: [{ id: 'p', referenceCode: 'SEA-85-09', productName: 'SHORELINE ACS Anterior Plate - 2 Hole', quantity: 1, distributorKey: 'device' }] }
    const { totals } = compareResupply(record, 'device', [{ referenceCode: 'SEA-85-0509', description: 'Locking cover', quantity: 1 }])
    expect(totals.owing).toBe(1)
  })
})
