import { describe, it, expect } from 'vitest'

// Ben, 14 Nov 2026: "Earnings Rate … does not exist or is not valid for
// timesheets (400)". A pay item Xero will not take on a timesheet is left off
// the Xero lines, kept on the record, and Xero's error names the pay item.
import { buildTimesheetLines as linesFor, notOnTimesheet, namedXeroError } from './_timesheetXero.js'
import { categoriesForStaff as catsFor } from './_payItems.js'

describe('pay items Xero will not take on a timesheet', () => {
  const days = ['2026-11-02', '2026-11-03']
  const cats = [
    { key: 'ordinary', label: 'Ordinary Hours', earningsRateID: 'r-ord', xeroName: 'Ordinary Hours', timesheetOk: true },
    { key: 'call_in', label: 'Call-In Allowance', earningsRateID: 'r-call', xeroName: 'Call In Allowance', timesheetOk: false }
  ]
  const entries = { ordinary: { '2026-11-02': 7.6 }, call_in: { '2026-11-03': 1 } }

  it('sends only the ones it takes, and lists the rest', () => {
    expect(linesFor(entries, cats, days).map(l => l.EarningsRateID)).toEqual(['r-ord'])
    expect(notOnTimesheet(entries, cats, days)).toEqual([expect.objectContaining({ key: 'call_in', total: 1 })])
  })

  it('names the pay item in Xero\'s error', () => {
    expect(namedXeroError('Earnings Rate r-call does not exist or is not valid for timesheets. (400)', cats))
      .toBe('Earnings Rate "Call In Allowance" does not exist or is not valid for timesheets. (400)')
  })

  it('marks fixed-amount, archived and lump-sum rates as not for timesheets', () => {
    const rates = [
      { EarningsRateID: 'a', Name: 'Ordinary Hours', RateType: 'RATEPERUNIT', TypeOfUnits: 'Hours', EarningsType: 'ORDINARYTIMEEARNINGS' },
      { EarningsRateID: 'b', Name: 'Call In Allowance', RateType: 'FIXEDAMOUNT', EarningsType: 'ALLOWANCE' },
      { EarningsRateID: 'c', Name: 'Overtime 1.5', RateType: 'MULTIPLE', CurrentRecord: false }
    ]
    const out = Object.fromEntries(catsFor(rates, 'x@example.test', { assignedRateIds: ['a', 'b', 'c'] }).map(c => [c.earningsRateID, c.timesheetOk]))
    expect(out).toEqual({ a: true, b: false, c: false })
  })
})
