import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── A booking change → a preview → Send. Email is faked. ───────────────────

const store = new Map()
const sentMail = []

vi.mock('./_auth.js', () => ({
  requireSession: vi.fn(async () => ({ name: 'Toni Hoppitt', email: 'toni@technomed.com.au' })),
  requireAdmin: vi.fn(async () => ({ name: 'Brenton Lovering', email: 'brenton@technomed.com.au' }))
}))
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, key) => {
    if (cmd === 'get') return store.get(key) ?? null
    if (cmd === 'del') { store.delete(key); return 1 }
    return 'OK'
  }),
  redisSetBody: vi.fn(async (key, value) => { store.set(key, value) })
}))
vi.mock('./_email.js', async () => ({
  escapeHtml: v => String(v ?? ''),
  sendBookingNotice: vi.fn(async n => { sentMail.push(n); return { sent: true } })
}))
vi.mock('./_googleCalendar.js', () => ({
  CALENDAR_SCOPE_READONLY: 'r', CALENDAR_SCOPE_WRITE: 'w', BOOKING_TZ: 'Australia/Hobart',
  getGoogleToken: vi.fn(async () => 't'), getCalendarId: () => 'cal', serviceAccountEmail: () => '',
  getCalendarEvent: vi.fn(), updateCalendarEvent: vi.fn(), createTaskEvent: vi.fn(), deleteCalendarEvent: vi.fn(),
  createBookingEvent: vi.fn(async body => ({ id: 'evt-new001', ...body,
    start: { dateTime: `${body.date}T08:00:00+11:00` } }))
}))
vi.mock('./_gmail.js', () => ({}))
vi.mock('./_dropbox.js', () => ({ dropboxConfigured: () => false, searchUsage: vi.fn() }))
vi.mock('./_readBookingDocument.js', () => ({ readBookingDocument: vi.fn() }))
vi.mock('./_readDictatedBooking.js', () => ({ readDictatedBooking: vi.fn() }))
vi.mock('./_voiceCommand.js', () => ({ readVoiceCommand: vi.fn() }))
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) })))

const { default: handler } = await import('./calendar/today.js')

async function call(action, body, method = 'POST') {
  const res = { statusCode: 0, payload: null, status(c) { this.statusCode = c; return this },
    json(d) { this.payload = d; return this }, setHeader() {}, end() { return this } }
  await handler({ method, query: { action }, headers: {}, body }, res)
  return res
}

beforeEach(() => { store.clear(); sentMail.length = 0 })

describe('creating a Signus booking', () => {
  it('offers a notice and sends nothing yet', async () => {
    const res = await call('create', { date: '2026-11-06',
      fields: { patient: 'Testa', surgeon: 'Ibbett', kit: 'Ascot (Consignment)', hospital: 'CLV' } })
    expect(res.payload.notices).toHaveLength(1)
    expect(res.payload.notices[0]).toMatchObject({ name: 'Signus', to: ['jhanson@signus.com.au'] })
    expect(sentMail).toEqual([])
  })

  it('Send sends exactly what was shown, as the person who confirmed it, once', async () => {
    const res = await call('create', { date: '2026-11-06',
      fields: { patient: 'Testa', surgeon: 'Ibbett', kit: 'Ascot (Consignment)', hospital: 'CLV' } })
    const preview = res.payload.notices[0]
    const sent = await call('notify', { ids: [preview.id] })
    expect(sent.payload.ok).toBe(true)
    expect(sentMail).toHaveLength(1)
    expect(sentMail[0].subject).toBe(preview.subject)
    expect(sentMail[0].sender).toEqual({ name: 'Toni Hoppitt', email: 'toni@technomed.com.au' })
    const again = await call('notify', { ids: [preview.id] })
    expect(again.payload.ok).toBe(false)
    expect(sentMail).toHaveLength(1)
  })

  it('a rule set to send on its own sends straight away', async () => {
    const { DEFAULT_CONTACTS, DEFAULT_RULES } = await import('./_bookingNotices.js')
    store.set('notices:settings', JSON.stringify({
      contacts: DEFAULT_CONTACTS, rules: DEFAULT_RULES.map(r => ({ ...r, autoSend: true })) }))
    const res = await call('create', { date: '2026-11-06',
      fields: { patient: 'Testa', surgeon: 'Ibbett', kit: 'Ascot', hospital: 'CLV' } })
    expect(res.payload.noticesSent).toEqual(['Signus'])
    expect(sentMail).toHaveLength(1)
  })
})

describe('Admin → Notices', () => {
  it('refuses an address that is not one', async () => {
    const { DEFAULT_CONTACTS, DEFAULT_RULES } = await import('./_bookingNotices.js')
    const bad = DEFAULT_CONTACTS.map((c, i) => (i === 0 ? { ...c, to: ['not an address'] } : c))
    const res = await call('noticesettings', { contacts: bad, rules: DEFAULT_RULES })
    expect(res.statusCode).toBe(400)
  })

  it('saves edited contacts, which the next notice uses', async () => {
    const { DEFAULT_CONTACTS, DEFAULT_RULES } = await import('./_bookingNotices.js')
    const edited = DEFAULT_CONTACTS.map(c => (c.id === 'signus' ? { ...c, to: ['newperson@signus.com.au'] } : c))
    expect((await call('noticesettings', { contacts: edited, rules: DEFAULT_RULES })).statusCode).toBe(200)
    const res = await call('create', { date: '2026-11-06',
      fields: { patient: 'Testa', surgeon: 'Ibbett', kit: 'Ascot', hospital: 'CLV' } })
    expect(res.payload.notices[0].to).toEqual(['newperson@signus.com.au'])
  })
})
