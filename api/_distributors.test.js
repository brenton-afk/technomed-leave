import { describe, it, expect } from 'vitest'
import { CLINICAL_TEAM_CC, ccFor, groupByDistributor } from './_distributors.js'
import { STAFF } from '../src/staffConfig.js'

const CLINICAL = ['brenton', 'ben', 'aimee', 'mat'].map(n => `${n}@technomed.com.au`)
const ADMIN = 'admin@technomed.com.au'

describe('who is copied on a usage email', () => {
  it('is the clinical team and the admin mailbox', () => {
    expect([...CLINICAL_TEAM_CC].sort()).toEqual([...CLINICAL, ADMIN].sort())
  })

  it('takes the staff addresses from the roster, not a second copy of them', () => {
    // It used to be five addresses written out in _distributors.js, which made a
    // clinical rep's email something written down in two places. Correcting it in
    // one would have dropped them off every usage email with nothing failing.
    for (const email of CLINICAL_TEAM_CC) {
      if (email === ADMIN) continue
      const person = STAFF.find(s => s.email === email)
      expect(person, `${email} is copied but is not on the roster`).toBeTruthy()
      expect(person.isClinicalTeam).toBe(true)
    }
  })

  it('copies everyone the roster marks, and nobody it does not', () => {
    const marked = STAFF.filter(s => s.isClinicalTeam).map(s => s.email)
    expect(marked.sort()).toEqual([...CLINICAL].sort())
    for (const person of STAFF) {
      expect(CLINICAL_TEAM_CC.includes(person.email)).toBe(Boolean(person.isClinicalTeam))
    }
  })

  it('does not copy someone on their own email', () => {
    const cc = ccFor('ben@technomed.com.au')
    expect(cc).not.toContain('ben@technomed.com.au')
    expect(cc).toHaveLength(CLINICAL_TEAM_CC.length - 1)
    // Everyone else still gets it, including the admin mailbox.
    expect(cc).toContain(ADMIN)
    expect(cc).toContain('aimee@technomed.com.au')
  })

  it('copes with a sender who is not on the list', () => {
    // Jeremy and April are on the roster but not the clinical team, so a usage
    // email from either copies all five.
    expect(ccFor('jeremy@technomed.com.au')).toHaveLength(CLINICAL_TEAM_CC.length)
  })

  it('matches an address whatever case it arrives in', () => {
    expect(ccFor('Ben@Technomed.com.au')).not.toContain('ben@technomed.com.au')
  })
})

describe('what actually leaves the building', () => {
  // Real keys, taken from DISTRIBUTORS. An invented one is silently held back,
  // so a test using one would pass for the wrong reason.
  const item = (extra = {}) => ({ distributorKey: 'signus', productName: 'Mariner', ...extra })

  it('holds back anything still flagged for review', () => {
    const groups = groupByDistributor([item(), item({ manualReview: true })])
    expect(groups.get('signus')).toHaveLength(1)
  })

  it('holds back anything excluded, or with no distributor resolved', () => {
    const groups = groupByDistributor([
      item({ excluded: true }),
      item({ distributorKey: null }),
      item({ distributorKey: 'NOT_A_DISTRIBUTOR' })
    ])
    expect(groups.size).toBe(0)
  })

  it('never puts one distributor\'s items in another\'s email', () => {
    // The sheet is split even though the scanned form cannot be. This is the
    // guarantee that split is real.
    const groups = groupByDistributor([
      item(),
      item({ distributorKey: 'device', productName: 'Something else' })
    ])
    for (const [key, items] of groups) {
      expect(items.every(i => i.distributorKey === key)).toBe(true)
    }
  })
})
