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

const { logCallIns } = await import('./timesheet/agent.js')
const MAT = { email: 'mat@technomed.com.au', name: 'Mat Usher' }
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
