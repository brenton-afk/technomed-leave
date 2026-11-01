import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── The mailbox check: faster, and Toby's Brainlab cases come in as No F2F ──
// Gmail, Google Calendar, Redis and the model are all faked. Invented patients.

const queue = new Map()
const seen = new Set()
let mailbox
let inFlight = 0
let maxInFlight = 0
const downloaded = []
let created = null

const row = (...cells) => `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`
const TOBY = `<table>${row('Wednesday<br>4th November 2026')}
${row('Neurosurgery', 'DUBEY', 'Theatre Number 11')}
${row('BLabs no F2F required', 'TESTA Jane', 'Right frontal craniotomy')}</table>`

vi.mock('./_auth.js', () => ({
  requireSession: vi.fn(async () => ({ name: 'Toni Hoppitt', email: 'toni@technomed.com.au' })),
  requireAdmin: vi.fn()
}))
vi.mock('./_gmail.js', () => ({
  searchMailbox: vi.fn(async () => Object.keys(mailbox)),
  senderOf: vi.fn(async id => mailbox[id].from),
  addressOf: v => String(v || '').replace(/.*</, '').replace(/>.*/, '').trim().toLowerCase(),
  readMessage: vi.fn(async id => {
    downloaded.push(id)
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise(r => setTimeout(r, 20))
    inFlight--
    return { from: mailbox[id].from, subject: 'Cases', html: mailbox[id].html || '', text: mailbox[id].text || '' }
  })
}))
vi.mock('./_readBookingDocument.js', () => ({
  readBookingDocument: vi.fn(async () => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise(r => setTimeout(r, 20))
    inFlight--
    return [{ patient: 'Rossa', surgeon: 'Ibbett', date: '2026-11-09', kit: 'Dakota', hospital: 'CLV' }]
  })
}))
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async () => null), redisSetBody: vi.fn(),
  bookingEmailSeen: vi.fn(async id => seen.has(id)),
  markBookingEmailSeen: vi.fn(async id => { seen.add(id) }),
  markBookingEmailFailed: vi.fn(),
  saveBookingCandidate: vi.fn(async c => { queue.set(c.id, c) }),
  getBookingCandidate: vi.fn(async id => queue.get(id)),
  getBookingQueue: vi.fn(async () => [...queue.values()]),
  updateBookingCandidate: vi.fn(async (id, up) => ({ ...queue.get(id), ...up })),
  getTeamLeader: vi.fn(async () => null)
}))
vi.mock('./_googleCalendar.js', () => ({
  CALENDAR_SCOPE_READONLY: 'r', CALENDAR_SCOPE_WRITE: 'w', BOOKING_TZ: 'Australia/Hobart',
  getGoogleToken: vi.fn(async () => 't'), getCalendarId: () => 'cal', serviceAccountEmail: () => '',
  getCalendarEvent: vi.fn(), updateCalendarEvent: vi.fn(), createTaskEvent: vi.fn(), deleteCalendarEvent: vi.fn(),
  createBookingEvent: vi.fn(async body => { created = body; return { id: 'evt-n1', ...body, start: { dateTime: `${body.date}T08:00:00+11:00` } } })
}))
vi.mock('./_dropbox.js', () => ({ dropboxConfigured: () => false, searchUsage: vi.fn() }))
vi.mock('./_readDictatedBooking.js', () => ({ readDictatedBooking: vi.fn() }))
vi.mock('./_voiceCommand.js', () => ({ readVoiceCommand: vi.fn() }))
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) })))

const { default: handler } = await import('./calendar/today.js')

async function call(action, body) {
  const res = { statusCode: 0, payload: null, status(c) { this.statusCode = c; return this },
    json(d) { this.payload = d; return this }, setHeader() {}, end() { return this } }
  await handler({ method: 'POST', query: { action }, headers: {}, body }, res)
  return res
}

beforeEach(() => {
  queue.clear(); seen.clear(); downloaded.length = 0; inFlight = 0; maxInFlight = 0; created = null
  mailbox = {
    toby: { from: 'Tobias Long <tobias.long@ths.tas.gov.au>', html: TOBY },
    cns1: { from: 'bookings@cnstas.com.au', text: 'Booking' },
    cns2: { from: 'bookings@cnstas.com.au', text: 'Booking' },
    cns3: { from: 'bookings@cnstas.com.au', text: 'Booking' },
    news: { from: 'newsletter@example.com' },
    device: { from: 'kwatson@device.com.au' }
  }
})

describe('reading the mailbox', () => {
  it('only downloads emails from booking sources', async () => {
    const res = await call('ingest', {})
    expect(downloaded.sort()).toEqual(['cns1', 'cns2', 'cns3', 'toby'])
    expect(res.payload).toMatchObject({ skipped: 1, echoes: 1, read: 4 })
  })

  it('reads several at once rather than one after another', async () => {
    await call('ingest', {})
    expect(maxInFlight).toBeGreaterThan(1)
  })

  it('does not read an email twice', async () => {
    await call('ingest', {})
    downloaded.length = 0
    await call('ingest', {})
    expect(downloaded).toEqual([])
  })
})

describe('a Brainlab no-F2F case from Toby', () => {
  it('is queued as Brainlab, No F2F', async () => {
    await call('ingest', {})
    const c = [...queue.values()].find(x => x.patient === 'Testa')
    expect(c).toMatchObject({ kit: 'BRAINLAB', attendance: 'No F2F', surgeon: 'Dubey' })
  })

  it('accepted, it is booked with (No F2F) in the title', async () => {
    await call('ingest', {})
    const c = [...queue.values()].find(x => x.patient === 'Testa')
    await call('accept', { id: c.id, date: c.date,
      fields: { patient: 'Testa', surgeon: 'Dubey', kit: 'BRAINLAB', hospital: 'RHH' }, notes: c.note })
    expect(created.summary).toMatch(/^Testa BRAINLAB \(No F2F\) - Dubey/)
    expect(created.description).toMatch(/No F2F required/)
  })
})
