import { describe, it, expect } from 'vitest'
import { categoriesForStaff } from './_payItems.js'

// Which pay items somebody is offered is now Xero's answer, not a table in the
// code. Each employee's pay template lists the earnings rates they are
// assigned — maintained by whoever runs payroll, in the system that pays
// people. Add a pay item to Ben there and it appears on his timesheet.
//
// The table in src/payOptions.js is what answers when Xero cannot be asked.

const rate = (id, name) => ({ EarningsRateID: id, Name: name })

const RATES = [
  rate('r-ord', 'Ordinary Hours'),
  rate('r-ot', 'Overtime'),
  rate('r-dbl', 'Double Time'),
  rate('r-toil', 'TOIL'),
  rate('r-callin', 'Call In Allowance'),
  rate('r-oncall', 'On Call'),
  rate('r-toni-admin', 'Ordinary Hours Toni Admin'),
  rate('r-toni-sci', 'Ordinary Hours Toni Scientific')
]

const keys = cats => cats.map(c => c.key).sort()

describe('when Xero says what somebody is assigned', () => {
  it('offers exactly those and nothing else, for someone with no confirmed contract', () => {
    const cats = categoriesForStaff(RATES, 'newstarter@technomed.com.au',
      { assignedRateIds: ['r-ord', 'r-dbl'] })
    expect(keys(cats)).toEqual(['ordinary', 'overtime_double'])
  })

  it('for a confirmed contract, the contract decides — on-call need not be on the template (15 Nov 2026)', () => {
    const cats = categoriesForStaff(RATES, 'ben@technomed.com.au', { assignedRateIds: ['r-ord'] })
    expect(keys(cats)).toEqual(['call_in', 'on_call', 'ordinary', 'overtime_double', 'toil_accrued'])
  })

  it('does not offer overtime to somebody whose template has none', () => {
    // The case that matters: a salaried person should not be able to claim it,
    // and the old table gave everybody the same list.
    const cats = categoriesForStaff(RATES, 'jeremy@technomed.com.au',
      { assignedRateIds: ['r-ord'] })
    expect(keys(cats)).toEqual(['ordinary'])
    expect(keys(cats)).not.toContain('overtime_1_5')
  })

  it('Toni gets her split rates from her contract whatever the template says', () => {
    const cats = categoriesForStaff(RATES, 'toni@technomed.com.au', { assignedRateIds: ['r-ord'] })
    expect(keys(cats)).toEqual(expect.arrayContaining(['ordinary_toni_admin', 'ordinary_toni_scientific']))
    expect(keys(cats)).not.toContain('ordinary')
  })
  it('still shows a rate no rule recognises, to the people who have it', () => {
    // A new earnings rate should be visible rather than silently missing.
    const cats = categoriesForStaff([...RATES, rate('r-new', 'Higher Duties')],
      'ben@technomed.com.au', { assignedRateIds: ['r-ord', 'r-new'] })
    expect(cats.map(c => c.xeroName)).toContain('Higher Duties')
  })

  it('does not show that rate to somebody who is not assigned it', () => {
    const cats = categoriesForStaff([...RATES, rate('r-new', 'Higher Duties')],
      'ben@technomed.com.au', { assignedRateIds: ['r-ord'] })
    expect(cats.map(c => c.xeroName)).not.toContain('Higher Duties')
  })
})

describe('when Xero cannot be asked', () => {
  // No pay template, no matching employee, or Xero down. An empty timesheet is
  // a worse answer than a reasonable default — somebody who cannot file their
  // hours on a Sunday night does not care why.
  it('falls back to the table', () => {
    const cats = categoriesForStaff(RATES, 'ben@technomed.com.au', { assignedRateIds: null })
    expect(keys(cats)).toEqual(
      ['call_in', 'on_call', 'ordinary', 'overtime_double', 'toil_accrued'])
  })

  it('falls back when the template came back empty', () => {
    // Empty and absent mean the same thing here: nothing to go on.
    const cats = categoriesForStaff(RATES, 'ben@technomed.com.au', { assignedRateIds: [] })
    expect(cats.length).toBeGreaterThan(0)
  })

  it('still gives Toni her split rates from the table', () => {
    const cats = categoriesForStaff(RATES, 'toni@technomed.com.au', {})
    expect(keys(cats)).toContain('ordinary_toni_admin')
    expect(keys(cats)).toContain('ordinary_toni_scientific')
    expect(keys(cats)).not.toContain('ordinary')
  })
})

// "Yes her Science role can earn TOIL." Toni's TOIL is banked per role in
// Xero, so she claims it per role — fake rate IDs throughout.
describe('TOIL for each of Toni\'s roles', () => {
  const WITH_ROLE_TOIL = [...RATES,
    rate('r-toil-admin', 'TOIL Accrued - Admin'),
    rate('r-toil-sci', 'TOIL Accrued - Science')]

  it('offers Toni a TOIL box for each role when Xero has a rate for each', () => {
    const cats = categoriesForStaff(WITH_ROLE_TOIL, 'toni@technomed.com.au')
    const byKey = Object.fromEntries(cats.map(c => [c.key, c.earningsRateID]))
    expect(byKey.toil_toni_admin).toBe('r-toil-admin')
    expect(byKey.toil_toni_scientific).toBe('r-toil-sci')
  })

  it('still offers her the one TOIL box when Xero has only one', () => {
    const cats = categoriesForStaff(RATES, 'toni@technomed.com.au')
    expect(keys(cats)).toContain('toil_accrued')
    expect(keys(cats)).not.toContain('toil_toni_scientific')
  })

  it('does not put Toni\'s role TOIL on anybody else\'s timesheet', () => {
    const cats = categoriesForStaff(WITH_ROLE_TOIL, 'ben@technomed.com.au')
    expect(keys(cats)).not.toContain('toil_toni_admin')
    expect(cats.map(c => c.earningsRateID)).not.toContain('r-toil-sci')
  })
})

describe('display order (Brent, 15 Nov 2026)', () => {
  it('puts ordinary hours first, then overtime, TOIL, call-ins and on-call', () => {
    const rates = ['Call In Allowance', 'TOIL Accrued', 'On Call Allowance', 'Ordinary Hours', 'Overtime Double Time']
      .map((n, i) => ({ EarningsRateID: `r${i}`, Name: n, RateType: 'RATEPERUNIT', TypeOfUnits: 'Hours' }))
    const keys = categoriesForStaff(rates, 'ben@technomed.com.au', { assignedRateIds: rates.map(r => r.EarningsRateID) }).map(c => c.key)
    expect(keys).toEqual(['ordinary', 'overtime_double', 'toil_accrued', 'call_in', 'on_call'])
  })
})
