import { describe, it, expect, vi } from 'vitest'

// Brent, 11 Nov 2026: speed. One copy of the week, shared by every phone for
// twenty seconds, dropped the moment the portal writes to the calendar.
let version = '1'
let googleReads = 0
vi.mock('./_auth.js', () => ({ requireSession: vi.fn(async () => ({ email: 'mat@technomed.com.au' })) }))
vi.mock('./_googleCalendar.js', () => ({
  CAL_VERSION_KEY: 'cal:version', CALENDAR_SCOPE_READONLY: 'r', CALENDAR_SCOPE_WRITE: 'w', BOOKING_TZ: 'Australia/Hobart',
  getGoogleToken: vi.fn(async () => 'token'), getCalendarId: () => 'bookings@example.test', serviceAccountEmail: () => 'sa@example.test',
  getCalendarEvent: vi.fn(), updateCalendarEvent: vi.fn(), createBookingEvent: vi.fn(), createTaskEvent: vi.fn(), deleteCalendarEvent: vi.fn()
}))
vi.mock('./_redis.js', () => ({ redis: vi.fn(async cmd => (cmd === 'get' ? version : null)), getWorklist: vi.fn(async () => ({ items: [] })), getProjects: vi.fn(async () => []) }))
vi.mock('./_gmail.js', () => ({}))
vi.mock('./_dropbox.js', () => ({ dropboxConfigured: () => false }))
vi.mock('./_readBookingDocument.js', () => ({ readBookingDocument: vi.fn() }))
vi.mock('./_readDictatedBooking.js', () => ({ readDictatedBooking: vi.fn() }))
vi.mock('./_voiceCommand.js', () => ({ readVoiceCommand: vi.fn() }))
vi.stubGlobal('fetch', vi.fn(async () => { googleReads += 1; return { ok: true, json: async () => ({ items: [{ id: 'e1', summary: 'Case', start: { dateTime: '2026-11-16T08:00:00+11:00' } }] }) } }))
vi.stubEnv('WEEK_SHARE', 'on')

const { default: handler } = await import('./calendar/today.js')
const week = async (extra = {}) => {
  const res = { code: 0, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this }, setHeader() {} }
  await handler({ method: 'GET', query: { action: 'week', start: '2026-11-16', end: '2026-11-24', ...extra }, headers: {} }, res)
  return res.body
}

describe('the shared week', () => {
  it('reads Google once for many phones, again after an edit, and says "unchanged" to a phone that has it', async () => {
    const first = await week()
    const readsAfterFirst = googleReads
    expect(first.events.length).toBeGreaterThan(0)
    await week(); await week()
    expect(googleReads).toBe(readsAfterFirst)
    expect((await week({ seen: first.hash })).unchanged).toBe(true)
    version = '2' // the portal wrote to the calendar
    await week()
    expect(googleReads).toBeGreaterThan(readsAfterFirst)
  })
})
