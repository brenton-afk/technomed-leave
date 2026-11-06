import { describe, it, expect, vi, beforeEach } from 'vitest'

// Leave approval and meeting minutes act once, however many taps (review,
// 6 Nov 2026). Invented people and records only.

const store = new Map()
const apps = new Map()
const meetings = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, key, ...rest) => {
    if (cmd === 'set') { if (rest.includes('NX') && store.has(key)) return null; store.set(key, rest[0]); return 'OK' }
    if (cmd === 'del') { store.delete(key); return 1 }
    return null
  }),
  redisSetBody: vi.fn(async () => {}),
  getApplication: vi.fn(async id => structuredClone(apps.get(id))),
  updateApplicationStatus: vi.fn(async (id, status) => {
    await new Promise(r => setTimeout(r, 5))
    const a = { ...apps.get(id), status }; apps.set(id, a); return a
  }),
  saveMeeting: vi.fn(), getMeeting: vi.fn(async id => structuredClone(meetings.get(id))),
  updateMeetingStatus: vi.fn(async (id, status) => { meetings.set(id, { ...meetings.get(id), status }) }),
  saveWorklistItem: vi.fn(async () => {}), getWorklist: vi.fn(), getWorklistItem: vi.fn(),
  updateWorklistItem: vi.fn(), deleteWorklistItem: vi.fn(), saveProject: vi.fn(), getProject: vi.fn(), getProjects: vi.fn()
}))
vi.mock('./_auth.js', () => ({
  requireAdmin: vi.fn(async () => ({ email: 'admin@example.test', name: 'Admin Example' })),
  requireSession: vi.fn(async () => ({ email: 'admin@example.test', name: 'Admin Example' })),
  getSession: vi.fn(async () => ({ email: 'admin@example.test' }))
}))
const xero = []
vi.mock('./_xeroClient.js', () => ({ submitToXero: vi.fn(async a => { xero.push(a.id); return {} }) }))
vi.mock('./_googleCalendar.js', () => ({ addCalendarEvent: vi.fn(async () => ({})) }))
const mail = []
vi.mock('./_email.js', () => ({
  sendApprovalEmail: vi.fn(async () => {}), sendDeclineEmail: vi.fn(async () => {}),
  sendMeetingSummaryEmail: vi.fn(async s => { mail.push(s.email) })
}))
vi.mock('../src/staffConfig.js', async () => ({
  STAFF: [{ name: 'Pat Example', email: 'pat@example.test' }, { name: 'Alex Example', email: 'alex@example.test' }],
  isSameStaff: () => false, firstNameFor: () => 'Pat'
}))

const { default: leave } = await import('./admin/action.js')
const { default: meetingsAgent } = await import('./meetings/agent.js')

const run = (handler, req) => new Promise(resolve => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json(d) { resolve({ status: this.statusCode, data: d }) }, setHeader() {} }
  handler({ method: 'POST', headers: {}, query: {}, ...req }, res)
})

beforeEach(() => { store.clear(); apps.clear(); meetings.clear(); xero.length = 0; mail.length = 0 })

describe('approving leave', () => {
  it('goes to Xero once when two approvals arrive together', async () => {
    apps.set('L1', { id: 'L1', status: 'pending', staffName: 'Pat Example' })
    const [a, b] = await Promise.all([
      run(leave, { body: { id: 'L1', action: 'approve' } }),
      run(leave, { body: { id: 'L1', action: 'approve' } })
    ])
    expect(xero).toEqual(['L1'])
    expect([a.status, b.status].sort()).toEqual([200, 409])
  })
})

describe('sending meeting minutes', () => {
  it('emails the team once', async () => {
    meetings.set('M1', { id: 'M1', title: 'Weekly', date: '2026-11-06', status: 'reviewing' })
    const body = { meetingId: 'M1', actionItems: [{ task: 'Order screws', assignee: 'Pat' }] }
    const first = await run(meetingsAgent, { query: { action: 'finalize' }, body })
    expect(first.status).toBe(200)
    const again = await run(meetingsAgent, { query: { action: 'finalize' }, body })
    expect(again.status).toBe(409)
    expect(mail).toHaveLength(2)
  })
})
