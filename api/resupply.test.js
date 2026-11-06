import { describe, it, expect } from 'vitest'
import {
  normaliseResupply, candidateCases, compareResupply, resupplyFileName, codeKey, isoDate
} from './_resupply.js'

// Invented cases throughout — no real patient is named in a test.
const usage = (id, over = {}) => ({
  id,
  folderName: 'Testa_02112026_Ibbett_Fixation_RHH',
  patientSurname: 'Testa',
  surgeonSurname: 'Ibbett',
  hospital: 'RHH',
  date: '2026-11-02',
  items: [
    { id: 'i1', distributorKey: 'e4', productName: 'Reform polyaxial screw', referenceCode: 'RF-4535', quantity: 4 },
    { id: 'i2', distributorKey: 'e4', productName: 'Reform rod', referenceCode: 'RF-ROD-120', quantity: 2 },
    { id: 'i3', distributorKey: 'signus', productName: 'Diplomat screw', referenceCode: 'DP-6545', quantity: 2 },
    { id: 'i4', distributorKey: null, productName: 'Floseal', referenceCode: '', quantity: 1, excluded: true }
  ],
  ...over
})

const docket = over => normaliseResupply({
  supplier: 'E4 Surgical',
  documentNumber: 'DN-1001',
  documentDate: '05/11/2026',
  patientSurname: 'Testa',
  lines: [
    { referenceCode: 'RF 4535', description: 'Reform polyaxial screw', lotNumber: 'L777', quantity: '3' },
    { referenceCode: 'RF-ROD-120', description: 'Reform rod', lotNumber: 'L778', quantity: 'x2' }
  ],
  ...over
})

describe('reading a resupply document', () => {
  it('knows the distributor from the supplier name', () => {
    expect(docket().distributorKey).toBe('e4')
  })

  it('reads Australian day-first dates', () => {
    expect(isoDate('05/11/2026')).toBe('2026-11-05')
    expect(docket().documentDate).toBe('2026-11-05')
  })

  it('reads a quantity written "x2"', () => {
    expect(docket().lines[1].quantity).toBe(2)
  })

  it('takes the case from a usage folder-name reference', () => {
    const r = normaliseResupply({ supplier: 'E4', caseReference: 'Testa_02112026_Ibbett_Fixation_RHH', lines: [{ referenceCode: 'X' }] })
    expect(r.patientSurname).toBe('Testa')
    expect(r.surgeryDate).toBe('2026-11-02')
  })

  it('matches codes whatever their spacing and dashes', () => {
    expect(codeKey('rf 45-35')).toBe(codeKey('RF4535'))
  })
})

describe('finding the case it resupplies', () => {
  it('puts the case with the same surname first', () => {
    const found = candidateCases(docket(), [usage('a', { patientSurname: 'Other', folderName: 'Other_01112026_Fowler_ACDF_RHH' }), usage('b')])
    expect(found[0].record.id).toBe('b')
    expect(found[0].why).toContain('surname')
  })

  it('never offers a case with none of that distributor\'s items', () => {
    const signusOnly = usage('c', { items: [{ id: 'x', distributorKey: 'signus', referenceCode: 'DP-1', quantity: 1 }] })
    expect(candidateCases(docket(), [signusOnly])).toHaveLength(0)
  })

  it('does not offer a case dated well after the document', () => {
    const later = usage('d', { date: '2026-11-20' })
    const found = candidateCases(docket(), [later, usage('e')])
    expect(found[0].record.id).toBe('e')
  })
})

describe('what is still owed', () => {
  it('says product by product what came back and what is owed', () => {
    const { rows, totals } = compareResupply(usage('a'), 'e4', docket().lines)
    const screw = rows.find(r => r.referenceCode === 'RF-4535')
    expect(screw).toMatchObject({ used: 4, now: 3, owing: 1 })
    expect(totals).toMatchObject({ used: 6, now: 5, owing: 1 })
  })

  it('counts earlier resupplies, so the second docket closes the case', () => {
    const first = { lines: docket().lines }
    const second = [{ referenceCode: 'RF-4535', quantity: 1 }]
    expect(compareResupply(usage('a'), 'e4', second, [first]).totals.owing).toBe(0)
  })

  it('lists a line the case did not use apart, for a person to look at', () => {
    const lines = [...docket().lines, { referenceCode: 'ALIF-SCREW-5020', quantity: 4 }]
    expect(compareResupply(usage('a'), 'e4', lines).extras.map(l => l.referenceCode)).toEqual(['ALIF-SCREW-5020'])
  })

  it("leaves another distributor's items and excluded products out", () => {
    const { rows } = compareResupply(usage('a'), 'e4', [])
    expect(rows.map(r => r.referenceCode)).toEqual(['RF-4535', 'RF-ROD-120'])
  })
})

describe('the filed name, as the team writes it', () => {
  it('names a complete resupply plainly', () => {
    expect(resupplyFileName({ patientSurname: 'Testa', distributorKey: 'e4', partial: false, n: 1 })).toBe('Testa E4 resupply.pdf')
  })

  it('names a partial one and numbers it', () => {
    expect(resupplyFileName({ patientSurname: 'Testa', distributorKey: 'device', partial: true, n: 2 })).toBe('Testa partial Device resupply 2.pdf')
  })

  it('calls Boost Boost', () => {
    expect(resupplyFileName({ patientSurname: 'Testa', distributorKey: 'device_boost', partial: false, n: 1 })).toBe('Testa Boost resupply.pdf')
  })
})
