import { describe, it, expect } from 'vitest'
import {
  needsPriorImplants, readFiledCase, priorImplantsFor, describePrior
} from './priorImplants.js'

// Real folder names, from the usage the team has been filing for years.
const FILED = [
  'Millward 29.09.26 Ibbett Diplomat PSF CLV',
  'Petrusma 28.09.26 Thani C1-2 CLV',
  'Norman 28.09.26 Thani ALIF CLV',
  'Russell 29.9.26 Thani ACDF CLV',
  'Norman 14.03.24 Dubey Diplomat PLIF RHH'
]
const under = surgeon => `/ALL SURGEON USAGE/SPINE/${surgeon}/SEPTEMBER 2026`

describe('when the history is worth looking up', () => {
  it('notices a booking that asks what is already in', () => {
    for (const procedure of [
      'Removal of existing fusion L4/5',
      'Revision of previous PLIF',
      'R/O C5/6 ACDF plate',
      'Extending the fusion to L2',
      'Adjacent segment disease above previous construct',
      'Has Shoreline in-situ from 29.9.2022'
    ]) {
      expect(needsPriorImplants(procedure), procedure).toBe(true)
    }
  })

  it('leaves an ordinary booking alone', () => {
    // Looking up history on every case would put a warning on all of them, and
    // a warning on everything is a warning on nothing.
    for (const procedure of [
      'L4/5 PLIF', 'C5/6 C6/7 ACDF', 'T10-L2 pedicle fixation for T12 fracture'
    ]) {
      expect(needsPriorImplants(procedure), procedure).toBe(false)
    }
  })
})

describe('reading a filed case', () => {
  it('reads the convention the team files under', () => {
    const one = readFiledCase(FILED[0], under('Ibbett'))
    expect(one.patient).toBe('Millward')
    expect(one.date).toBe('2026-09-29')
    expect(one.surgeon).toBe('Ibbett')
    expect(one.systems).toContain('Diplomat')
    expect(one.hospital).toBe('CLV')
  })

  it('takes a single-digit day or month', () => {
    expect(readFiledCase('Russell 29.9.26 Thani ACDF CLV').date).toBe('2026-09-29')
  })

  it('trusts the folder it was filed under for the surgeon', () => {
    // The tree is filed by surgeon, so the folder above is the reliable answer
    // even where the name does not say.
    expect(readFiledCase('Someone 01.02.24 ACDF RHH', under('Fowler')).surgeon).toBe('Fowler')
  })

  it('keeps the whole name, because the convention is not universal', () => {
    // The words nobody parsed are sometimes the ones that matter.
    expect(readFiledCase(FILED[1]).filedAs).toBe(FILED[1])
  })

  it('reads what it can from a name that breaks the convention', () => {
    const odd = readFiledCase('Hudson removal of Shoreline plate', under('Thani'))
    expect(odd.patient).toBe('Hudson')
    expect(odd.surgeon).toBe('Thani')
    expect(odd.date).toBeNull()
  })

  it('is nothing at all for a name with no surname in it', () => {
    expect(readFiledCase('')).toBeNull()
    expect(readFiledCase('2026 usage')).toBeNull()
  })
})

describe('finding what a patient has in', () => {
  const filed = [
    readFiledCase(FILED[0], under('Ibbett')),
    readFiledCase(FILED[2], under('Thani')),
    readFiledCase(FILED[4], under('Dubey'))
  ]

  it('finds the earlier case, newest first', () => {
    const found = priorImplantsFor(filed, 'Norman', 'Thani')
    expect(found).toHaveLength(2)
    expect(found[0].date).toBe('2026-09-28')
    expect(found[1].date).toBe('2024-03-14')
  })

  it('finds one filed under a different surgeon, and says so', () => {
    // Most patients come back to the same surgeon. The ones who do not are
    // exactly the ones somebody would otherwise miss — a Dubey patient turning
    // up on Thani's list with a Diplomat already in.
    const found = priorImplantsFor(filed, 'Norman', 'Thani')
    const older = found.find(f => f.date === '2024-03-14')
    expect(older.surgeon).toBe('Dubey')
    expect(older.sameSurgeon).toBe(false)
    expect(found[0].sameSurgeon).toBe(true)
  })

  it('says nothing for a patient with no history', () => {
    expect(priorImplantsFor(filed, 'Parsons', 'Thani')).toEqual([])
  })

  it('never claims it is the same patient', () => {
    // A surname is all this app keeps. Two Smiths over a decade in one city is
    // not far-fetched, and "this patient has a Diplomat in situ" said
    // confidently about the wrong one is worse than saying nothing.
    expect(describePrior(priorImplantsFor(filed, 'Norman', 'Thani'), 'Thani'))
      .toMatch(/Check they are the same patient/)
    expect(describePrior(priorImplantsFor(filed, 'Millward', 'Ibbett'), 'Ibbett'))
      .toMatch(/Check it is the same patient/)
  })

  it('counts the ones filed elsewhere', () => {
    expect(describePrior(priorImplantsFor(filed, 'Norman', 'Thani'), 'Thani'))
      .toMatch(/1 of them under another surgeon/)
  })

  it('says nothing when there is nothing', () => {
    expect(describePrior([], 'Thani')).toBeNull()
  })
})
