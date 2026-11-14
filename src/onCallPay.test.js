import { describe, it, expect } from 'vitest'
import { paidOnCall } from './clinicalPlan/onCall.js'
import { categoriesForStaff } from '../api/_payItems.js'

// Brent, 14 Nov 2026: on-call is paid to Mat, Ben and Aimee only, from the roster.
describe('who is paid on-call', () => {
  it('Mat, Ben and Aimee — not Brent', () => {
    expect(paidOnCall('mat@technomed.com.au')).toBe(true)
    expect(paidOnCall('ben@technomed.com.au')).toBe(true)
    expect(paidOnCall('aimee@technomed.com.au')).toBe(true)
    expect(paidOnCall('brenton@technomed.com.au')).toBe(false)
    expect(paidOnCall('toni@technomed.com.au')).toBe(false)
  })

  it('the on-call pay item is only on their timesheets, and call-in is "Call-in"', () => {
    const rates = [
      { EarningsRateID: 'oc', Name: 'On Call Allowance', RateType: 'RATEPERUNIT', TypeOfUnits: 'Hours' },
      { EarningsRateID: 'ci', Name: 'Call In Allowance', RateType: 'RATEPERUNIT', TypeOfUnits: 'Units' }
    ]
    const ben = categoriesForStaff(rates, 'ben@technomed.com.au', { assignedRateIds: ['oc', 'ci'] })
    expect(ben.map(c => c.key)).toEqual(['call_in', 'on_call'])
    expect(ben.find(c => c.key === 'call_in').label).toBe('Call-in')
    const erin = categoriesForStaff(rates, 'erin@technomed.com.au', { assignedRateIds: ['oc', 'ci'] })
    expect(erin.map(c => c.key)).not.toContain('on_call')
  })
})
