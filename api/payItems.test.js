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
  it('offers exactly those and nothing else', () => {
    const cats = categoriesForStaff(RATES, 'ben@technomed.com.au',
      { assignedRateIds: ['r-ord', 'r-oncall'] })
    expect(keys(cats)).toEqual(['on_call', 'ordinary'])
  })

  it('does not offer overtime to somebody whose template has none', () => {
    // The case that matters: a salaried person should not be able to claim it,
    // and the old table gave everybody the same list.
    const cats = categoriesForStaff(RATES, 'jeremy@technomed.com.au',
      { assignedRateIds: ['r-ord'] })
    expect(keys(cats)).toEqual(['ordinary'])
    expect(keys(cats)).not.toContain('overtime_1_5')
  })

  it('overrides the table rather than being merged with it', () => {
    // Toni's row in payOptions.js gives her the split ordinary rates. If Xero
    // says she is on the plain one, Xero wins — the table is a fallback, not a
    // second opinion.
    const cats = categoriesForStaff(RATES, 'toni@technomed.com.au',
      { assignedRateIds: ['r-ord'] })
    expect(keys(cats)).toEqual(['ordinary'])
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
      ['call_in', 'on_call', 'ordinary', 'overtime_1_5', 'overtime_double', 'toil_accrued'])
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
