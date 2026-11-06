import { describe, it, expect, vi, beforeEach } from 'vitest'
import { movedOnCalendar, levelsIn } from '../src/clinicalPlan/bookingSources.js'

// ─── Task 5: a moved booking moves, and is never copied ──────────────────────
// "The portal did not recognise that a booking that moved needed to move
// places in the calendar." An email saying a case is now on Thursday was
// checked against Thursday only, offered as new, and accepting it made a second
// event while the first stayed put. Fake names throughout.

let events
let candidate
let patches
let creates

vi.mock('./_auth.js', () => ({
  requireSession: vi.fn(async () => ({ name: 'Toni Test', email: 'toni@technomed.com.au' }))
}))
vi.mock('./_googleCalendar.js', () => ({
  CALENDAR_SCOPE_READONLY: 'r', CALENDAR_SCOPE_WRITE: 'w', BOOKING_TZ: 'Australia/Hobart',
  getGoogleToken: vi.fn(async () => 'token'),
  getCalendarId: () => 'bookings@example.test',
  serviceAccountEmail: () => 'sa@example.test',
  getCalendarEvent: vi.fn(async id => events.get(id)),
  updateCalendarEvent: vi.fn(async (id, patch) => {
    patches.push({ id, patch })
    const was = events.get(id)
    // Google stores the naive time in the zone and answers with an offset.
    const withOffset = t => t && ({ dateTime: `${t.dateTime}+11:00`, timeZone: t.timeZone })
    const next = {
      ...was, ...patch, etag: '"v2"',
      start: patch.start ? withOffset(patch.start) : was.start,
      end: patch.end ? withOffset(patch.end) : was.end
    }
    events.set(id, next)
    return next
  }),
  createBookingEvent: vi.fn(async body => { creates.push(body); return { id: 'new', ...body } }),
  createTaskEvent: vi.fn(), deleteCalendarEvent: vi.fn()
}))
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async () => 'OK'), redisSetBody: vi.fn(),
  getBookingCandidate: vi.fn(async () => candidate),
  updateBookingCandidate: vi.fn(async (id, up) => ({ ...candidate, ...up }))
}))
vi.mock('./_gmail.js', () => ({}))
vi.mock('./_dropbox.js', () => ({ dropboxConfigured: () => false, searchUsage: vi.fn() }))
vi.mock('./_readBookingDocument.js', () => ({ readBookingDocument: vi.fn() }))
vi.mock('./_readDictatedBooking.js', () => ({ readDictatedBooking: vi.fn() }))
vi.mock('./_voiceCommand.js', () => ({ readVoiceCommand: vi.fn() }))

// The calendar as a day-tidy sees it: whatever events are on that day.
vi.stubGlobal('fetch', vi.fn(async url => {
  const day = decodeURIComponent(String(url)).match(/timeMin=(\d{4}-\d{2}-\d{2})/)?.[1]
  const items = [...events.values()].filter(e => (e.start?.dateTime || '').startsWith(day))
  return { ok: true, json: async () => ({ items }) }
}))

const { default: handler } = await import('./calendar/today.js')

async function call(action, body) {
  const res = {
    statusCode: 0, payload: null,
    status(code) { this.statusCode = code; return this },
    json(data) { this.payload = data; return this },
    setHeader() {}, end() { return this }
  }
  await handler({ method: 'POST', query: { action }, headers: {}, body }, res)
  return res
}

beforeEach(() => {
  patches = []
  creates = []
  events = new Map([['evt-1', {
    id: 'evt-1', etag: '"v1"',
    summary: 'Testa CYLOX - Ibbett',
    description: 'Surg - Dr Ibbett\nPt - Testa\nDate - 04/11/2026\nProcedure - L4/5 TLIF\nKit - CYLOX (Loan)\nHospital - RHH',
    location: 'RHH',
    start: { dateTime: '2026-11-04T10:00:00+11:00' },
    end: { dateTime: '2026-11-04T11:00:00+11:00' }
  }]])
  candidate = {
    id: 'bk_1', status: 'pending', patient: 'Testa', surgeon: 'Ibbett', date: '2026-11-06',
    hospital: 'RHH', moves: { eventId: 'evt-1', from: '2026-11-04', summary: 'Testa CYLOX - Ibbett' }
  }
})

describe('recognising a moved booking', () => {
  // Before the old day, so the entry has not happened yet.
  const AT = { today: '2026-11-01' }
  const onCalendar = [
    { id: 'evt-1', patient: 'Testa', surgeon: 'Ibbett', date: '2026-11-04' },
    { id: 'evt-2', patient: 'Other', surgeon: 'Ibbett', date: '2026-11-04' }
  ]

  it('finds the entry on its old day', () => {
    expect(movedOnCalendar({ patient: 'testa', surgeon: 'Ibbett', date: '2026-11-06' }, onCalendar, AT).id)
      .toBe('evt-1')
  })

  it('needs the surgeon to agree, not merely be absent', () => {
    expect(movedOnCalendar({ patient: 'Testa', surgeon: 'Fowler', date: '2026-11-06' }, onCalendar, AT)).toBeNull()
    expect(movedOnCalendar({ patient: 'Testa', surgeon: '', date: '2026-11-06' }, onCalendar, AT)).toBeNull()
  })

  it('will not guess between two', () => {
    const two = [...onCalendar, { id: 'evt-3', patient: 'Testa', surgeon: 'Ibbett', date: '2026-11-10' }]
    expect(movedOnCalendar({ patient: 'Testa', surgeon: 'Ibbett', date: '2026-11-06' }, two, AT)).toBeNull()
  })

  it('ignores a cancelled entry and anything months away', () => {
    expect(movedOnCalendar({ patient: 'Testa', surgeon: 'Ibbett', date: '2026-11-06' },
      [{ ...onCalendar[0], cancelled: true }], AT)).toBeNull()
    expect(movedOnCalendar({ patient: 'Testa', surgeon: 'Ibbett', date: '2027-03-06' }, onCalendar, AT)).toBeNull()
  })

  // Toni, 5 Nov 2026: a Thursday email for "Redo left L5/S1 foraminotomy" was
  // offered as Monday's case — a different Oakley, same surgeon — having moved.
  it('never takes a redo or revision for a moved case', () => {
    for (const procedure of ['Redo left L5/S1 foraminotomy + decompression', 'Revision L4/5 fixation', 'Return to theatre, washout']) {
      expect(movedOnCalendar({ patient: 'Testa', surgeon: 'Ibbett', date: '2026-11-06', procedure }, onCalendar, AT), procedure).toBeNull()
    }
  })

  it('never moves a case whose day has already gone to a later day', () => {
    expect(movedOnCalendar({ patient: 'Testa', surgeon: 'Ibbett', date: '2026-11-06' }, onCalendar, { today: '2026-11-05' })).toBeNull()
  })

  it('takes different spinal levels for a different operation', () => {
    const withLevels = [{ ...onCalendar[0], procedure: 'C5/6 ACDF' }]
    expect(movedOnCalendar({ patient: 'Testa', surgeon: 'Ibbett', date: '2026-11-06', procedure: 'L4/5 PLIF' }, withLevels, AT)).toBeNull()
    expect(movedOnCalendar({ patient: 'Testa', surgeon: 'Ibbett', date: '2026-11-06', procedure: 'C5-6 ACDF' }, withLevels, AT)?.id).toBe('evt-1')
  })

  it('reads spinal levels the ways they are written', () => {
    expect([...levelsIn('L4/5 PLIF')]).toEqual(['L4', 'L5'])
    expect([...levelsIn('C5-C7 ACDF')]).toEqual(['C5', 'C6', 'C7'])
    expect([...levelsIn('L5/S1 foraminotomy')]).toEqual(['L5', 'S1'])
    expect(levelsIn('Lumbar decompression').size).toBe(0)
  })
})

describe('accepting a moved booking', () => {
  it('moves the one event and creates nothing', async () => {
    const res = await call('accept', { id: 'bk_1', move: true, date: '2026-11-06' })
    expect(res.statusCode).toBe(200)
    expect(res.payload).toMatchObject({ moved: true, from: '2026-11-04', to: '2026-11-06' })
    expect(creates).toHaveLength(0)
    expect([...events.keys()]).toEqual(['evt-1'])
    expect(events.get('evt-1').start.dateTime.slice(0, 10)).toBe('2026-11-06')
  })

  it('keeps the hours the booking had', async () => {
    await call('accept', { id: 'bk_1', move: true, date: '2026-11-06' })
    const move = patches.find(p => p.patch.start).patch
    expect(move.start).toEqual({ dateTime: '2026-11-06T10:00:00', timeZone: 'Australia/Hobart' })
    expect(move.end).toEqual({ dateTime: '2026-11-06T11:00:00', timeZone: 'Australia/Hobart' })
  })

  it('rewrites the date in the notes and records who moved it', async () => {
    await call('accept', { id: 'bk_1', move: true, date: '2026-11-06' })
    const move = patches.find(p => p.patch.start).patch
    expect(move.description).toMatch(/06\/11\/2026/)
    expect(move.description).not.toMatch(/04\/11\/2026/)
    // No creator line on this booking, so the move is an amendment, not an entry.
    expect(move.description).toMatch(/Amended by Toni/)
  })

  it('moves it between hospitals too', async () => {
    await call('accept', { id: 'bk_1', move: true, date: '2026-11-06', fields: { hospital: 'CLV' } })
    const move = patches.find(p => p.patch.start).patch
    expect(move.location).toBe('CLV')
    expect(move.description).toMatch(/Hospital - CLV/)
  })

  it('still adds a new booking when somebody says it is a different case', async () => {
    await call('accept', {
      id: 'bk_1', date: '2026-11-06',
      fields: { patient: 'Testa', surgeon: 'Ibbett', kit: 'CYLOX (Loan)', hospital: 'RHH' }
    })
    expect(creates).toHaveLength(1)
  })
})

describe('moving from the edit sheet', () => {
  it('moves the event in place', async () => {
    const res = await call('save', {
      eventId: 'evt-1', etag: '"v1"', fields: {},
      start: '2026-11-06T10:00:00', end: '2026-11-06T11:00:00'
    })
    expect(res.statusCode).toBe(200)
    expect(res.payload.event.start.slice(0, 10)).toBe('2026-11-06')
    expect(creates).toHaveLength(0)
  })

  it('says so when the calendar did not take the new date', async () => {
    const { updateCalendarEvent } = await import('./_googleCalendar.js')
    updateCalendarEvent.mockImplementationOnce(async (id) => events.get(id))
    const res = await call('save', {
      eventId: 'evt-1', etag: '"v1"', fields: {},
      start: '2026-11-06T10:00:00', end: '2026-11-06T11:00:00'
    })
    expect(res.statusCode).toBe(502)
    expect(res.payload.error).toMatch(/did not take the new date/)
  })

  it('moves the location with the hospital', async () => {
    await call('save', { eventId: 'evt-1', etag: '"v1"', fields: { hospital: 'CLV' } })
    expect(patches[0].patch.location).toBe('CLV')
  })
})

describe('a booking accepted from the email check (Task 6)', () => {
  it('says who confirmed it, and that it came from email', async () => {
    candidate = { ...candidate, moves: undefined }
    await call('accept', {
      id: 'bk_1', date: '2026-11-06',
      fields: { patient: 'Testa', surgeon: 'Ibbett', kit: 'CYLOX (Loan)', hospital: 'RHH' }
    })
    expect(creates[0].description).toMatch(/Entered by Toni \(from email\)$/)
    expect(creates[0].extendedProperties.private.tmEnteredBy).toBe('Toni (from email)')
  })
})
