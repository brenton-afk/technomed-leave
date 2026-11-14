import { describe, it, expect } from 'vitest'
import { comparePerson } from './_payrollCheck.js'
import { STAFF } from '../src/staffConfig.js'

const rate = (id, Name, extra = {}) => ({ EarningsRateID: id, Name, RateType: 'RATEPERUNIT', TypeOfUnits: 'Hours', ...extra })
const RATES = [
  rate('ord', 'Ordinary Hours'), rate('dbl', 'Overtime Double Time'), rate('toil', 'TOIL Accrued'),
  rate('call', 'Call In Allowance', { TypeOfUnits: 'Callouts', RatePerUnit: 250 }), rate('oc', 'On Call Allowance', { RatePerUnit: 4.5 }),
  rate('ot15', 'Overtime 1.5')
]
const ben = STAFF.find(s => s.firstName === 'Ben')

describe('payroll check (read-only, 14 Nov 2026)', () => {
  it('is clear when the template matches the contract', () => {
    const out = comparePerson({ person: ben, rates: RATES, templateIds: ['ord', 'dbl', 'toil', 'call', 'oc'] })
    expect(out.problems).toEqual([])
    expect(out.contract).toMatchObject({ fortnightHours: 76, paidOnCall: true, paidCallIns: true })
  })
  it('says what is missing from the template and what is there but not in the contract', () => {
    const out = comparePerson({ person: ben, rates: RATES, templateIds: ['ord', 'ot15', 'toil', 'call', 'oc'] })
    expect(out.problems.join('\n')).toMatch(/Overtime — Double is in their contract but not on their Xero pay template/)
    expect(out.problems.join('\n')).toMatch(/"Overtime 1.5" is on their Xero template but not in their contract/)
  })
  it('catches a call-in paid by the hour', () => {
    const rates = RATES.map(r => r.EarningsRateID === 'call' ? { ...r, TypeOfUnits: 'Hours' } : r)
    const out = comparePerson({ person: ben, rates, templateIds: ['ord', 'dbl', 'toil', 'call', 'oc'] })
    expect(out.problems.join('\n')).toMatch(/paid by the hour/)
  })
  it('says when there is no template', () => {
    expect(comparePerson({ person: ben, rates: RATES, templateIds: null }).problems[0]).toMatch(/No pay template/)
  })
})
