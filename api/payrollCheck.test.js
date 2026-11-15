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

describe('payroll check (read-only, 14 Nov 2026; tidy templates 15 Nov)', () => {
  it('is clear when the template carries only ordinary hours', () => {
    const out = comparePerson({ person: ben, rates: RATES, templateIds: ['ord'] })
    expect(out.problems).toEqual([])
    expect(out.willSee).toEqual(expect.arrayContaining(['Ordinary Hours', 'Call-in', 'On-call (roster)']))
    expect(out.contract).toMatchObject({ fortnightHours: 76, paidOnCall: true, paidCallIns: true })
  })
  it('says to take on-call, call-ins and commission off the template', () => {
    const rates = [...RATES, rate('comm', 'Commissions Spine', { TypeOfUnits: 'Sales Dollars' })]
    const out = comparePerson({ person: ben, rates, templateIds: ['ord', 'oc', 'call', 'comm'] }).problems.join('\n')
    expect(out).toMatch(/On Call Allowance" is on their pay template — remove it.*whether or not they were on call/)
    expect(out).toMatch(/Call In Allowance" is on their pay template — remove it/)
    expect(out).toMatch(/Commissions Spine" is on their pay template — it belongs only in the monthly commission pay run/)
  })
  it('wants ordinary hours on the template', () => {
    expect(comparePerson({ person: ben, rates: RATES, templateIds: ['toil'] }).problems.join('\n')).toMatch(/Ordinary Hours is not on their Xero pay template/)
  })
  it('catches a call-in paid by the hour', () => {
    const rates = RATES.map(r => r.EarningsRateID === 'call' ? { ...r, TypeOfUnits: 'Hours' } : r)
    expect(comparePerson({ person: ben, rates, templateIds: ['ord'] }).problems.join('\n')).toMatch(/paid by the hour/)
  })
  it('says when there is no template', () => {
    expect(comparePerson({ person: ben, rates: RATES, templateIds: null }).problems[0]).toMatch(/No pay template/)
  })
})
