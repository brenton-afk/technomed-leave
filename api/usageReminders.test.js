import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Task 11: "usage not sent" reminders ────────────────────────────────────
// Calendar, Redis and email are all faked. Fake patients.

const sent = []
let events = []
let usage = []
const store = new Map()

vi.mock('./_googleCalendar.js', () => ({
  getGoogleToken: vi.fn(async () => 't'), getCalendarId: () => 'cal', CALENDAR_SCOPE_READONLY: 'r'
}))
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, key, value) => {
    if (cmd === 'get') return store.get(key) ?? null
    if (cmd === 'set') { store.set(key, value); return 'OK' }
    if (cmd === 'del') { store.delete(key); return 1 }
    return null
  }),
  getUsageHistory: vi.fn(async () => usage),
  getTeamLeader: vi.fn(async () => null),
  getAllTimesheets: vi.fn(async () => [])
}))
vi.mock('./_email.js', () => ({
  sendUsageReminderEmail: vi.fn(async m => { sent.push(m); return { sent: true } })
}))
vi.mock('./_push.js', () => ({ notify: vi.fn(async () => ({ sent: 0 })) }))
vi.mock('./_twilio.js', () => ({ sendSms: vi.fn(), toE164: () => null, twilioConfigured: () => false }))
vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ items: events }) })))

const reminders = await import('./_usageReminders.js')
const { default: cron } = await import('./cron/timesheet-reminder.js')

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Hobart' }).format(new Date())
const booking = (id, summary, extra = '', date = today) => ({
  id, summary, description: `Pt - Testa\nProcedure - L4/5 PLIF\nHospital - RHH\n${extra}`,
  start: { dateTime: `${date}T09:00:00+11:00` }
})

async function run(job) {
  process.env.CRON_SECRET = 's'
  process.env.USAGE_REMINDERS = 'on'
  const res = { statusCode: 0, payload: null, status(c) { this.statusCode = c; return this }, json(d) { this.payload = d; return this } }
  await cron({ query: { job }, headers: { authorization: 'Bearer s' } }, res)
  return res
}

beforeEach(() => { sent.length = 0; store.clear(); usage = []; events = [] })

describe('6pm, the case day', () => {
  it('reminds each planned rep once, without the patient', async () => {
    events = [booking('a', 'Testa MARINER - Ibbett', 'Planned rep: Ben / Aimee')]
    const res = await run('evening')
    expect(res.statusCode).toBe(200)
    expect(sent.map(m => m.to).sort()).toEqual(['aimee@technomed.com.au', 'ben@technomed.com.au'])
    expect(sent[0].lines).toEqual(['Ibbett · L4/5 PLIF · RHH'])
    expect(JSON.stringify(sent)).not.toMatch(/Testa/)
  })

  it('says nothing once the usage email has gone', async () => {
    events = [booking('a', 'Testa MARINER - Ibbett (Mat)')]
    usage = [{ date: today, patientSurname: 'Testa', emailsSent: [{ ok: true }] }]
    await run('evening')
    expect(sent).toEqual([])
  })

  it('a failed or test send does not count as sent', async () => {
    events = [booking('a', 'Testa MARINER - Ibbett (Mat)')]
    usage = [{ date: today, patientSurname: 'Testa', emailsSent: [{ ok: false }, { ok: true, test: true }] }]
    await run('evening')
    expect(sent.map(m => m.to)).toEqual(['mat@technomed.com.au'])
  })

  it('leaves alone a case marked No usage, a called-off case, a No F2F case and an unallocated one', async () => {
    events = [
      booking('a', 'Testa MARINER - Ibbett', 'Planned rep: Ben'),
      booking('b', 'CANCELLED - Testa MARINER - Ibbett', 'Planned rep: Ben'),
      booking('c', 'Testa BRAINLAB AIRO (No F2F) - Ibbett', 'Planned rep: Ben\nNo F2F required'),
      booking('d', 'Testa MARINER - Ibbett')
    ]
    await reminders.markNoUsage('a', 'Ben')
    await run('evening')
    expect(sent).toEqual([])
  })
})

describe('9am the next day', () => {
  it('tells that week\'s team leader what is still unsent', async () => {
    const y = new Date(Date.now() - 86400000)
    const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Hobart' }).format(y)
    events = [booking('a', 'Testa MARINER - Ibbett', 'Planned rep: Ben', yesterday)]
    const res = await run('morning')
    expect(res.payload.usage.escalated).toBe(1)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ escalation: true })
    expect(sent[0].lines[0]).toMatch(/Ibbett · L4\/5 PLIF · RHH — Ben/)
  })
})

describe('the cron', () => {
  it('still refuses a call without the secret', async () => {
    process.env.CRON_SECRET = 's'
    const res = { statusCode: 0, status(c) { this.statusCode = c; return this }, json() { return this } }
    await cron({ query: { job: 'evening' }, headers: {} }, res)
    expect(res.statusCode).toBe(401)
  })
})

// "Please pause the usage reminder emails as they are not accurate, since we
// are not yet sending usage from the portal yet." — Brent, 3 Nov 2026.
describe('paused', () => {
  it('sends nothing at 6pm or 9am until switched on', async () => {
    usage = []
    process.env.CRON_SECRET = 's'
    delete process.env.USAGE_REMINDERS
    const res = { statusCode: 0, payload: null, status(c) { this.statusCode = c; return this }, json(d) { this.payload = d; return this } }
    await cron({ query: { job: 'evening' }, headers: { authorization: 'Bearer s' } }, res)
    expect(res.payload).toMatchObject({ ran: 'evening', usage: 'paused' })
    await cron({ query: { job: 'morning' }, headers: { authorization: 'Bearer s' } }, res)
    expect(res.payload.usage).toBe('paused')
    expect(sent).toEqual([])
  })
})
