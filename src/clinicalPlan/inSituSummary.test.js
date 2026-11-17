import { describe, it, expect } from 'vitest'
import { implantKind, implantsLine, priorUsages, inSituAnswer, shortDay } from './inSituSummary.js'

// What is in situ, in one sentence (Brent, 17 Nov 2026). Invented patients only.

const DIPLOMAT_CASE = {
  id: 'u1', patientSurname: 'Testa', date: '2025-03-12', surgeonSurname: 'Thani', hospital: 'CLV',
  folderName: 'Testa_12032025_Thani_Fixation_CLV',
  items: [
    { productName: 'Signus Diplomat polyaxial pedicle screw', size: '6.5 x 45', quantity: 4 },
    { productName: 'Signus Diplomat polyaxial pedicle screw', size: '6.5 x 50', quantity: 2 },
    { productName: 'Signus Diplomat set screw', quantity: 6 },
    { productName: 'Signus Diplomat curved rod', size: '105', quantity: 2 },
    { productName: 'Signus Diplomat cross link', quantity: 1 },
    { productName: 'Boost Ultrafibres 5cc', quantity: 1 }
  ]
}

describe('what is left in a patient', () => {
  it('counts screws, rods and cross links; not set screws or graft', () => {
    expect(implantKind({ productName: 'Diplomat set screw' })).toBeNull()
    expect(implantKind({ productName: 'Boost Ultrafibres' })).toBeNull()
    expect(implantKind({ productName: 'Diplomat cross link' })).toBe('cross link')
    expect(implantsLine(DIPLOMAT_CASE.items)).toBe('Diplomat — 6 screws, 2 rods, 1 cross link')
  })

  it('names a cage and a plate', () => {
    expect(implantsLine([
      { productName: 'E4 Surgical Dakota plate', quantity: 1 },
      { productName: 'E4 Surgical Dakota self-drilling screw', quantity: 4 },
      { productName: 'E4 PEEK cage 6mm', quantity: 1 }
    ])).toMatch(/Dakota.*4 screws, 1 plate, 1 cage/)
  })
})

describe('the earlier usages', () => {
  const records = [
    DIPLOMAT_CASE,
    { ...DIPLOMAT_CASE, id: 'u0', date: '2023-01-05' },
    { ...DIPLOMAT_CASE, id: 'later', date: '2026-12-01' },
    { ...DIPLOMAT_CASE, id: 'gone', date: '2025-06-01', removed: true },
    { ...DIPLOMAT_CASE, id: 'other', patientSurname: 'Rossi' }
  ]
  it('same surname, before the case, not removed, newest first', () => {
    expect(priorUsages(records, { patient: 'testa', before: '2026-11-24' }).map(r => r.id)).toEqual(['u1', 'u0'])
  })
})

describe('the one sentence', () => {
  it('says what the last usage held, where and when — never the patient', () => {
    const a = inSituAnswer({ portal: [DIPLOMAT_CASE] })
    expect(a.status).toBe('found')
    expect(a.sentence).toBe('Last usage (Thani, Calvary, 12 Mar 2025): Diplomat — 6 screws, 2 rods, 1 cross link.')
    expect(a.sentence).not.toMatch(/Testa/)
  })

  it('says how many more there are', () => {
    const a = inSituAnswer({ portal: [DIPLOMAT_CASE, { ...DIPLOMAT_CASE, date: '2023-01-05' }] })
    expect(a.sentence).toMatch(/1 other earlier usage under this surname\.$/)
  })

  it('falls back to a Dropbox folder name', () => {
    const a = inSituAnswer({ dropbox: [{ surgeon: 'Ibbett', hospital: 'CLV', date: '2024-09-29', systems: ['Diplomat'], filedAs: 'x' }], dropboxChecked: true })
    expect(a.sentence).toMatch(/^Last usage in Dropbox \(Ibbett, Calvary, 29 Sep 2024\): Diplomat/)
  })

  it('says "No usage in Dropbox" only when Dropbox was searched', () => {
    expect(inSituAnswer({ dropboxChecked: true })).toMatchObject({ status: 'none', sentence: 'No usage in Dropbox.' })
    expect(inSituAnswer({ dropboxChecked: false }).status).toBe('not-checked')
    expect(inSituAnswer({ dropboxChecked: false }).sentence).toMatch(/Dropbox not searched yet/)
  })

  it('writes the day short', () => {
    expect(shortDay('2025-03-12')).toBe('12 Mar 2025')
  })
})
