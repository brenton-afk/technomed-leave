import { describe, it, expect } from 'vitest'
import { categoriesForStaff, unitMismatch } from './_payItems.js'

// A Xero timesheet line is always "units". What a unit means is the earnings
// rate's own setup — so entering 1 against a Call-In rate that Xero holds as
// rate-per-unit/Hours records one hour, not one call-in. That is what has been
// happening, and the app was silent about it while displaying a hardcoded
// "$450 per callout" that is also not the rate.

const rate = (id, name, extra = {}) => ({ EarningsRateID: id, Name: name, ...extra })

describe('what Xero says a unit is worth', () => {
  it('shows the real figure instead of one written down in the code', () => {
    const [callIn] = categoriesForStaff(
      [rate('r', 'Call In Allowance', { RatePerUnit: 250, TypeOfUnits: 'Callouts' })],
      'ben@technomed.com.au', { assignedRateIds: ['r'] })
    expect(callIn.hint).toBe('$250 per callout')
    expect(callIn.ratePerUnit).toBe(250)
  })

  it('keeps the cents when there are any', () => {
    const [onCall] = categoriesForStaff(
      [rate('r', 'On Call', { RatePerUnit: 4.5, TypeOfUnits: 'Hours' })],
      'ben@technomed.com.au', { assignedRateIds: ['r'] })
    expect(onCall.hint).toBe('$4.50 per hour')
  })

  it('says nothing rather than guessing when Xero has no figure', () => {
    const [c] = categoriesForStaff([rate('r', 'Call In Allowance')],
      'ben@technomed.com.au', { assignedRateIds: ['r'] })
    expect(c.hint).toBe('')
  })
})

describe('entered in one unit, paid in another', () => {
  const callInPaidHourly = categoriesForStaff(
    [rate('r', 'Call In Allowance', { RatePerUnit: 250, TypeOfUnits: 'Hours' })],
    'ben@technomed.com.au', { assignedRateIds: ['r'] })[0]

  it('catches a call-in that Xero pays by the hour', () => {
    // The reported bug, in one assertion.
    expect(unitMismatch(callInPaidHourly)).toMatch(/one hour rather than one call-in/)
  })

  it('is quiet when the call-in has its own unit', () => {
    const ok = categoriesForStaff(
      [rate('r', 'Call In Allowance', { RatePerUnit: 250, TypeOfUnits: 'Callouts' })],
      'ben@technomed.com.au', { assignedRateIds: ['r'] })[0]
    expect(unitMismatch(ok)).toBe(null)
  })

  it('is quiet about on-call, which really is hours', () => {
    const onCall = categoriesForStaff(
      [rate('r', 'On Call', { RatePerUnit: 4.5, TypeOfUnits: 'Hours' })],
      'ben@technomed.com.au', { assignedRateIds: ['r'] })[0]
    expect(unitMismatch(onCall)).toBe(null)
  })

  it('catches the other direction too', () => {
    const hoursPaidPerThing = categoriesForStaff(
      [rate('r', 'On Call', { RatePerUnit: 50, TypeOfUnits: 'Days' })],
      'ben@technomed.com.au', { assignedRateIds: ['r'] })[0]
    expect(unitMismatch(hoursPaidPerThing)).toMatch(/per day/)
  })

  it('says nothing when Xero did not tell us the unit', () => {
    expect(unitMismatch({ unit: 'count', typeOfUnits: null })).toBe(null)
    expect(unitMismatch(null)).toBe(null)
  })
})
