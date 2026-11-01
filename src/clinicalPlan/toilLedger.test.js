import { describe, it, expect } from 'vitest'
import { toilBalanceFor, toilLedgerFor, leaveOnDays, toilHoursTaken } from './toil.js'

// ─── Task 15: TOIL in hours, kept in step with timesheets ───────────────────

const EMAIL = 'test@technomed.com.au'
const sheet = (periodStart, periodEnd, toil, status = 'approved') => ({
  email: EMAIL, periodStart, periodEnd, status, entries: { toil_accrued: { [periodStart]: toil } }
})
const toilLeave = (startDate, endDate, hours) => ({
  email: EMAIL, leaveType: 'TOIL', startDate, endDate,
  ...(hours ? { hours, totalHours: hours.reduce((s, d) => s + d.hours, 0) } : {})
})

describe('the acceptance case', () => {
  it('+2h worked as TOIL, then 3.5h taken: the balance moves by both', () => {
    const timesheets = [sheet('2026-10-19', '2026-11-01', 2)]
    const before = toilBalanceFor({ timesheets, leave: { approved: [] }, email: EMAIL })
    expect(before.balance).toBe(2)
    const leave = { approved: [toilLeave('2026-11-04', '2026-11-04', [{ date: '2026-11-04', hours: 3.5 }])] }
    expect(toilBalanceFor({ timesheets, leave, email: EMAIL }).balance).toBe(-1.5)
  })

  it('and the 3.5h shows on that day of the timesheet', () => {
    const leave = { approved: [toilLeave('2026-11-04', '2026-11-04', [{ date: '2026-11-04', hours: 3.5 }])] }
    const days = ['2026-11-02', '2026-11-03', '2026-11-04']
    expect(leaveOnDays({ leave, email: EMAIL, days })).toEqual({ '2026-11-04': { hours: 3.5, types: ['TOIL'] } })
  })
})

describe('the ledger', () => {
  it('opens with the opening balance, then runs in date order with a running total', () => {
    const ledger = toilLedgerFor({
      email: EMAIL,
      opening: { hours: 10, note: 'Xero at 31 Oct', asAt: '2026-10-31' },
      timesheets: [sheet('2026-11-02', '2026-11-15', 4), sheet('2026-11-16', '2026-11-29', 6, 'submitted')],
      leave: { approved: [toilLeave('2026-11-10', '2026-11-10', [{ date: '2026-11-10', hours: 3 }])] }
    })
    expect(ledger.map(l => [l.kind, l.hours, l.balance])).toEqual([
      ['opening', 10, 10], ['taken', -3, 7], ['accrued', 4, 11]
    ])
    expect(ledger[0].note).toBe('Xero at 31 Oct')
  })

  it('counts the opening balance in the balance too', () => {
    expect(toilBalanceFor({ email: EMAIL, opening: { hours: 10 } }).balance).toBe(10)
    expect(toilBalanceFor({ email: EMAIL, opening: 4 }).balance).toBe(4)
  })
})

describe('TOIL taken in hours', () => {
  it('uses the hours stated, so a part day is a part day', () => {
    expect(toilHoursTaken(toilLeave('2026-11-04', '2026-11-04', [{ date: '2026-11-04', hours: 2.5 }]))).toBe(2.5)
  })
  it('falls back to a standard day per weekday for an old application', () => {
    expect(toilHoursTaken(toilLeave('2026-11-02', '2026-11-03'))).toBe(15.2)
  })
})

describe('leave on the timesheet', () => {
  it('shows every approved type, at a standard day where no hours were stated', () => {
    const leave = { approved: [{ email: EMAIL, leaveType: 'ANNUAL_LEAVE', startDate: '2026-11-06', endDate: '2026-11-09' }] }
    const days = ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']
    expect(leaveOnDays({ leave, email: EMAIL, days })).toEqual({
      '2026-11-06': { hours: 7.6, types: ['ANNUAL_LEAVE'] },
      '2026-11-09': { hours: 7.6, types: ['ANNUAL_LEAVE'] }
    })
  })
  it('leaves out somebody else\'s', () => {
    const leave = { approved: [{ email: 'other@technomed.com.au', leaveType: 'TOIL', startDate: '2026-11-06', endDate: '2026-11-06' }] }
    expect(leaveOnDays({ leave, email: EMAIL, days: ['2026-11-06'] })).toEqual({})
  })
})
