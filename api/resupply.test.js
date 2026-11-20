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
    expect(resupplyFileName({ patientSurname: 'Testa', distributorKey: 'e4', stage: 'complete', n: 1 })).toBe('Testa E4 resupply.pdf')
  })

  it('names the first of several "partial", unnumbered, and later ones numbered', () => {
    expect(resupplyFileName({ patientSurname: 'Testa', distributorKey: 'signus', stage: 'partial', n: 1 })).toBe('Testa partial Signus resupply.pdf')
    expect(resupplyFileName({ patientSurname: 'Testa', distributorKey: 'device', stage: 'partial', n: 2 })).toBe('Testa partial Device resupply 2.pdf')
  })

  it('names the one that finishes it "remaining"', () => {
    expect(resupplyFileName({ patientSurname: 'Testa', distributorKey: 'device', stage: 'remaining', n: 3 })).toBe('Testa remaining Device resupply.pdf')
  })

  it('calls Boost Boost', () => {
    expect(resupplyFileName({ patientSurname: 'Testa', distributorKey: 'device_boost', stage: 'complete', n: 1 })).toBe('Testa Boost resupply.pdf')
  })
})

describe('named by the portal, never by staff (Toni, 20 Nov 2026)', async () => {
  const { resupplyNaming, familyKey } = await import('./_resupply.js')
  const record = {
    patientSurname: 'Testa',
    items: [
      { id: 'i1', referenceCode: 'DEV-SCREW-645', productName: 'Pedicle screw 6.5 x 45', quantity: 4, distributorKey: 'device' },
      { id: 'i2', referenceCode: 'DEV-ROD-100', productName: 'Rod 100mm', quantity: 2, distributorKey: 'device' },
      { id: 'i3', referenceCode: 'BUF-10', productName: 'Boost Ultrafibres 10cc', quantity: 1, distributorKey: 'device_boost' }
    ]
  }
  const boostPaper = { distributorKey: 'device', supplier: 'Device Technologies', lines: [{ referenceCode: 'BUF-10', description: 'Ultrafibres 10cc', quantity: 1 }] }

  it('files a Boost paper as Boost even when the supplier reads as Device', () => {
    const n = resupplyNaming({ record, resupply: boostPaper, earlierAll: [] })
    expect(n.distributorKey).toBe('device_boost')
    expect(n.fileName).toBe('Testa Boost resupply.pdf')
  })

  it('does not count Device implant resupplies towards Boost', () => {
    const earlierAll = [{ distributorKey: 'device', lines: [{ referenceCode: 'DEV-SCREW-645', quantity: 4 }] }]
    expect(resupplyNaming({ record, resupply: boostPaper, earlierAll }).fileName).toBe('Testa Boost resupply.pdf')
  })

  it('partial, then partial 2, then remaining for Device implants', () => {
    const p1 = { distributorKey: 'device', lines: [{ referenceCode: 'DEV-SCREW-645', description: 'Pedicle screw', quantity: 2 }] }
    expect(resupplyNaming({ record, resupply: p1 }).fileName).toBe('Testa partial Device resupply.pdf')
    const done1 = [{ distributorKey: 'device', lines: p1.lines }]
    const p2 = { distributorKey: 'device', lines: [{ referenceCode: 'DEV-SCREW-645', description: 'Pedicle screw', quantity: 2 }] }
    expect(resupplyNaming({ record, resupply: p2, earlierAll: done1 }).fileName).toBe('Testa partial Device resupply 2.pdf')
    const done2 = [...done1, { distributorKey: 'device', lines: p2.lines }]
    const p3 = { distributorKey: 'device', lines: [{ referenceCode: 'DEV-ROD-100', description: 'Rod', quantity: 2 }] }
    expect(resupplyNaming({ record, resupply: p3, earlierAll: done2 }).fileName).toBe('Testa remaining Device resupply.pdf')
  })

  it('everything back at once is plain', () => {
    const all = { distributorKey: 'device', lines: [
      { referenceCode: 'DEV-SCREW-645', quantity: 4 }, { referenceCode: 'DEV-ROD-100', quantity: 2 }] }
    expect(resupplyNaming({ record, resupply: all }).fileName).toBe('Testa Device resupply.pdf')
  })

  it('a Device paper with nothing to go on follows the usage when it had only one kind', () => {
    const onlyBoost = { ...record, items: [record.items[2]] }
    expect(familyKey({ distributorKey: 'device', lines: [{ referenceCode: 'X1', description: 'graft', quantity: 1 }] }, onlyBoost)).toBe('device_boost')
  })

  it('leaves other suppliers as they are', () => {
    expect(familyKey({ distributorKey: 'signus', lines: [] }, record)).toBe('signus')
  })
})

describe('what the paper is (Brent, 18 Nov 2026: usage forms in the resupply scanner)', async () => {
  const { documentKindOf, documentKindOfPages, normaliseResupply: norm, RESUPPLY_PROMPT: prompt } = await import('./_resupply.js')
  it('keeps only the kinds it knows', () => {
    expect(documentKindOf('Usage')).toBe('usage')
    expect(documentKindOf('docket')).toBe('')
    expect(norm({ documentKind: 'usage' }).documentKind).toBe('usage')
  })
  it('says a kind for several pages only when they agree', () => {
    expect(documentKindOfPages(['resupply', 'resupply', ''])).toBe('resupply')
    expect(documentKindOfPages(['usage', 'resupply'])).toBe('')
    expect(documentKindOfPages(['other', 'usage'])).toBe('usage')
    expect(documentKindOfPages([])).toBe('')
  })
  it('the reader is asked for it', () => {
    expect(prompt).toMatch(/"documentKind"/)
  })
  // Brent, 21 Nov 2026: "E4 use the chargeable form reprint as a resupply document".
  it("never stops E4's reprinted chargeable form as a usage", () => {
    expect(prompt).toMatch(/E4 Surgical send a reprint/)
    const e4 = norm({ documentKind: 'usage', supplier: 'E4 Surgical', lines: [{ referenceCode: 'X1', description: 'Cage' }] })
    expect(e4.distributorKey).toBe('e4')
    expect(e4.documentKind).toBe('resupply')
    expect(norm({ documentKind: 'usage', supplier: 'Signus' }).documentKind).toBe('usage')
  })
})
