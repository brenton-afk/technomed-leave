import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildTimesheetPayload, buildTimesheetLines, unitsForCategory } from './_timesheetXero.js'
import { readFileSync } from 'fs'
import { join } from 'path'

// A staff member's first real timesheet came back with:
//
//   Cannot deserialize the current JSON object into type
//   UpdateTimesheetRequest because the type requires a JSON array.
//   Path 'Timesheets', line 1, position 14. (400)
//
// Position 14 is exactly where `{"Timesheets":` ends. Xero's AU payroll
// endpoints take the collection at the root of the body; we were wrapping it.
//
// The shape of a request body is not something a unit test can hold on its
// own, so this reads the source — the same approach as the readXero guard
// next door, and for the same reason: it is the only place the fact lives.

const SOURCE = readFileSync(join(__dirname, '_timesheetXero.js'), 'utf8')

describe('the body Xero is posted', () => {
  it('is a bare array, not an object with a Timesheets key', () => {
    expect(SOURCE).toMatch(/body:\s*JSON\.stringify\(\[payload\]\)/)
    expect(SOURCE).not.toMatch(/JSON\.stringify\(\{\s*Timesheets:/)
  })

  it('accepts either shape coming back', () => {
    // The request takes a bare array and the response comes back wrapped,
    // which is the asymmetry that made this easy to get wrong.
    expect(SOURCE).toMatch(/Array\.isArray\(data\)\s*\?\s*data\[0\]/)
  })
})

describe('what goes in a timesheet line', () => {
  const days = ['2026-09-21', '2026-09-22', '2026-09-23']

  it('lays the hours out in day order', () => {
    expect(unitsForCategory({ '2026-09-21': 7.6, '2026-09-23': 4 }, days))
      .toEqual([7.6, 0, 4])
  })

  it('puts a zero where nothing was claimed', () => {
    expect(unitsForCategory({}, days)).toEqual([0, 0, 0])
    expect(unitsForCategory(undefined, days)).toEqual([0, 0, 0])
  })

  it('leaves out a category with nothing against it', () => {
    // An empty line is noise in a pay run.
    const categories = [
      { key: 'ordinary', earningsRateID: 'r-ord' },
      { key: 'on_call', earningsRateID: 'r-oncall' }
    ]
    const lines = buildTimesheetLines({ ordinary: { '2026-09-21': 7.6 } }, categories, days)
    expect(lines).toHaveLength(1)
    expect(lines[0].EarningsRateID).toBe('r-ord')
  })
})

describe('the timesheet itself', () => {
  it('carries the employee, the dates and the lines', () => {
    const payload = buildTimesheetPayload({
      employeeID: 'emp-1', start: '2026-09-21', end: '2026-10-04',
      lines: [{ EarningsRateID: 'r', NumberOfUnits: [1] }], status: 'DRAFT'
    })
    expect(payload.EmployeeID).toBe('emp-1')
    expect(payload.Status).toBe('DRAFT')
    expect(payload.TimesheetLines).toHaveLength(1)
  })

  it('only carries an ID when it is updating one', () => {
    // Including the ID turns the same POST into an update, which is how an
    // approval moves a submitted timesheet to APPROVED.
    const fresh = buildTimesheetPayload({ employeeID: 'e', start: '2026-09-21', end: '2026-10-04', lines: [] })
    expect(fresh.TimesheetID).toBeUndefined()
    const update = buildTimesheetPayload({
      employeeID: 'e', timesheetID: 'ts-1', start: '2026-09-21', end: '2026-10-04', lines: []
    })
    expect(update.TimesheetID).toBe('ts-1')
  })
})
