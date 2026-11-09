import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── The mailbox check: faster, and Toby's Brainlab cases come in as No F2F ──
// Gmail, Google Calendar, Redis and the model are all faked. Invented patients.

const queue = new Map()
const seen = new Set()
const records = new Map()
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
  headersOf: vi.fn(async id => ({ from: mailbox[id].from, subject: mailbox[id].subject || '', snippet: mailbox[id].snippet || '' })),
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
  redis: vi.fn(async (cmd, key) => (String(cmd).toUpperCase() === 'SET' ? 'OK' : null)), redisSetBody: vi.fn(),
  bookingEmailRecord: vi.fn(async id => (seen.has(id) ? (records.get(id) || { count: 1, rule: 2 }) : null)),
  markBookingEmailSeen: vi.fn(async (id, count, extra) => { seen.add(id); records.set(id, { count, rule: 2, ...extra }) }),
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
  queue.clear(); seen.clear(); records.clear(); downloaded.length = 0; inFlight = 0; maxInFlight = 0; created = null
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

// "There's a new email in the bookings email from Ben Reynolds about case
// support but the portal inbox checker isn't picking it up." Distributor mail
// is set aside as an echo of our own bookings — but a rep asking us to cover
// one of their cases is a booking. Invented patient.
describe('a distributor asking us to cover a case', () => {
  const COVER = { from: 'Ben Reynolds <ben@ktmedical.com.au>', subject: 'Case coverage Thursday 12/11',
    snippet: 'Hi team, case coverage request for Thursday at Calvary; JPW L5/S1 PLIF pt TESTA', text: 'case coverage request' }

  it('is read, while their invites and confirmations stay echoes', async () => {
    mailbox = { cover: COVER,
      invite: { from: 'kt@ktmedical.com.au', subject: 'Invitation: Testa PLIF @ Thu 12 Nov' },
      chat: { from: 'kt@ktmedical.com.au', subject: 'Invoice 2041', snippet: 'Please find attached' } }
    const res = await call('ingest', {})
    expect(downloaded).toEqual(['cover'])
    expect(res.payload).toMatchObject({ echoes: 2, read: 1 })
    expect([...queue.values()][0].sources).toEqual(['distributor'])
  })

  it('is looked at again if it was set aside before this change', async () => {
    mailbox = { cover: COVER, cns1: { from: 'bookings@cnstas.com.au', text: 'Booking' } }
    // Both marked seen under the old rule with nothing found.
    seen.add('cover'); records.set('cover', { count: 0 })
    seen.add('cns1'); records.set('cns1', { count: 0 })
    await call('ingest', {})
    // The cover request is read; the hospital email that genuinely had no case
    // in it is not read a second time.
    expect(downloaded).toEqual(['cover'])
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

// "I want the portal to scan the bookings email, and KNOW whether it needs to
// alert the user to the booking based on if it is already in the portal OR
// not." — an email for a case that was added and then taken off the calendar
// stayed marked as added, and the inbox said nothing.
describe('every booking checked against the calendar as it is now', async () => {
  const { reconcileQueue } = await import('./calendar/today.js')
  const redisMod = await import('./_redis.js')
  const TODAY = '2026-11-02'
  const onCal = (id, patient, date, extra = {}) => ({ id, patient, surgeon: 'Dubey', date, summary: `${patient} - Dubey`, cancelled: false, ...extra })
  const updates = () => redisMod.updateBookingCandidate.mock.calls.map(([id, up]) => ({ id, ...up }))
  beforeEach(() => redisMod.updateBookingCandidate.mockClear())

  it('brings back a booking the app added that has since been taken off the calendar', async () => {
    const queue = [{ id: 'q1', status: 'accepted', eventId: 'evt-gone', acceptedBy: 'Brent', patient: 'Allan', surgeon: 'Dubey', date: '2026-11-12' }]
    const result = await reconcileQueue(queue, TODAY, async () => [onCal('evt-other', 'Rossa', '2026-11-12')])
    expect(result.returned).toBe(1)
    expect(updates()[0]).toMatchObject({ id: 'q1', status: 'pending', returned: { was: 'accepted', by: 'Brent' } })
  })

  it('leaves it alone while it is still there, cancelled or not', async () => {
    const queue = [
      { id: 'q1', status: 'accepted', eventId: 'evt-1', patient: 'Allan', surgeon: 'Dubey', date: '2026-11-12' },
      { id: 'q2', status: 'onCalendar', matchedEventId: 'evt-x', patient: 'Rossa', surgeon: 'Dubey', date: '2026-11-13' }
    ]
    const result = await reconcileQueue(queue, TODAY, async () => [
      onCal('evt-1', 'Allan', '2026-11-12'), onCal('evt-9', 'Rossa', '2026-11-13', { cancelled: true })])
    expect(result.returned).toBe(0)
    expect(updates()).toEqual([])
  })

  it('takes a waiting booking off the list once somebody has entered it', async () => {
    const queue = [{ id: 'q1', status: 'pending', patient: 'Allan', surgeon: 'Dubey', date: '2026-11-12' }]
    const result = await reconcileQueue(queue, TODAY, async () => [onCal('evt-5', 'Allan', '2026-11-12')])
    expect(result.nowBooked).toBe(1)
    expect(updates()[0]).toMatchObject({ id: 'q1', status: 'onCalendar', matchedEventId: 'evt-5' })
  })

  it('never resurrects what a person settled, nor anything already past', async () => {
    const queue = [
      { id: 'q1', status: 'dismissed', patient: 'Allan', surgeon: 'Dubey', date: '2026-11-12' },
      { id: 'q2', status: 'onCalendar', dismissedBy: 'Toni', patient: 'Alan', surgeon: 'Dubey', date: '2026-11-12' },
      { id: 'q3', status: 'accepted', eventId: 'evt-old', patient: 'Rossa', surgeon: 'Dubey', date: '2026-10-20' }
    ]
    const read = vi.fn(async () => [])
    const result = await reconcileQueue(queue, TODAY, read)
    expect(result).toEqual({ returned: 0, nowBooked: 0 })
    expect(read).not.toHaveBeenCalled()
  })

  it('changes nothing when the calendar cannot be read', async () => {
    const queue = [{ id: 'q1', status: 'accepted', eventId: 'e', patient: 'Allan', surgeon: 'Dubey', date: '2026-11-12' }]
    const result = await reconcileQueue(queue, TODAY, async () => { throw new Error('down') })
    expect(result.returned).toBe(0)
    expect(updates()).toEqual([])
  })
})

describe('two checks of bookings@ at once', () => {
  it('the second answers with the queue and reads nothing', async () => {
    const { ingestBookings } = await import('./calendar/today.js')
    const redisMod = await import('./_redis.js')
    redisMod.redis.mockImplementationOnce(async () => null) // the lock is held
    const r = await ingestBookings()
    expect(r.skipped).toMatch(/another check/)
    expect(r.found).toBe(0)
  })
})

// Brent, 9 Nov 2026: "pt Nichols on 17/11/26 has been cancelled but the portal
// can't see it when I hit inbox." Invented patient.
describe('a cancellation email', () => {
  const EVENT = {
    id: 'evt-t', summary: 'Testcase DAKOTA - Ibbett',
    description: 'Surgeon: Ibbett\nPatient: Testcase\nHospital: CLV\nKit: Dakota (Consignment)',
    location: 'CLV', start: { dateTime: '2026-11-17T08:00:00+11:00' }, end: { dateTime: '2026-11-17T09:00:00+11:00' }
  }
  const CANCEL = { from: 'bookings@cnstas.com.au', subject: 'Cancellation - Testcase 17/11', snippet: 'Please cancel', text: 'Please cancel Testcase on 17/11' }

  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [EVENT] }) })))
    const reader = await import('./_readBookingDocument.js')
    reader.readBookingDocument.mockResolvedValueOnce([{ patient: 'Testcase', surgeon: 'Ibbett', date: '2026-11-17', hospital: 'CLV', cancelled: true }])
  })

  it('becomes a card offering to cancel the booking, not "already on the calendar"', async () => {
    mailbox = { cancel: CANCEL }
    const res = await call('ingest', {})
    const card = [...queue.values()].find(c => c.kind === 'cancel')
    expect(card).toMatchObject({ status: 'pending', cancels: { eventId: 'evt-t' } })
    expect(res.payload.pending.map(c => c.id)).toContain(card.id)
    expect(res.payload.already).toBe(0)
  })

  it('is read again when it was filed before cancellations were understood', async () => {
    mailbox = { cancel: CANCEL, other: { from: 'bookings@cnstas.com.au', subject: 'Booking - Other 18/11', snippet: 'Please book' } }
    seen.add('cancel'); records.set('cancel', { count: 1, rule: 2 })
    seen.add('other'); records.set('other', { count: 1, rule: 2 })
    await call('ingest', {})
    expect(downloaded).toEqual(['cancel'])
    expect([...queue.values()].some(c => c.kind === 'cancel' && c.status === 'pending')).toBe(true)
  })

  it('Cancel the booking marks it CANCELLED on the calendar, as the Cancel button does', async () => {
    mailbox = { cancel: CANCEL }
    await call('ingest', {})
    const card = [...queue.values()].find(c => c.kind === 'cancel')
    const cal = await import('./_googleCalendar.js')
    cal.getCalendarEvent.mockResolvedValue(EVENT)
    cal.updateCalendarEvent.mockImplementation(async (id, patch) => ({ ...EVENT, ...patch, id }))
    const res = await call('accept', { id: card.id })
    expect(res.statusCode).toBe(200)
    expect(res.payload.cancelledBooking).toBe(true)
    const [id, patch] = cal.updateCalendarEvent.mock.calls.at(-1)
    expect(id).toBe('evt-t')
    expect(patch.summary).toMatch(/^CANCELLED/i)
    expect(patch.description).toMatch(/Cancelled by Toni — cancellation email/)
    expect(created).toBeNull()
  })
})
