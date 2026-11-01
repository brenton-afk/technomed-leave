import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Task 4, over the wire: reading and saving a multi-word surname ──────────
// The handler itself, with Google faked. Fake patient names throughout.

let event
let patches
let created

vi.mock('./_auth.js', () => ({
  requireSession: vi.fn(async () => ({ name: 'Toni Test', email: 'toni@technomed.com.au' }))
}))
vi.mock('./_googleCalendar.js', () => ({
  CALENDAR_SCOPE_READONLY: 'r', CALENDAR_SCOPE_WRITE: 'w', BOOKING_TZ: 'Australia/Hobart',
  getGoogleToken: vi.fn(async () => 'token'),
  getCalendarId: () => 'bookings@example.test',
  serviceAccountEmail: () => 'sa@example.test',
  getCalendarEvent: vi.fn(async () => event),
  updateCalendarEvent: vi.fn(async (id, patch) => {
    patches.push(patch)
    event = {
      ...event, ...patch, etag: '"v2"',
      extendedProperties: { private: { ...event.extendedProperties?.private, ...patch.extendedProperties?.private } }
    }
    return event
  }),
  createBookingEvent: vi.fn(async body => { created = body; return { id: 'new', ...body } }),
  createTaskEvent: vi.fn(), deleteCalendarEvent: vi.fn()
}))
vi.mock('./_redis.js', () => ({}))
vi.mock('./_gmail.js', () => ({}))
vi.mock('./_dropbox.js', () => ({ dropboxConfigured: () => false, searchUsage: vi.fn() }))
vi.mock('./_readBookingDocument.js', () => ({ readBookingDocument: vi.fn() }))
vi.mock('./_readDictatedBooking.js', () => ({ readDictatedBooking: vi.fn() }))
vi.mock('./_voiceCommand.js', () => ({ readVoiceCommand: vi.fn() }))

// The day-tidy after a save reads the day from Google; an empty day is fine.
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) })))

const { default: handler } = await import('./calendar/today.js')

async function call(action, { method = 'GET', query = {}, body } = {}) {
  const res = {
    statusCode: 0, payload: null,
    status(code) { this.statusCode = code; return this },
    json(data) { this.payload = data; return this },
    setHeader() {}, end() { return this }
  }
  await handler({ method, query: { action, ...query }, headers: {}, body }, res)
  return res
}

beforeEach(() => {
  patches = []
  created = null
  event = {
    id: 'evt-9', etag: '"v1"',
    summary: 'Testa Rossa Bianca CYLOX - Ibbett',
    description: 'Surg - Dr Ibbett\nPt - Testa Rossa Bianca (Jo)\nProcedure - L4/5 TLIF\nKit - CYLOX (Loan)\nHospital - RHH',
    start: { dateTime: '2026-11-04T09:00:00+11:00', timeZone: 'Australia/Hobart' },
    end: { dateTime: '2026-11-04T10:00:00+11:00', timeZone: 'Australia/Hobart' },
    extendedProperties: { private: { tmPatient: 'Testa Rossa Bianca' } }
  }
})

describe('opening a booking', () => {
  it('gives the form the whole surname and not the first name', async () => {
    const res = await call('booking', { query: { id: 'evt-9' } })
    expect(res.payload.fields.patient).toBe('Testa Rossa Bianca')
  })

  it('reads a particle surname whole even without the stored one', async () => {
    event.description = event.description.replace('Testa Rossa Bianca', 'Van der Berg')
    event.extendedProperties = undefined
    const res = await call('booking', { query: { id: 'evt-9' } })
    expect(res.payload.fields.patient).toBe('Van der Berg')
  })
})

describe('saving', () => {
  it('replaces the whole surname and keeps what followed it', async () => {
    await call('save', { method: 'POST', body: { eventId: 'evt-9', etag: '"v1"', fields: { patient: 'Marsh' } } })
    expect(patches[0].description).toMatch(/Pt - Marsh \(Jo\)/)
    expect(patches[0].description).not.toMatch(/Rossa/)
  })

  it('records the surname on the event as a fact', async () => {
    await call('save', { method: 'POST', body: { eventId: 'evt-9', etag: '"v1"', fields: { patient: 'Marsh Lane' } } })
    expect(patches[0].extendedProperties).toEqual({ private: { tmPatient: 'Marsh Lane' } })
  })

  it('leaves the stored surname alone when the surname was not edited', async () => {
    await call('save', { method: 'POST', body: { eventId: 'evt-9', etag: '"v1"', fields: { procedure: 'L4/5 PLIF' } } })
    expect(patches[0].extendedProperties).toBeUndefined()
  })

  it('answers with dates as strings, the shape the form loaded', async () => {
    const res = await call('save', { method: 'POST', body: { eventId: 'evt-9', etag: '"v1"', fields: { procedure: 'X' } } })
    expect(res.payload.event.start).toBe('2026-11-04T09:00:00+11:00')
    expect(res.payload.event.end).toBe('2026-11-04T10:00:00+11:00')
    expect(res.payload.event.etag).toBe('"v2"')
  })

  it('does not move a booking whose date was not sent', async () => {
    await call('save', { method: 'POST', body: { eventId: 'evt-9', etag: '"v1"', fields: { procedure: 'X' } } })
    expect(patches[0].start).toBeUndefined()
  })
})

describe('creating a booking', () => {
  it('stores the typed surname with the event', async () => {
    await call('create', {
      method: 'POST',
      body: { fields: { patient: 'Testa Rossa', surgeon: 'Ibbett', kit: 'CYLOX (Loan)' }, date: '2026-11-04' }
    })
    expect(created.summary).toMatch(/^Testa Rossa CYLOX - Ibbett/)
    expect(created.extendedProperties.private.tmPatient).toBe('Testa Rossa')
  })
})

describe('who entered it (Task 6)', () => {
  it('records the signed-in creator in the notes and on the event', async () => {
    await call('create', {
      method: 'POST',
      body: { fields: { patient: 'Testa', surgeon: 'Ibbett' }, date: '2026-11-04' }
    })
    expect(created.description).toMatch(/Entered by Toni$/)
    expect(created.extendedProperties.private.tmEnteredBy).toBe('Toni')
  })

  it('does not make the editor the creator of a booking typed into Google', async () => {
    event.extendedProperties = undefined
    await call('save', { method: 'POST', body: { eventId: 'evt-9', etag: '"v1"', fields: { procedure: 'X' } } })
    expect(patches[0].description).not.toMatch(/Entered by Toni/)
    expect(patches[0].description).toMatch(/Amended by Toni \d{1,2}\/\d{1,2}\/\d{4}$/)
  })

  it('keeps the creator recorded on the event', async () => {
    event.extendedProperties = { private: { tmEnteredBy: 'Mat' } }
    await call('save', { method: 'POST', body: { eventId: 'evt-9', etag: '"v1"', fields: { procedure: 'X' } } })
    expect(patches[0].description).toMatch(/Entered by Mat · amended by Toni/)
  })
})
