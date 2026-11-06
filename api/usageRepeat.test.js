import { describe, it, expect } from 'vitest'
import { earlierSends } from './_usageRepeat.js'

// Invented patient. The shape of the Matthews double-up of 6 Nov 2026: the
// same form scanned twice, two cases, Boost emailed by both.
const first = {
  id: 'a', patientSurname: 'Testa', date: '2026-11-06', folderName: 'Testa_06112026_Gupta_PLIF+Fixation+Boost-UF_CLV',
  emailsSent: [
    { key: 'device_boost', ok: true, sentAt: '2026-11-06T06:56:31Z', from: 'mat@technomed.com.au' },
    { key: 'e4', ok: true, sentAt: '2026-11-06T06:56:32Z' }
  ]
}
const second = { id: 'b', patientSurname: 'testa ', date: '2026-11-06', folderName: 'Testa_06112026_Gupta_PLIF+Boost-UF_CLV' }

describe('a usage already sent for this patient today', () => {
  it('finds the earlier send to the same distributor from another case', () => {
    const found = earlierSends(second, ['device_boost'], [first, second])
    expect(found.get('device_boost')).toMatchObject({ caseId: 'a', folderName: first.folderName })
  })

  it('says nothing about a distributor that has not had it', () => {
    expect(earlierSends(second, ['signus'], [first]).size).toBe(0)
  })

  it('ignores the case itself, so a retry of its own failed send goes', () => {
    expect(earlierSends(first, ['device_boost'], [first]).size).toBe(0)
  })

  it('ignores another day and another patient', () => {
    expect(earlierSends({ ...second, date: '2026-11-07' }, ['device_boost'], [first]).size).toBe(0)
    expect(earlierSends({ ...second, patientSurname: 'Other' }, ['device_boost'], [first]).size).toBe(0)
  })

  it('ignores a failed send and a test', () => {
    const failed = { ...first, emailsSent: [{ key: 'device_boost', ok: false }, { key: 'e4', ok: true, test: true }] }
    expect(earlierSends(second, ['device_boost', 'e4'], [failed]).size).toBe(0)
  })
})
