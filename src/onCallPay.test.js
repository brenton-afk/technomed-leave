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

import { paysCallIns } from './clinicalPlan/onCall.js'

describe('who is paid call-ins', () => {
  it('April, Ben, Mat and Aimee only', () => {
    for (const e of ['april', 'ben', 'mat', 'aimee']) expect(paysCallIns(`${e}@technomed.com.au`)).toBe(true)
    for (const e of ['brenton', 'toni', 'erin', 'jeremy']) expect(paysCallIns(`${e}@technomed.com.au`)).toBe(false)
  })

  it('the call-in pay item is off everyone else\'s timesheet', () => {
    const rates = [{ EarningsRateID: 'ci', Name: 'Call In', RateType: 'RATEPERUNIT', TypeOfUnits: 'Call-ins' }]
    expect(categoriesForStaff(rates, 'toni@technomed.com.au', { assignedRateIds: ['ci'] }).map(c => c.key)).not.toContain('call_in')
    expect(categoriesForStaff(rates, 'april@technomed.com.au', { assignedRateIds: ['ci'] }).map(c => c.key)).toContain('call_in')
  })
})

import { validate } from '../api/_timesheetValidate.js'

// 14 Nov 2026: a Saturday on call is 24h; adding a call-in's worked hours put
// the day over 24 and the timesheet was refused. On-call is not time worked.
describe('on-call hours are not hours worked', () => {
  const cats = [
    { key: 'ordinary', label: 'Ordinary Hours', unit: 'hours' },
    { key: 'on_call', label: 'On-call (roster)', unit: 'hours' },
    { key: 'call_in', label: 'Call-in', unit: 'count' }
  ]
  const days = ['2026-11-07', '2026-11-08']
  it('a 24h on-call Saturday with 4h worked passes, and the hours total leaves on-call out', () => {
    const out = validate({ ordinary: { '2026-11-07': 4 }, on_call: { '2026-11-07': 24, '2026-11-08': 24 }, call_in: { '2026-11-07': 1 } }, cats, days)
    expect(out.ok).toBe(true)
    expect(out.totals.totalHours).toBe(4)
    expect(out.totals.onCallHours).toBe(48)
  })
})
