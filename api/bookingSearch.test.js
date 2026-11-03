import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Searching every booking from the Cases page ─────────────────────────────
// Fake patients throughout.

let items
let lastUrl

vi.mock('./_auth.js', () => ({
  requireSession: vi.fn(async () => ({ name: 'Toni Test', email: 'toni@technomed.com.au' }))
}))
vi.mock('./_googleCalendar.js', () => ({
  CALENDAR_SCOPE_READONLY: 'r', CALENDAR_SCOPE_WRITE: 'w', BOOKING_TZ: 'Australia/Hobart',
  getGoogleToken: vi.fn(async () => 'token'),
  getCalendarId: () => 'bookings@example.test',
  serviceAccountEmail: () => 'sa@example.test',
  getCalendarEvent: vi.fn(), updateCalendarEvent: vi.fn(), createBookingEvent: vi.fn(),
  createTaskEvent: vi.fn(), deleteCalendarEvent: vi.fn()
}))
let worklist = []
vi.mock('./_redis.js', () => ({ getWorklist: vi.fn(async () => ({ items: worklist, unreadable: [] })) }))
vi.mock('./_gmail.js', () => ({}))
vi.mock('./_dropbox.js', () => ({ dropboxConfigured: () => false, searchUsage: vi.fn() }))
vi.mock('./_readBookingDocument.js', () => ({ readBookingDocument: vi.fn() }))
vi.mock('./_readDictatedBooking.js', () => ({ readDictatedBooking: vi.fn() }))
vi.mock('./_voiceCommand.js', () => ({ readVoiceCommand: vi.fn() }))

vi.stubGlobal('fetch', vi.fn(async url => {
  lastUrl = decodeURIComponent(String(url))
  return { ok: true, json: async () => ({ items }) }
}))

const { default: handler, caseMatches } = await import('./calendar/today.js')

async function search(q) {
  const res = {
    statusCode: 0, payload: null,
    status(code) { this.statusCode = code; return this },
    json(data) { this.payload = data; return this },
    setHeader() {}, end() { return this }
  }
  await handler({ method: 'GET', query: { action: 'search', q }, headers: {} }, res)
  return res
}

const booking = (id, date, summary, description = '') => ({
  id, summary, description, start: { dateTime: `${date}T09:00:00+11:00` }, end: { dateTime: `${date}T10:00:00+11:00` }
})

beforeEach(() => {
  items = [
    booking('a', '2025-03-04', 'Testa CYLOX - Ibbett', 'Pt - Testa (Jo)\nHospital - RHH'),
    booking('b', '2026-12-01', 'Testa Rossa DIPLOMAT - Thani'),
    { ...booking('c', '2026-11-10', 'Annual leave - Toni'), start: { date: '2026-11-10' } },
    booking('d', '2026-11-20', 'Marsh REFORM - Ibbett', 'Note: ring Testa family')
  ]
})

describe('searching', () => {
  it('asks Google over every year of bookings', async () => {
    await search('testa')
    expect(lastUrl).toMatch(/q=testa/)
    expect(lastUrl).toMatch(/timeMin=2020-01-01/)
  })

  it('returns past and future cases, newest first', async () => {
    const res = await search('testa')
    expect(res.payload.results.map(r => r.id)).toEqual(['b', 'a'])
    expect(res.payload.results[1]).toMatchObject({ date: '2025-03-04', patient: 'Testa', surgeon: 'Ibbett' })
  })

  it('shows the surname, never the first name it matched in the notes', async () => {
    const res = await search('jo')
    expect(res.payload.results.map(r => r.id)).toEqual(['a'])
    expect(JSON.stringify(res.payload)).not.toMatch(/\bJo\b/)
  })

  it('finds a surgeon across months', async () => {
    const res = await search('ibbett')
    expect(res.payload.results.map(r => r.id)).toEqual(['d', 'a'])
  })

  it('leaves out leave and a mention in passing', async () => {
    const res = await search('testa')
    expect(res.payload.results.map(r => r.id)).not.toContain('d')
    expect((await search('toni')).payload.results).toEqual([])
  })

  it('needs at least two letters', async () => {
    lastUrl = ''
    expect((await search('t')).payload.results).toEqual([])
    expect(lastUrl).toBe('')
  })
})

describe('caseMatches', () => {
  it('needs every word to match somewhere on the card', () => {
    const read = { patient: 'Testa', surgeon: 'Ibbett', system: 'CYLOX', hospital: 'RHH' }
    expect(caseMatches(read, 'testa rhh')).toBe(true)
    expect(caseMatches(read, 'testa clv')).toBe(false)
  })
})

// "Please add a search function to the portal, to find both cases and tasks."
describe('tasks', () => {
  it('finds a calendar task and a Projects board task, marked as tasks', async () => {
    items = [
      booking('a', '2025-03-04', 'Testa CYLOX - Ibbett'),
      { id: 't1', summary: 'TASK: Get Athlet back from RHH', description: 'Task: Kit\nFor: Mat', start: { date: '2026-11-05' } }
    ]
    worklist = [
      { id: 'w1', task: 'Order more Athlet screws', assignee: 'Aimee', status: 'open', due_date: '2026-11-07' },
      { id: 'w2', task: 'Unrelated', assignee: 'Ben', status: 'open' }
    ]
    const res = await search('athlet')
    const kinds = res.payload.results.map(r => [r.type, r.what || r.patient])
    expect(kinds).toEqual(expect.arrayContaining([
      ['task', 'Get Athlet back from RHH'],
      ['project', 'Order more Athlet screws']
    ]))
    expect(res.payload.results.find(r => r.type === 'task')).toMatchObject({ id: 't1', date: '2026-11-05', who: 'Mat' })
    expect(kinds.some(([, w]) => w === 'Unrelated')).toBe(false)
  })

  it('never shows a task as a case', async () => {
    items = [{ ...booking('t2', '2026-11-05', 'TASK: Testa trays to CSSD'), description: '' }]
    worklist = []
    const res = await search('testa')
    expect(res.payload.results.map(r => r.type)).toEqual(['task'])
  })
})
