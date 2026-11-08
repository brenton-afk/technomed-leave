import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── A case added to a list moves the rest down (Brent, 8 Nov 2026) ──────────
// Boyd, a trauma add-on, booked 1st on Fowler's RHH list where Nettlefold was
// 1st and Chandler 2nd. Invented patients; the shape of the real day.

let day
const updates = []

vi.mock('./_auth.js', () => ({ requireSession: vi.fn(async () => ({ name: 'Brent', email: 'brenton@technomed.com.au' })) }))
vi.mock('./_googleCalendar.js', () => ({
  CALENDAR_SCOPE_READONLY: 'r', CALENDAR_SCOPE_WRITE: 'w', BOOKING_TZ: 'Australia/Hobart',
  getGoogleToken: vi.fn(async () => 'token'),
  getCalendarId: () => 'bookings@example.test',
  serviceAccountEmail: () => 'sa@example.test',
  getCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(async (id, patch) => {
    updates.push({ id, ...patch })
    const e = day.find(x => x.id === id)
    if (e && patch.description) e.description = patch.description
    return e
  }),
  createBookingEvent: vi.fn(), createTaskEvent: vi.fn(), deleteCalendarEvent: vi.fn()
}))
vi.mock('./_redis.js', () => ({}))
vi.mock('./_gmail.js', () => ({}))
vi.mock('./_dropbox.js', () => ({ dropboxConfigured: () => false, searchUsage: vi.fn() }))
vi.mock('./_readBookingDocument.js', () => ({ readBookingDocument: vi.fn() }))
vi.mock('./_readDictatedBooking.js', () => ({ readDictatedBooking: vi.fn() }))
vi.mock('./_voiceCommand.js', () => ({ readVoiceCommand: vi.fn() }))
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: day }) })))

const { makeRoomOnList } = await import('./calendar/today.js')

const booking = (id, patient, list, surgeon = 'Fowler', hospital = 'RHH', hour = 8) => ({
  id, summary: `${patient} REFORM - ${surgeon}`,
  description: `Surgeon: ${surgeon}\nPatient: ${patient}\nDate: 09/11/2026\nHospital: ${hospital}\nProcedure: C5/6 ACDF\nKit: Reform (Consignment)\nList: ${list}`,
  location: hospital,
  start: { dateTime: `2026-11-09T0${hour}:00:00+11:00` }, end: { dateTime: `2026-11-09T0${hour + 1}:00:00+11:00` }
})

beforeEach(() => { updates.length = 0 })

describe('making room on the list', () => {
  it('Boyd booked 1st: Nettlefold becomes 2nd and Chandler 3rd; another surgeon is untouched', async () => {
    day = [
      booking('nettlefold', 'Testone', '1st · morning', 'Fowler', 'RHH', 7),
      booking('chandler', 'Testtwo', '2nd · morning', 'Fowler', 'RHH', 8),
      booking('other', 'Testfour', '1st · morning', 'Thani', 'CLV', 7),
      booking('boyd', 'Testthree', '1st · morning', 'Fowler', 'RHH', 9)
    ]
    const { moved } = await makeRoomOnList('2026-11-09', 'boyd')
    expect(moved).toEqual([{ id: 'nettlefold', position: 2 }, { id: 'chandler', position: 3 }])
    expect(day.find(e => e.id === 'nettlefold').description).toMatch(/List: 2nd · morning/)
    expect(day.find(e => e.id === 'chandler').description).toMatch(/List: 3rd · morning/)
    expect(day.find(e => e.id === 'other').description).toMatch(/List: 1st · morning/)
    expect(updates.map(u => u.id)).not.toContain('other')
  })

  it('does nothing when the place is free', async () => {
    day = [booking('a', 'Testone', '1st · morning'), booking('b', 'Testtwo', '3rd · morning', 'Fowler', 'RHH', 8)]
    expect((await makeRoomOnList('2026-11-09', 'b')).moved).toEqual([])
    expect(updates).toEqual([])
  })
})
