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
      { EarningsRateID: 'c', Name: 'Overtime Double Time', RateType: 'MULTIPLE', CurrentRecord: false }
    ]
    const out = Object.fromEntries(catsFor(rates, 'ben@technomed.com.au', { assignedRateIds: ['a', 'b', 'c'] }).map(c => [c.earningsRateID, c.timesheetOk]))
    expect(out).toEqual({ a: true, b: false, c: false })
  })
})

import { postDroppingRefused } from './_timesheetXero.js'

describe('a pay item Xero refuses for any reason', () => {
  const cats = [{ key: 'call_in', earningsRateID: 'bdee0ebc-bf8e-4d1b-b513-c36d4dae9bb6', xeroName: 'Call In Allowance' }]
  const lines = [{ EarningsRateID: 'aaaaaaaa-0000-0000-0000-000000000000' }, { EarningsRateID: cats[0].earningsRateID }]

  it('posts again without it and says which was left off', async () => {
    const sent = []
    const post = async ls => {
      sent.push(ls.length)
      if (ls.some(l => l.EarningsRateID === cats[0].earningsRateID)) {
        throw new Error(`Xero timesheet: Earnings Rate ${cats[0].earningsRateID} does not exist or is not valid for timesheets. (400)`)
      }
      return { ok: true }
    }
    const out = await postDroppingRefused(post, lines, cats)
    expect(sent).toEqual([2, 1])
    expect(out.refused).toEqual([cats[0].earningsRateID])
  })

  it('never drops the last line, and names the item when it gives up', async () => {
    const post = async () => { throw new Error(`Earnings Rate ${cats[0].earningsRateID} does not exist or is not valid for timesheets. (400)`) }
    await expect(postDroppingRefused(post, [lines[1]], cats)).rejects.toThrow(/"Call In Allowance"/)
  })
})
