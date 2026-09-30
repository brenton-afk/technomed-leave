import { describe, it, expect } from 'vitest'
import { PAY_ITEMS, DEFAULT, PAY_OPTIONS, payItemsFor, isReviewed } from './payOptions.js'
import { STAFF } from './staffConfig.js'

// Who is offered which pay item used to be two flags — onlyFor and notFor —
// buried in a list of regular expressions in api/_payItems.js. It worked, and
// it hid the policy in the middle of the matching. Nobody can review it there,
// and the policy is the part that has to be right: a category somebody should
// not see is a wrong payslip, and one they should see and do not is an unpaid
// callout.
//
// Moving it here must not change a single person's entitlement. These pin that.

describe('nobody\'s entitlement changed when this moved', () => {
  // What the old onlyFor/notFor flags produced, written out by hand from the
  // rules as they were before the change.
  const BEFORE = {
    'toni@technomed.com.au': ['ordinary_toni_admin', 'ordinary_toni_scientific',
      'overtime_1_5', 'overtime_double', 'toil_accrued', 'call_in', 'on_call'],
    everyoneElse: ['ordinary', 'overtime_1_5', 'overtime_double',
      'toil_accrued', 'call_in', 'on_call']
  }

  it('gives Toni her split ordinary rates and not the generic one', () => {
    expect([...payItemsFor('toni@technomed.com.au')].sort())
      .toEqual([...BEFORE['toni@technomed.com.au']].sort())
    expect(payItemsFor('toni@technomed.com.au')).not.toContain('ordinary')
  })

  it('gives everybody else exactly what they had', () => {
    for (const person of STAFF.filter(s => s.email !== 'toni@technomed.com.au')) {
      expect([...payItemsFor(person.email)].sort(), person.name)
        .toEqual([...BEFORE.everyoneElse].sort())
    }
  })

  it('keeps the split rates away from everybody but Toni', () => {
    for (const person of STAFF.filter(s => s.email !== 'toni@technomed.com.au')) {
      expect(payItemsFor(person.email), person.name).not.toContain('ordinary_toni_admin')
      expect(payItemsFor(person.email), person.name).not.toContain('ordinary_toni_scientific')
    }
  })

  it('is case-insensitive about an address', () => {
    expect(payItemsFor('Toni@TechnoMed.com.au')).toEqual(payItemsFor('toni@technomed.com.au'))
  })
})

describe('the table itself', () => {
  it('only names pay items the app knows how to show', () => {
    // A typo here would silently drop a category from somebody's timesheet,
    // which looks exactly like not being entitled to it.
    const known = Object.keys(PAY_ITEMS)
    for (const key of DEFAULT) expect(known, `DEFAULT: ${key}`).toContain(key)
    for (const [email, row] of Object.entries(PAY_OPTIONS)) {
      for (const key of row.items) expect(known, `${email}: ${key}`).toContain(key)
    }
  })

  it('only names people on the roster', () => {
    const emails = STAFF.map(s => s.email.toLowerCase())
    for (const email of Object.keys(PAY_OPTIONS)) expect(emails).toContain(email)
  })

  it('gives somebody not in the table the default rather than nothing', () => {
    // A new starter must be able to file a timesheet. An empty list would be a
    // screen that cannot be filled in, with no explanation on it.
    expect(payItemsFor('newstarter@technomed.com.au')).toEqual(DEFAULT)
    expect(payItemsFor('')).toEqual(DEFAULT)
    expect(payItemsFor(undefined)).toEqual(DEFAULT)
  })

  it('is honest about who has actually been checked', () => {
    // `reviewed` means a human confirmed it against a contract. Inheriting the
    // default is not the same as having been checked, and the difference is
    // the whole point of recording it.
    expect(isReviewed('toni@technomed.com.au')).toBe(true)
    expect(isReviewed('ben@technomed.com.au')).toBe(false)
  })
})
