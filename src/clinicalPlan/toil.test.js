import { describe, it, expect } from 'vitest'
import {
  toilHoursOn, workingDaysBetween, toilHoursTaken, toilBalanceFor, compareWithXero
} from './toil.js'

// TOIL goes up when somebody works past their hours and down when they take
// the time back. Xero does neither on its own — the accrual arrives as an
// earnings rate on a timesheet, which records hours without touching a leave
// balance — so Brent has been keeping the balance by hand.
//
// The app already held both halves and never put them together.

const sheet = (email, status, hours) => ({
  email, status, entries: { toil_accrued: hours }
})
const leaveApp = (email, startDate, endDate, leaveType = 'TOIL') =>
  ({ email, startDate, endDate, leaveType })

describe('the TOIL on a timesheet', () => {
  it('adds up the hours across the fortnight', () => {
    expect(toilHoursOn(sheet('a@b.c', 'approved', { '2026-10-05': 2, '2026-10-07': 1.5 }))).toBe(3.5)
  })

  it('is nothing when none was claimed', () => {
    expect(toilHoursOn({ email: 'a@b.c', entries: {} })).toBe(0)
    expect(toilHoursOn(null)).toBe(0)
  })

  it('ignores a value that is not a number', () => {
    expect(toilHoursOn(sheet('a@b.c', 'approved', { '2026-10-05': 'two' }))).toBe(0)
  })
})

describe('turning a leave application into hours', () => {
  it('counts working days, not calendar days', () => {
    // Monday to Friday.
    expect(workingDaysBetween('2026-10-05', '2026-10-09')).toBe(5)
  })

  it('does not charge somebody for the weekend in the middle', () => {
    // Friday to the following Monday is two days off, not four.
    expect(workingDaysBetween('2026-10-09', '2026-10-12')).toBe(2)
  })

  it('is one day for a single day', () => {
    expect(workingDaysBetween('2026-10-05', '2026-10-05')).toBe(1)
  })

  it('is nothing for a backwards or unreadable range', () => {
    expect(workingDaysBetween('2026-10-09', '2026-10-05')).toBe(0)
    expect(workingDaysBetween('', '')).toBe(0)
  })

  it('converts at the standard day the timesheet already uses', () => {
    expect(toilHoursTaken(leaveApp('a@b.c', '2026-10-05', '2026-10-06'))).toBe(15.2)
  })

  it('ignores leave that is not TOIL', () => {
    // Annual leave does not come off a TOIL balance.
    expect(toilHoursTaken(leaveApp('a@b.c', '2026-10-05', '2026-10-09', 'ANNUAL_LEAVE'))).toBe(0)
    expect(toilHoursTaken(leaveApp('a@b.c', '2026-10-05', '2026-10-09', 'SICK'))).toBe(0)
  })
})

describe('one person\'s balance', () => {
  const INPUT = {
    email: 'ben@technomed.com.au',
    timesheets: [
      sheet('ben@technomed.com.au', 'approved', { '2026-09-28': 4 }),
      sheet('ben@technomed.com.au', 'approved', { '2026-10-05': 3.5 }),
      sheet('aimee@technomed.com.au', 'approved', { '2026-10-05': 10 })
    ],
    leave: {
      approved: [leaveApp('ben@technomed.com.au', '2026-10-12', '2026-10-12')],
      pending: []
    }
  }

  it('is what was accrued less what was taken', () => {
    const toil = toilBalanceFor(INPUT)
    expect(toil.accrued).toBe(7.5)
    expect(toil.taken).toBe(7.6)
    expect(toil.balance).toBe(-0.1)
  })

  it('does not count somebody else\'s hours', () => {
    expect(toilBalanceFor(INPUT).accrued).not.toBe(17.5)
  })

  it('carries in a balance from before the app', () => {
    expect(toilBalanceFor({ ...INPUT, opening: 20 }).balance).toBe(19.9)
  })

  it('keeps a submitted timesheet out of the balance', () => {
    // A claim, not a fact. Rolling it in would let somebody book time off
    // against hours nobody has agreed to yet.
    const toil = toilBalanceFor({
      ...INPUT,
      timesheets: [...INPUT.timesheets, sheet('ben@technomed.com.au', 'submitted', { '2026-10-19': 6 })]
    })
    expect(toil.accrued).toBe(7.5)
    expect(toil.pending.accrued).toBe(6)
    expect(toil.projected).toBe(5.9)
  })

  it('keeps leave applied for out of it too', () => {
    const toil = toilBalanceFor({
      ...INPUT,
      leave: { ...INPUT.leave, pending: [leaveApp('ben@technomed.com.au', '2026-10-19', '2026-10-20')] }
    })
    expect(toil.taken).toBe(7.6)
    expect(toil.pending.taken).toBe(15.2)
    expect(toil.projected).toBe(-15.3)
  })

  it('does not drift when hours are added up', () => {
    // 7.6 three times is 22.8, and floating point would like it to be
    // 22.799999999999997.
    const toil = toilBalanceFor({
      email: 'x@y.z',
      timesheets: [sheet('x@y.z', 'approved', { a: 7.6, b: 7.6, c: 7.6 })],
      leave: {}
    })
    expect(toil.accrued).toBe(22.8)
  })
})

describe('against what Xero says', () => {
  const ours = { balance: 12 }

  it('agrees when the numbers match', () => {
    expect(compareWithXero(ours, 12).agrees).toBe(true)
  })

  it('names the gap rather than hiding it', () => {
    // Xero's is the number that pays people, so a difference is the manual
    // adjustment not yet made — something to act on, not to correct quietly.
    const out = compareWithXero(ours, 8)
    expect(out.agrees).toBe(false)
    expect(out.difference).toBe(-4)
    expect(out.note).toMatch(/not yet adjusted/)
  })

  it('says which way round it is', () => {
    expect(compareWithXero(ours, 16).note).toMatch(/higher/)
  })

  it('says so when Xero has no balance at all', () => {
    expect(compareWithXero(ours, null).agrees).toBe(null)
    expect(compareWithXero(ours, undefined).note).toMatch(/no TOIL balance/)
  })
})
