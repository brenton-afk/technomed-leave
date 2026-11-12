import { describe, it, expect, vi, beforeEach } from 'vitest'
import { leaveForPeriod, cleanToilTaken, toilTakenCheck, runsOf, futureDays, earnsToil, typeFromTitle } from '../src/timesheetLeave.js'

// ─── Leave and TOIL taken on the timesheet (Brent, 12 Nov 2026) ──────────────
// Leave is shown on the timesheet and never sent in it; TOIL taken goes to
// Xero as TOIL leave when the timesheet is approved, never over the balance.
// Invented people's hours only.

const DAYS = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 10, 2 + i)); return d.toISOString().slice(0, 10)
})

describe('the rules', () => {
  it('only Ben, Aimee, Mat and Toni take TOIL on a timesheet', () => {
    for (const e of ['ben', 'aimee', 'mat', 'toni']) expect(earnsToil(`${e}@technomed.com.au`), e).toBe(true)
    for (const e of ['erin', 'brenton', 'jeremy']) expect(earnsToil(`${e}@technomed.com.au`), e).toBe(false)
  })

  it('takes the hours from Xero, never from an old portal copy (Toni, 12 Nov 2026)', () => {
    const leave = {
      approved: [
        // Sent to Xero, then removed there: not counted.
        { email: 'toni@technomed.com.au', leaveType: 'SICK', startDate: '2026-11-02', endDate: '2026-11-02', xero: { ok: true, id: 'gone' } },
        // Sent to Xero and still there, but Xero holds 5.5h: Xero's hours.
        { email: 'toni@technomed.com.au', leaveType: 'SICK', startDate: '2026-11-04', endDate: '2026-11-04', xero: { ok: true, id: 'x4' } },
        // Never reached Xero: shown and flagged.
        { email: 'toni@technomed.com.au', leaveType: 'ANNUAL_LEAVE', startDate: '2026-11-05', endDate: '2026-11-05', xero: { ok: false, error: 'refused' } }
      ],
      pending: []
    }
    const xero = [
      { id: 'x2', title: 'Toni Hoppitt', typeName: "Personal/Carer's Leave", start: '2026-11-02', end: '2026-11-02', hours: 5.5 },
      { id: 'x0', title: 'Sick', typeName: "Personal/Carer's Leave", start: '2026-11-02', end: '2026-11-02', hours: 0 },
      { id: 'x4', title: 'Sick', typeName: "Personal/Carer's Leave", start: '2026-11-04', end: '2026-11-04', hours: 5.5 }
    ]
    const out = leaveForPeriod({ leave, xero, xeroRead: true, email: 'toni@technomed.com.au', days: DAYS })
    const personal = out.rows.find(r => r.type === 'SICK')
    expect(personal.byDay).toEqual({ '2026-11-02': 5.5, '2026-11-04': 5.5 })
    expect(personal.inXero).toBe(true)
    // Toni's Thursday is 5.5h, not a standard 7.6.
    expect(out.rows.find(r => r.type === 'ANNUAL_LEAVE')).toMatchObject({ total: 5.5, inXero: false })
    expect(out.notes.join(' ')).toMatch(/no hours/)
    expect(out.notes.join(' ')).toMatch(/no longer in Xero/)
    expect(out.total).toBe(16.5)
  })

  it('spreads Xero hours over the days the person works, and lists pending apart', () => {
    const xero = [
      { id: 'x1', title: 'Aimee - Annual Leave', start: '2026-11-12', end: '2026-11-13', hours: 10.5 }
    ]
    const leave = { approved: [], pending: [{ email: 'aimee@technomed.com.au', leaveType: 'ANNUAL_LEAVE', startDate: '2026-11-10', endDate: '2026-11-10' }] }
    const out = leaveForPeriod({ leave, xero, xeroRead: true, email: 'aimee@technomed.com.au', days: DAYS })
    expect(out.rows[0].byDay).toEqual({ '2026-11-12': 5.25, '2026-11-13': 5.25 })
    expect(out.pending[0]).toMatchObject({ total: 7.6 })
  })

  it('falls back to the portal records only when Xero cannot be read', () => {
    const leave = { approved: [{ email: 'ben@technomed.com.au', leaveType: 'ANNUAL_LEAVE', startDate: '2026-11-03', endDate: '2026-11-03', xero: { ok: true, id: 'x' } }] }
    const out = leaveForPeriod({ leave, xero: [], xeroRead: false, email: 'ben@technomed.com.au', days: DAYS })
    expect(out).toMatchObject({ total: 7.6, source: 'portal' })
  })

  it('cleans the TOIL taken row and splits it into runs of days', () => {
    expect(cleanToilTaken({ '2026-11-03': '2', '2026-11-04': 0, '2027-01-01': 5, '2026-11-05': -1 }, DAYS)).toEqual({ '2026-11-03': 2 })
    expect(runsOf({ '2026-11-03': 2, '2026-11-04': 7.6, '2026-11-06': 1 }).map(r => r.map(d => d.date)))
      .toEqual([['2026-11-03', '2026-11-04'], ['2026-11-06']])
    expect(futureDays({ '2026-11-03': 2, '2026-11-12': 4 }, '2026-11-12')).toEqual({ '2026-11-12': 4 })
    expect(typeFromTitle('Ben - Time off in lieu')).toBe('TOIL')
  })

  it('blocks TOIL over the balance, counting what is already claimed', () => {
    expect(toilTakenCheck({ taken: 8, balance: 10, alreadyClaimed: 0 }).ok).toBe(true)
    const over = toilTakenCheck({ taken: 8, balance: 10, alreadyClaimed: 4 })
    expect(over).toMatchObject({ ok: false, available: 6 })
    expect(over.error).toMatch(/6h of TOIL available/)
    expect(toilTakenCheck({ taken: 1, balance: null }).ok).toBe(false)
  })
})

// ─── Over the wire ───────────────────────────────────────────────────────────

const store = { timesheets: new Map(), leave: new Map(), approved: [], drafts: new Map(), kv: new Map() }
const xeroCalls = { timesheets: [], leave: [] }
let toilBalance = 10
let xeroLeave = []

const key = (email, start) => `${email}|${start}`
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, k, v) => {
    if (cmd === 'get') return store.kv.get(k) ?? null
    if (cmd === 'lpush' && k === 'leave:approved') { store.approved.unshift(v); return 1 }
    return null
  }),
  redisSetBody: vi.fn(async (k, v) => { if (k.startsWith('leave:')) store.leave.set(k.slice(6), JSON.parse(v)); else store.kv.set(k, v) }),
  saveTimesheetDraft: vi.fn(async (email, d) => { store.drafts.set(email, d) }),
  getTimesheetDraft: vi.fn(async email => store.drafts.get(email) || null),
  clearTimesheetDraft: vi.fn(async email => { store.drafts.delete(email) }),
  saveTimesheet: vi.fn(async (kind, r) => { if (kind === 'submitted') store.timesheets.set(key(r.email, r.periodStart), JSON.parse(JSON.stringify(r))) }),
  getTimesheet: vi.fn(async (kind, email, start) => store.timesheets.get(key(email, start)) || null),
  getAllTimesheets: vi.fn(async () => [...store.timesheets.values()]),
  getAllApplications: vi.fn(async () => ({
    pending: [],
    approved: [...store.approved.map(id => store.leave.get(id)), ...[...store.leave.values()].filter(a => a.seeded)].filter(Boolean)
  })),
  getToilOpening: vi.fn(async () => null), setToilOpening: vi.fn()
}))
let who = { email: 'ben@technomed.com.au', name: 'Ben Cassidy' }
vi.mock('./_auth.js', () => ({
  requireSession: vi.fn(async () => who),
  requireAdmin: vi.fn(async () => ({ email: 'erin@technomed.com.au', isAdmin: true }))
}))
const CATS = [
  { key: 'ordinary', label: 'Ordinary Hours', kind: 'ordinary', unit: 'hours', earningsRateID: 'r-ord' },
  { key: 'toil_accrued', label: 'TOIL Accrued', kind: 'toil', unit: 'hours', earningsRateID: 'r-toil' }
]
vi.mock('./_payItems.js', () => ({
  fetchEarningsRates: vi.fn(async () => []), categoriesForStaff: vi.fn(() => CATS), CATEGORY_RULES: [],
  assignedRatesFor: vi.fn(async () => null), unitMismatch: vi.fn(() => null), demoCategories: vi.fn(() => []), isDemo: vi.fn(() => false)
}))
vi.mock('./_timesheetXero.js', () => ({
  submitTimesheetToXero: vi.fn(async args => { xeroCalls.timesheets.push(args); return { timesheetID: 'ts1', status: 'DRAFT' } }),
  approveTimesheetInXero: vi.fn(async () => ({ status: 'APPROVED' }))
}))
vi.mock('./_xeroClient.js', () => ({
  getXeroToken: vi.fn(async () => ({ token: 't', tenantId: 'x' })),
  findEmployee: vi.fn(async () => ({ EmployeeID: 'e1', FirstName: 'Ben', LastName: 'Cassidy' })),
  matchEmployee: vi.fn(), listEmployees: vi.fn(async () => []),
  leaveBalances: vi.fn(async () => ({ toil: { parts: [{ name: 'TOIL', hours: toilBalance }] }, all: [] })),
  overlappingXeroLeave: vi.fn(async () => xeroLeave),
  listLeaveTypes: vi.fn(async () => [{ LeaveTypeID: 'lt-a', Name: 'Annual Leave' }]),
  submitToXero: vi.fn(async args => { xeroCalls.leave.push(args); return { leaveApplicationID: `L${xeroCalls.leave.length}` } })
}))
const calendarSyncs = []
vi.mock('./_googleCalendar.js', () => ({
  getGoogleToken: vi.fn(), getCalendarId: vi.fn(), CALENDAR_SCOPE_READONLY: 'r',
  syncToilCalendar: vi.fn(async args => { calendarSyncs.push(args); return { entries: {}, errors: [] } })
}))
vi.mock('./_email.js', () => ({ sendTimesheetSubmittedEmail: vi.fn(), sendTimesheetDecisionEmail: vi.fn() }))

const { default: handler } = await import('./timesheet/agent.js')
const call = async (action, method, body, query = {}) => {
  const res = { statusCode: 0, payload: null, status(c) { this.statusCode = c; return this }, json(d) { this.payload = d; return this } }
  await handler({ method, query: { action, ...query }, body, headers: {} }, res)
  return res
}

beforeEach(() => {
  store.timesheets.clear(); store.leave.clear(); store.approved.length = 0; store.drafts.clear(); store.kv.clear()
  xeroCalls.timesheets.length = 0; xeroCalls.leave.length = 0; calendarSyncs.length = 0
  toilBalance = 10
  xeroLeave = []
  who = { email: 'ben@technomed.com.au', name: 'Ben Cassidy' }
})

const fortnight = (extra = {}) => ({
  periodStart: '2026-11-02',
  entries: { ordinary: Object.fromEntries(DAYS.filter((d, i) => i % 7 < 5).map(d => [d, 7.6])), ...extra }
})

describe('submitting and approving', () => {
  it('keeps approved leave with the timesheet and never sends it in the Xero timesheet', async () => {
    store.leave.set('a1', { seeded: true, email: 'ben@technomed.com.au', leaveType: 'ANNUAL_LEAVE',
      startDate: '2026-11-05', endDate: '2026-11-06', xero: { ok: true, id: 'x9' } })
    xeroLeave = [{ id: 'x9', title: 'Ben', leaveTypeId: 'lt-a', start: '2026-11-05', end: '2026-11-06', hours: 15.2 }]
    const res = await call('submit', 'POST', fortnight())
    expect(res.statusCode).toBe(200)
    expect(res.payload.record.leave.rows[0]).toMatchObject({ type: 'ANNUAL_LEAVE', total: 15.2 })
    const sent = xeroCalls.timesheets[0]
    expect(Object.keys(sent.entries)).not.toContain('toil_taken')
    expect(JSON.stringify(sent)).not.toMatch(/ANNUAL/)
  })

  it('refuses TOIL taken over the balance', async () => {
    toilBalance = 4
    const res = await call('submit', 'POST', fortnight({ toil_taken: { '2026-11-03': 7.6 } }))
    expect(res.statusCode).toBe(400)
    expect(res.payload.error).toMatch(/4h of TOIL available/)
    expect(xeroCalls.timesheets).toHaveLength(0)
  })

  it('only those who earn TOIL can take it', async () => {
    who = { email: 'erin@technomed.com.au', name: 'Erin Smallbon' }
    const res = await call('submit', 'POST', fortnight({ toil_taken: { '2026-11-03': 99 } }))
    expect(res.statusCode).toBe(200)
    expect(res.payload.record.toilTaken).toEqual({})
  })

  it('sends TOIL taken to Xero as TOIL leave only when the timesheet is approved, once per run of days', async () => {
    const submitted = await call('submit', 'POST', fortnight({ toil_taken: { '2026-11-03': 2, '2026-11-04': 2, '2026-11-10': 3.6 } }))
    expect(submitted.statusCode).toBe(200)
    expect(submitted.payload.record.toilTaken).toEqual({ '2026-11-03': 2, '2026-11-04': 2, '2026-11-10': 3.6 })
    expect(xeroCalls.leave).toHaveLength(0)

    const approved = await call('decide', 'POST', { email: 'ben@technomed.com.au', periodStart: '2026-11-02', decision: 'approve' })
    expect(approved.statusCode).toBe(200)
    expect(xeroCalls.leave.map(l => [l.leaveType, l.startDate, l.endDate, l.hours.map(h => h.hours)])).toEqual([
      ['TOIL', '2026-11-03', '2026-11-04', [2, 2]],
      ['TOIL', '2026-11-10', '2026-11-10', [3.6]]
    ])
    expect(approved.payload.record.toilLeave.ok).toBe(true)
    // Kept as TOIL leave in the portal too, so the balance counts it.
    const kept = [...store.leave.values()].filter(a => a.source === 'timesheet')
    expect(kept.map(a => a.totalHours)).toEqual([4, 3.6])
  })

  it('does not send TOIL when the timesheet is returned', async () => {
    await call('submit', 'POST', fortnight({ toil_taken: { '2026-11-03': 2 } }))
    const returned = await call('decide', 'POST', { email: 'ben@technomed.com.au', periodStart: '2026-11-02', decision: 'reject', reason: 'Wrong day' })
    expect(returned.statusCode).toBe(200)
    expect(xeroCalls.leave).toHaveLength(0)
  })

  it('puts TOIL for today or later on the leave calendar when the draft is saved, not past days', async () => {
    await call('draft', 'POST', { periodStart: '2026-11-02', entries: { toil_taken: { '2026-11-03': 2 } } })
    // 3 Nov is past: nothing written.
    expect(calendarSyncs).toHaveLength(0)
  })
})
