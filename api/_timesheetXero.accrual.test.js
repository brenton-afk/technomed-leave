import { describe, it, expect } from 'vitest'
import { accrualLinesFor, toilBalanceMismatches } from './_timesheetXero.js'

describe('banked TOIL onto the draft payslip (15 Nov 2026)', () => {
  const ANNUAL = { LeaveTypeID: 'annual', NumberOfUnits: 5.85, AutoCalculate: true }
  it('keeps Xero\'s own accrual lines and adds the TOIL as a positive manual line', () => {
    const { lines, added, already } = accrualLinesFor([ANNUAL], [{ leaveType: 'TOIL', hours: 3.5, leaveTypeID: 'toil' }])
    expect(lines).toEqual([ANNUAL, { LeaveTypeID: 'toil', NumberOfUnits: 3.5, AutoCalculate: false }])
    expect(added).toHaveLength(1)
    expect(already).toEqual([])
  })
  it('never adds a second line where one of that type is already on the payslip', () => {
    const { lines, added, already } = accrualLinesFor([ANNUAL, { LeaveTypeID: 'toil', NumberOfUnits: 3.5, AutoCalculate: false }], [{ leaveType: 'TOIL', hours: 3.5, leaveTypeID: 'toil' }])
    expect(lines.filter(l => l.LeaveTypeID === 'toil')).toHaveLength(1)
    expect(added).toEqual([])
    expect(already[0].onPayslip).toBe(3.5)
  })
  it("Toni's admin and science TOIL are two lines", () => {
    const { lines } = accrualLinesFor([], [{ leaveType: 'TOIL - Admin', hours: 2, leaveTypeID: 'a' }, { leaveType: 'TOIL - Science', hours: 1, leaveTypeID: 's' }])
    expect(lines.map(l => [l.LeaveTypeID, l.NumberOfUnits])).toEqual([['a', 2], ['s', 1]])
  })
  it('flags a balance that is not before + banked − taken', () => {
    const lines = [{ leaveType: 'TOIL', hours: 4, before: 10 }]
    expect(toilBalanceMismatches(lines, { toil: 14 })).toEqual([])
    expect(toilBalanceMismatches(lines, { toil: 12 }, { TOIL: 2 })).toEqual([])
    expect(toilBalanceMismatches(lines, { toil: 10 })).toEqual([{ leaveType: 'TOIL', expected: 14, actual: 10 }])
  })
})
