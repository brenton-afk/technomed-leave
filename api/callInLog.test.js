import { describe, it, expect, vi, beforeEach } from 'vitest'

// Call-ins logged on the timesheet draft (Brent, 7 Nov 2026). Invented data.

let draft = null
let filed = []
vi.mock('./_redis.js', () => ({
  saveTimesheetDraft: vi.fn(async (email, d) => { draft = structuredClone(d) }),
  getTimesheetDraft: vi.fn(async () => (draft ? structuredClone(draft) : null)),
  clearTimesheetDraft: vi.fn(), saveTimesheet: vi.fn(), getTimesheet: vi.fn(),
  getAllTimesheets: vi.fn(async () => filed), getAllApplications: vi.fn(), getToilOpening: vi.fn(), setToilOpening: vi.fn()
}))
vi.mock('./_auth.js', () => ({ requireSession: vi.fn(), requireAdmin: vi.fn() }))
vi.mock('./_googleCalendar.js', () => ({ getGoogleToken: vi.fn(), getCalendarId: vi.fn(), CALENDAR_SCOPE_READONLY: 'r' }))
vi.mock('./_email.js', () => ({ sendTimesheetSubmittedEmail: vi.fn(), sendTimesheetDecisionEmail: vi.fn() }))

const { logCallIns, paidCallIns, withRosterOnCall } = await import('./timesheet/agent.js')
const MAT = { email: 'mat@technomed.com.au', name: 'Mat Usher', hasTimesheets: true }
const PERIOD = { start: '2026-10-26', end: '2026-11-08' }
const WHITE = { id: 'evt-1', day: '2026-11-07', title: 'Testa', time: '08:00', auto: true }

beforeEach(() => { draft = null; filed = [] })

describe('logging a call-in', () => {
  it('puts one call-in on the day, in the draft', async () => {
    const logged = await logCallIns(MAT, PERIOD, [WHITE])
    expect(logged.map(l => l.id)).toEqual(['evt-1'])
    expect(draft.entries.call_in['2026-11-07']).toBe(1)
    expect(draft.autoCallIns).toEqual(['evt-1'])
  })

  it('logs it once, even if it was taken off afterwards', async () => {
    await logCallIns(MAT, PERIOD, [WHITE])
    draft.entries.call_in['2026-11-07'] = 0
    expect(await logCallIns(MAT, PERIOD, [WHITE])).toEqual([])
    expect(draft.entries.call_in['2026-11-07']).toBe(0)
  })

  it('keeps what is already in the draft', async () => {
    draft = { periodStart: PERIOD.start, entries: { ordinary: { '2026-11-02': 7.6 } } }
    await logCallIns(MAT, PERIOD, [WHITE])
    expect(draft.entries.ordinary['2026-11-02']).toBe(7.6)
  })

  it('never touches a fortnight already filed', async () => {
    filed = [{ email: MAT.email, periodStart: PERIOD.start, status: 'submitted' }]
    expect(await logCallIns(MAT, PERIOD, [WHITE])).toEqual([])
    expect(draft).toBeNull()
  })
})

describe('who is paid call-ins', () => {
  it('is nobody off timesheets — Brent, as a director, attends but is not paid them', async () => {
    const { STAFF } = await import('../src/staffConfig.js')
    const brent = STAFF.find(p => p.firstName === 'Brent')
    const mat = STAFF.find(p => p.firstName === 'Mat')
    expect(paidCallIns(brent)).toBe(false)
    expect(paidCallIns(mat)).toBe(true)
    expect(await logCallIns(brent, PERIOD, [WHITE])).toEqual([])
    expect(draft).toBeNull()
  })
})


// Brent, 14 Nov 2026: on-call hours are the roster's, never typed, and only
// Mat, Ben and Aimee are paid them.
describe('on-call hours on submit', () => {
  const period = { start: '2026-11-02', end: '2026-11-15', days: Array.from({ length: 14 }, (_, i) => `2026-11-${String(2 + i).padStart(2, '0')}`) }
  const roster = async () => ({ onCallEntries: [{ title: 'On call - Ben', date: '2026-11-06' }] })

  it('replaces what was typed with the roster for Ben', async () => {
    const out = await withRosterOnCall({ ordinary: { '2026-11-03': 7.6 }, on_call: { '2026-11-04': 99 } },
      { email: 'ben@technomed.com.au', firstName: 'Ben' }, period, roster)
    expect(out.entries.on_call['2026-11-04']).toBeUndefined()
    expect(Object.values(out.entries.on_call).reduce((a, b) => a + b, 0)).toBe(62)
    expect(out.entries.ordinary).toEqual({ '2026-11-03': 7.6 })
  })

  it('empties it for someone not paid on-call', async () => {
    const out = await withRosterOnCall({ on_call: { '2026-11-07': 24 } }, { email: 'brenton@technomed.com.au', firstName: 'Brent' }, period, roster)
    expect(out.entries.on_call).toBeUndefined()
  })

  it('leaves it empty with a warning when the roster cannot be read', async () => {
    const out = await withRosterOnCall({}, { email: 'ben@technomed.com.au', firstName: 'Ben' }, period, async () => { throw new Error('down') })
    expect(out.entries.on_call).toBeUndefined()
    expect(out.warning).toMatch(/roster/)
  })
})
