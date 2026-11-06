import { describe, it, expect } from 'vitest'
import { findDuplicate, newLines, freeFolderName, itemKey } from './_usageDuplicate.js'

// Invented patient and grafts. The shape of the Matthews double-up of 6 Nov 2026.
const boost = { referenceCode: 'ABT-AB-DT402', productName: 'Boost', lotNumber: 'AB002933-453901', quantity: 1 }
const screw = { referenceCode: 'RF-4535', productName: 'Reform screw', lotNumber: 'L1', quantity: 4 }
const earlier = {
  id: 'a', patientSurname: 'Testa', date: '2026-11-06', repName: 'Mat Usher', createdAt: '2026-11-06T06:56:00Z',
  folderName: 'Testa_06112026_Gupta_PLIF+Fixation+Boost-UF_CLV', items: [boost, screw],
  emailsSent: [{ name: 'Device Technologies Boost Allograft', ok: true }]
}
const rescan = (items, over = {}) => ({
  id: 'b', patientSurname: 'TESTA', date: '2026-11-06', folderName: 'Testa_06112026_Gupta_PLIF+Boost-UF_CLV', items, ...over
})

describe('a scan of a case already filed', () => {
  it('is identical when the same graft number is scanned again', () => {
    const d = findDuplicate(rescan([boost]), [earlier])
    expect(d.kind).toBe('identical')
    expect(d.earlier).toMatchObject({ id: 'a', folderName: earlier.folderName, by: 'Mat Usher' })
    expect(d.earlier.sentTo).toEqual(['Device Technologies Boost Allograft'])
  })

  it('says what is new when the rescan carries something the case did not', () => {
    const extra = { referenceCode: 'ABT-AB-DT402', lotNumber: 'AB002933-453999', quantity: 1 }
    const d = findDuplicate(rescan([boost, extra]), [earlier])
    expect(d.kind).toBe('adds')
    expect(d.added.map(i => i.lotNumber)).toEqual(['AB002933-453999'])
  })

  it('counts quantities, so a fifth screw is new and the first four are not', () => {
    expect(newLines([{ ...screw, quantity: 5 }], [screw])).toEqual([{ ...screw, quantity: 1 }])
  })

  it('reads codes and lots whatever their spacing and case', () => {
    expect(itemKey({ referenceCode: 'abt ab-dt402', lotNumber: 'ab002933 453901' })).toBe(itemKey(boost))
  })

  it('finds a Dropbox folder for the day even with no record of it', () => {
    const d = findDuplicate(rescan([boost]), [], ['Testa_06112026_Gupta_ACDF_CLV'])
    expect(d).toMatchObject({ kind: 'folder', earlier: { folderName: 'Testa_06112026_Gupta_ACDF_CLV' } })
  })

  it('lets a retry of the same save through when only its own folder exists', () => {
    expect(findDuplicate(rescan([boost]), [], ['Testa_06112026_Gupta_PLIF+Boost-UF_CLV'])).toBeNull()
  })

  it('leaves another patient, or another day, alone', () => {
    expect(findDuplicate(rescan([boost], { patientSurname: 'Other' }), [earlier])).toBeNull()
    expect(findDuplicate(rescan([boost], { date: '2026-11-07' }), [earlier])).toBeNull()
  })

  it('never compares a case with itself, so re-saving it is not a duplicate', () => {
    expect(findDuplicate(earlier, [earlier])).toBeNull()
  })
})

describe('a case filed separately on purpose', () => {
  it('never lands in, or overwrites, an existing folder', () => {
    expect(freeFolderName('Testa_06112026_Gupta_PLIF_CLV', ['Testa_06112026_Gupta_PLIF_CLV'])).toBe('Testa_06112026_Gupta_PLIF_CLV_2')
    expect(freeFolderName('X', ['x', 'X_2'])).toBe('X_3')
    expect(freeFolderName('New', ['Old'])).toBe('New')
  })
})
