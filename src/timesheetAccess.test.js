import { describe, it, expect } from 'vitest'
import { mayOpenTimesheets, STAFF, getStaffByEmail } from './staffConfig.js'

// "I need to be able to see timesheets in my log in so I can test it."
//
// Opening the screen and filing a timesheet were the same check, and they are
// not the same question. Payroll expects a fortnightly timesheet from one
// group; the people who need to be able to look at the screen — to check it,
// to sit with somebody stuck on it — are a wider one. Joined together, the
// only way to find a bug in it was to be told about one by whoever hit it at
// nine on a Sunday night.

describe('who may open the timesheet screen', () => {
  it('lets an admin in who is not on timesheets', () => {
    const brent = getStaffByEmail('brenton@technomed.com.au')
    expect(brent.hasTimesheets).toBe(false)
    expect(mayOpenTimesheets(brent)).toBe(true)
  })

  it('lets everybody on timesheets in', () => {
    for (const person of STAFF.filter(s => s.hasTimesheets)) {
      expect(mayOpenTimesheets(person), person.name).toBe(true)
    }
  })

  it('keeps out somebody who is neither', () => {
    // Emma: not on timesheets, not an admin.
    const emma = getStaffByEmail('marketing@technomed.com.au')
    expect(emma.hasTimesheets).toBe(false)
    expect(emma.isAdmin).toBeFalsy()
    expect(mayOpenTimesheets(emma)).toBe(false)
  })

  it('keeps out a stranger', () => {
    expect(mayOpenTimesheets(null)).toBe(false)
    expect(mayOpenTimesheets(undefined)).toBe(false)
    expect(mayOpenTimesheets({})).toBe(false)
  })
})

describe('who may actually file one', () => {
  // Deliberately unchanged, and narrower. Submitting posts to Xero — an admin
  // filling the screen in to see how it behaves must not put a draft timesheet
  // into payroll under their own name, least of all one who has no employee
  // record for it to attach to.
  it('is still only the people payroll expects one from', () => {
    const brent = getStaffByEmail('brenton@technomed.com.au')
    expect(mayOpenTimesheets(brent)).toBe(true)
    expect(brent.hasTimesheets).toBe(false)
  })

  it('has not quietly added anybody to the payroll list', () => {
    // If this changes, somebody starts getting chased for a timesheet on a
    // Saturday morning by the reminder cron.
    expect(STAFF.filter(s => s.hasTimesheets).map(s => s.firstName).sort())
      .toEqual(['Aimee', 'April', 'Ben', 'Erin', 'Jeremy', 'Mat', 'Toni'])
  })
})
