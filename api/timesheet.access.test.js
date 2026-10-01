import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The server half of the same split. Read as source rather than imported: the
// module pulls in Xero and Redis, and what matters here is purely which gate
// each route is behind.
const SOURCE = readFileSync(join(__dirname, 'timesheet', 'agent.js'), 'utf8')

const gateOf = handler => {
  const start = SOURCE.indexOf(`async function ${handler}(`)
  if (start < 0) return null
  const body = SOURCE.slice(start, SOURCE.indexOf('\nasync function', start + 1))
  if (body.includes('requireTimesheetSubmitter')) return 'submitter'
  if (body.includes('requireTimesheetAccess')) return 'access'
  if (body.includes('requireAdmin')) return 'admin'
  return 'none'
}

describe('which gate each timesheet route is behind', () => {
  it('lets anybody who may open it read their categories and drafts', () => {
    expect(gateOf('handlePayItems')).toBe('access')
    expect(gateOf('handleDraft')).toBe('access')
    expect(gateOf('handleMine')).toBe('access')
    expect(gateOf('handleCallIns')).toBe('access')
  })

  it('keeps submitting to the people payroll expects one from', () => {
    // This is the one that posts to Xero. An admin filling the screen in to
    // check it must not land a draft timesheet in payroll under their name.
    expect(gateOf('handleSubmit')).toBe('submitter')
  })

  it('keeps the pay audit to admins', () => {
    expect(gateOf('handlePayAudit')).toBe('admin')
  })

  it('still posts to Xero from submit, which is why the split exists', () => {
    // If this stops being true the reasoning above needs revisiting rather
    // than the test being deleted.
    const start = SOURCE.indexOf('async function handleSubmit(')
    const body = SOURCE.slice(start, SOURCE.indexOf('\nasync function', start + 1))
    expect(body).toContain('submitTimesheetToXero')
  })

  it('explains itself when somebody cannot submit', () => {
    // A bare 403 on a button you can see is worse than the button being
    // absent. The message says what is off and that the rest works.
    expect(SOURCE).toMatch(/not on fortnightly timesheets/i)
  })
})
