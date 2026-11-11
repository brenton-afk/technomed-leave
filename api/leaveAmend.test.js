import { describe, it, expect, vi, beforeEach } from 'vitest'

// Brent, 11 Nov 2026: "Aimee wants to amend her annual leave application to
// 10.5 hours." Invented application only.
const store = new Map()
vi.mock('./_redis.js', () => ({
  getApplication: vi.fn(async id => (store.has(`leave:${id}`) ? JSON.parse(store.get(`leave:${id}`)) : null)),
  updateApplicationStatus: vi.fn(),
  redisSetBody: vi.fn(async (k, v) => { store.set(k, v) }),
  redis: vi.fn(async cmd => (cmd === 'set' ? 'OK' : 1))
}))
vi.mock('./_auth.js', () => ({ requireAdmin: vi.fn(async () => ({ email: 'brenton@technomed.com.au' })) }))
const amendXeroLeave = vi.fn(async () => ({ leaveApplicationID: 'x1' }))
vi.mock('./_xeroClient.js', () => ({ submitToXero: vi.fn(), amendXeroLeave }))
const updateLeaveEvent = vi.fn(async () => ({ updated: true, eventId: 'ev1', calendarId: 'cal' }))
vi.mock('./_googleCalendar.js', () => ({ addCalendarEvent: vi.fn(), updateLeaveEvent }))
const sendLeaveAmendedEmail = vi.fn(async () => {})
vi.mock('./_email.js', () => ({ sendApprovalEmail: vi.fn(), sendDeclineEmail: vi.fn(), sendLeaveAmendedEmail }))

const res = () => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r }; r.json = b => { r.body = b; return r }; return r }
const APP = { id: 'a1', name: 'Test Person', email: 'test@technomed.com.au', status: 'approved', leaveType: 'ANNUAL_LEAVE',
  startDate: '2026-11-16', endDate: '2026-11-17', returnDate: '2026-11-18', reason: 'Away', xero: { ok: true, id: 'x1' } }

describe('amending leave', () => {
  beforeEach(() => { store.clear(); store.set('leave:a1', JSON.stringify(APP)); vi.clearAllMocks() })

  it('changes approved leave to 10.5 hours — the same Xero leave, the calendar, an email', async () => {
    const { default: handler } = await import('./admin/action.js')
    const r = res()
    await handler({ method: 'POST', body: { id: 'a1', action: 'amend', startDate: '2026-11-16', endDate: '2026-11-17', returnDate: '2026-11-18',
      hours: [{ date: '2026-11-16', hours: 7.6 }, { date: '2026-11-17', hours: 2.9 }] } }, r)
    expect(r.code).toBe(200)
    expect(r.body.application.totalHours).toBe(10.5)
    expect(amendXeroLeave).toHaveBeenCalledWith(expect.objectContaining({ leaveApplicationID: 'x1', hours: [{ date: '2026-11-16', hours: 7.6 }, { date: '2026-11-17', hours: 2.9 }] }))
    expect(updateLeaveEvent).toHaveBeenCalled()
    expect(sendLeaveAmendedEmail).toHaveBeenCalled()
    const saved = JSON.parse(store.get('leave:a1'))
    expect(saved.amendments).toHaveLength(1)
    expect(saved.amendments[0].was.totalHours).toBe(null)
    expect(saved.calendar.eventId).toBe('ev1')
  })

  it('changes pending leave without touching Xero or the calendar', async () => {
    store.set('leave:a1', JSON.stringify({ ...APP, status: 'pending', xero: undefined }))
    const { default: handler } = await import('./admin/action.js')
    const r = res()
    await handler({ method: 'POST', body: { id: 'a1', action: 'amend', startDate: '2026-11-16', endDate: '2026-11-16', returnDate: '2026-11-17',
      hours: [{ date: '2026-11-16', hours: 3 }] } }, r)
    expect(r.code).toBe(200)
    expect(amendXeroLeave).not.toHaveBeenCalled()
    expect(updateLeaveEvent).not.toHaveBeenCalled()
  })

  it('refuses a declined application and nonsense dates', async () => {
    const { default: handler } = await import('./admin/action.js')
    store.set('leave:a1', JSON.stringify({ ...APP, status: 'declined' }))
    let r = res()
    await handler({ method: 'POST', body: { id: 'a1', action: 'amend', startDate: '2026-11-16', endDate: '2026-11-16', returnDate: '2026-11-17', hours: [{ date: '2026-11-16', hours: 3 }] } }, r)
    expect(r.code).toBe(409)
    store.set('leave:a1', JSON.stringify(APP))
    r = res()
    await handler({ method: 'POST', body: { id: 'a1', action: 'amend', startDate: '2026-11-31', endDate: '2026-11-16', returnDate: '2026-11-17', hours: [] } }, r)
    expect(r.code).toBe(400)
  })
})

describe('the amend form lists every weekday', () => {
  it('keeps saved hours and fills the rest at the standard day', async () => {
    const { daysFor } = await import('../src/pages/admin/AmendLeave.jsx')
    expect(daysFor('2026-11-13', '2026-11-16', [{ date: '2026-11-13', hours: 3 }])).toEqual([
      { date: '2026-11-13', hours: 3 }, { date: '2026-11-16', hours: 7.6 }
    ])
  })
})
