import { describe, it, expect } from 'vitest'
import { toilOverflow, contractFor } from './timesheetRules.js'
import { validate } from '../api/_timesheetValidate.js'

// "Allow staff to just enter the hours they worked… For Aimee, Ben and Mat
// they are full time at 76 hours so anything over this should automatically
// accrue as TOIL unless they enter it as Overtime (double time)."

const DAYS = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 10, 2 + i)); return d.toISOString().slice(0, 10)
})
const CATS = [
  { key: 'ordinary', kind: 'ordinary', unit: 'hours', label: 'Ordinary Hours' },
  { key: 'overtime_double', kind: 'overtime', unit: 'hours', label: 'Overtime — Double' },
  { key: 'toil_accrued', kind: 'toil', unit: 'hours', label: 'TOIL Accrued' },
  { key: 'call_in', kind: 'allowance', unit: 'count', label: 'Call-In Allowance' }
]
const weekdays = DAYS.filter(d => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()))
const ordinary = hoursPerDay => ({ ordinary: Object.fromEntries(weekdays.map(d => [d, hoursPerDay])) })
const FULL = contractFor('ben@technomed.com.au')

describe('who is on a 76-hour fortnight', () => {
  it('is Aimee, Ben and Mat', () => {
    for (const e of ['aimee@technomed.com.au', 'ben@technomed.com.au', 'mat@technomed.com.au']) {
      expect(contractFor(e), e).toMatchObject({ fortnightHours: 76, overflowToToil: true })
    }
    expect(contractFor('erin@technomed.com.au')).toBeNull()
  })
})

describe('hours over 76', () => {
  it('are banked as TOIL, taken from the end of the fortnight', () => {
    const out = toilOverflow({ entries: ordinary(8), categories: CATS, days: DAYS, contract: FULL })
    expect(out.excess).toBe(4)
    const ord = Object.values(out.entries.ordinary).reduce((a, b) => a + b, 0)
    expect(ord).toBe(76)
    expect(out.entries.toil_accrued).toEqual({ [weekdays[9]]: 4 })
  })

  it('leave in the fortnight counts towards the 76', () => {
    const entries = { ordinary: Object.fromEntries(weekdays.slice(0, 9).map(d => [d, 8])) }
    const out = toilOverflow({ entries, categories: CATS, days: DAYS, contract: FULL, leaveHours: 7.6 })
    expect(out.limit).toBe(68.4)
    expect(out.excess).toBe(3.6)
  })

  it('leave double time where it was entered', () => {
    const entries = { ...ordinary(7.6), overtime_double: { [weekdays[2]]: 3 } }
    const out = toilOverflow({ entries, categories: CATS, days: DAYS, contract: FULL })
    expect(out.excess).toBe(0)
    expect(out.entries).toEqual(entries)
  })

  it('do nothing for someone without a full-time contract — Erin enters 8-hour days', () => {
    const out = toilOverflow({ entries: ordinary(8), categories: CATS, days: DAYS, contract: null })
    expect(out.entries).toEqual(ordinary(8))
  })

  it('are said, not moved, when there is no TOIL pay item', () => {
    const out = toilOverflow({ entries: ordinary(8), categories: CATS.filter(c => c.kind !== 'toil'), days: DAYS, contract: FULL })
    expect(out.excess).toBe(4)
    expect(out.toilKey).toBeNull()
    expect(out.entries).toEqual(ordinary(8))
  })

  it('apply once — submitting the split again changes nothing', () => {
    const once = toilOverflow({ entries: ordinary(8), categories: CATS, days: DAYS, contract: FULL })
    const twice = toilOverflow({ entries: once.entries, categories: CATS, days: DAYS, contract: FULL })
    expect(twice.entries).toEqual(once.entries)
  })
})

describe('no standard-day flag', () => {
  it('lets an 8-hour day through without a warning', () => {
    const check = validate(ordinary(8), CATS, DAYS)
    expect(check.ok).toBe(true)
    expect(check.warnings).toEqual([])
  })

  it('counts a call-in as one call-in, not an hour', () => {
    const check = validate({ ...ordinary(7.6), call_in: { [weekdays[0]]: 1 } }, CATS, DAYS)
    expect(check.totals.callouts).toBe(1)
    expect(check.totals.totalHours).toBe(76)
  })
})
