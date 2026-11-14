import { describe, it, expect } from 'vitest'
import { fortnightBalance, spreadShortfall, contractFor, toilOverflow } from './timesheetRules.js'

// Brent, 14 Nov 2026: any hours a day; on submit, under → offer TOIL taken,
// over → offer to bank as TOIL. Invented hours.
const cats = [{ key: 'ordinary', kind: 'ordinary' }, { key: 'toil_accrued', kind: 'toil' }]
const days = Array.from({ length: 14 }, (_, i) => { const d = new Date('2026-11-02T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10) })

describe('the fortnight against the contract', () => {
  it('reads over, under and exact', () => {
    const c = { fortnightHours: 76 }
    expect(fortnightBalance({ entries: { ordinary: { [days[0]]: 80 } }, categories: cats, contract: c })).toMatchObject({ kind: 'over', hours: 4 })
    expect(fortnightBalance({ entries: { ordinary: { [days[0]]: 70 } }, categories: cats, contract: c, leaveHours: 2 })).toMatchObject({ kind: 'under', hours: 4 })
    expect(fortnightBalance({ entries: { ordinary: { [days[0]]: 72 } }, categories: cats, contract: c, toilTaken: 4 }).kind).toBe('ok')
    expect(fortnightBalance({ entries: {}, categories: cats, contract: null }).kind).toBe('none')
  })

  it('Toni gets a contract from her pattern: 5.5 × 3 days, 33h a fortnight', () => {
    expect(contractFor('toni@technomed.com.au')).toEqual({ fortnightHours: 33, overflowToToil: true })
    expect(contractFor('ben@technomed.com.au').fortnightHours).toBe(76)
    expect(contractFor('erin@technomed.com.au')).toBeNull()
  })

  it('spreads TOIL taken over the days furthest short, earliest first', () => {
    const entries = { ordinary: { [days[0]]: 7.6, [days[1]]: 4, [days[2]]: 7.6 } }
    const add = spreadShortfall({ hours: 5, email: 'ben@technomed.com.au', days, entries, categories: cats })
    expect(add[days[1]]).toBe(3.6)
    expect(add[days[3]]).toBe(1.4)
    expect(Object.values(add).reduce((a, b) => a + b, 0)).toBe(5)
  })

  it('banking stays the default; overflow still moves the extra to TOIL', () => {
    const out = toilOverflow({ entries: { ordinary: { [days[0]]: 80 } }, categories: cats, days, contract: { fortnightHours: 76, overflowToToil: true } })
    expect(out.entries.toil_accrued[days[0]]).toBe(4)
  })
})
