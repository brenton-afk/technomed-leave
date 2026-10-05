import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { classifyLeave } from './_xeroClient.js'

// ─── Leave balances, read from the system that pays people ──────────────────
// "Link the leave balance hours from Xero so they display in the portal so
// Erin can see that the staff member has leave. Include sick leave, annual
// leave and TOIL balances."
//
// Read, never recomputed. Xero is what pays people, and a second opinion on a
// leave balance is worse than none: it invites somebody to approve against the
// wrong one.
//
// Xero keeps these as a free list of whatever leave types payroll has set up,
// so they are sorted by name. That is the fragile part and the part worth
// testing — a type renamed in payroll must not silently vanish from a screen
// leave is approved from.

describe('classifyLeave', () => {
  it('finds annual leave however it is named', () => {
    for (const name of ['Annual Leave', 'annual leave', 'Holiday Leave', 'ANNUAL']) {
      expect(classifyLeave(name), name).toBe('annual')
    }
  })

  it('treats personal, carer\'s and sick leave as one thing', () => {
    // Xero's standard type is "Personal/Carer's Leave"; everybody here calls
    // it sick leave. Both have to land in the same bucket or the portal shows
    // an empty sick balance beside a full one under another name.
    for (const name of ['Personal/Carer\'s Leave', 'Sick Leave', 'Personal Leave', 'Carers Leave']) {
      expect(classifyLeave(name), name).toBe('sick')
    }
  })

  it('finds TOIL however it is named', () => {
    for (const name of ['TOIL', 'Time Off In Lieu', 'toil accrued', 'Lieu Time']) {
      expect(classifyLeave(name), name).toBe('toil')
    }
  })

  it('does not force an unknown type into one of the three', () => {
    // Long service, parental, unpaid. Guessing would put a long service
    // balance on screen as annual leave, which is worse than not showing it.
    for (const name of ['Long Service Leave', 'Parental Leave', 'Unpaid Leave', '']) {
      expect(classifyLeave(name), name).toBe('other')
    }
  })
})

describe('leaveBalances', () => {
  const employee = lines => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ Employees: [{ EmployeeID: 'e1', LeaveBalances: lines }] })
  })

  beforeEach(() => {
    vi.resetModules()
    global.fetch = vi.fn(async () => employee([
      { LeaveName: 'Annual Leave', NumberOfUnits: 76.5, TypeOfUnits: 'Hours' },
      { LeaveName: 'Personal/Carer\'s Leave', NumberOfUnits: 38, TypeOfUnits: 'Hours' },
      { LeaveName: 'TOIL', NumberOfUnits: 12.4, TypeOfUnits: 'Hours' },
      { LeaveName: 'Long Service Leave', NumberOfUnits: 4, TypeOfUnits: 'Hours' }
    ]))
  })
  afterEach(() => vi.restoreAllMocks())

  it('returns the three the portal asks for, named', async () => {
    const { leaveBalances } = await import('./_xeroClient.js')
    const got = await leaveBalances('tok', 'tenant', 'e1')
    expect(got.annual.hours).toBe(76.5)
    expect(got.sick.hours).toBe(38)
    expect(got.toil.hours).toBe(12.4)
  })

  it('keeps a type nobody asked for rather than dropping it', async () => {
    // A balance nobody expected is still a balance, and hiding one silently
    // is how a screen comes to disagree with payroll.
    const { leaveBalances } = await import('./_xeroClient.js')
    const got = await leaveBalances('tok', 'tenant', 'e1')
    expect(got.other.map(b => b.name)).toEqual(['Long Service Leave'])
    expect(got.all).toHaveLength(4)
  })

  it('carries the unit, so a type set up in days is not read as hours', async () => {
    global.fetch = vi.fn(async () => employee([
      { LeaveName: 'Annual Leave', NumberOfUnits: 10, TypeOfUnits: 'Days' }
    ]))
    const { leaveBalances } = await import('./_xeroClient.js')
    const got = await leaveBalances('tok', 'tenant', 'e1')
    expect(got.annual).toMatchObject({ hours: 10, units: 'Days' })
  })

  it('says null for a balance Xero does not hold', async () => {
    global.fetch = vi.fn(async () => employee([
      { LeaveName: 'Annual Leave', NumberOfUnits: 8, TypeOfUnits: 'Hours' }
    ]))
    const { leaveBalances } = await import('./_xeroClient.js')
    const got = await leaveBalances('tok', 'tenant', 'e1')
    expect(got.sick).toBeNull()
    expect(got.toil).toBeNull()
  })

  it('distinguishes an unreadable employee from one with no leave', async () => {
    // Null, not an empty set. "Could not be read" and "has nothing" must not
    // look the same on a screen somebody approves leave from.
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200, text: async () => JSON.stringify({ Employees: [] })
    }))
    const { leaveBalances } = await import('./_xeroClient.js')
    expect(await leaveBalances('tok', 'tenant', 'missing')).toBeNull()
  })

  it('keeps TOIL meaning the same thing as it does on the timesheet', async () => {
    // toilBalanceInXero used to classify TOIL with its own regex. Two
    // definitions of one number is how a figure comes to differ between two
    // screens in the same app.
    const { leaveBalances, toilBalanceInXero } = await import('./_xeroClient.js')
    const [all, toil] = await Promise.all([
      leaveBalances('tok', 'tenant', 'e1'),
      toilBalanceInXero('tok', 'tenant', 'e1')
    ])
    expect(toil).toBe(all.toil.hours)
  })
})
