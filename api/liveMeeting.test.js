import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanSuggestions, openTaskBrief, readJsonObject, suggestionPrompt, recorderActive } from '../src/projects/liveMeeting.js'

// ─── The live meeting (Brent, 11 Nov 2026) ───────────────────────────────────
// What is said becomes suggestions; nothing reaches the board until a person
// taps Accept. Invented tasks only.

const kv = new Map()
const store = { items: new Map(), projects: new Map(), meetings: new Map() }
let modelAnswer = '{"suggestions":[]}'

vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, key, value, ...rest) => {
    if (cmd === 'get') return kv.has(key) ? kv.get(key) : null
    if (cmd === 'del') { kv.delete(key); return 1 }
    if (cmd === 'set') {
      if (rest.includes('NX') && kv.has(key)) return null
      kv.set(key, value); return 'OK'
    }
    return null
  }),
  redisSetBody: vi.fn(async (key, value) => { kv.set(key, value) }),
  saveProject: vi.fn(), getProject: vi.fn(async id => store.projects.get(id) || null),
  getProjects: vi.fn(async () => [...store.projects.values()]),
  saveWorklistItem: vi.fn(async i => { store.items.set(i.id, JSON.parse(JSON.stringify(i))) }),
  getWorklist: vi.fn(async () => ({ items: [...store.items.values()], unreadable: [] })),
  getWorklistItem: vi.fn(async id => store.items.get(id) || null),
  updateWorklistItem: vi.fn(), deleteWorklistItem: vi.fn(),
  saveMeeting: vi.fn(async (id, m) => { store.meetings.set(id, m) }),
  getMeeting: vi.fn(), getAllMeetings: vi.fn(async () => []), updateMeetingStatus: vi.fn()
}))
vi.mock('./_auth.js', () => ({
  requireSession: vi.fn(async () => ({ name: 'Erin Smallbon', email: 'erin@technomed.com.au' })),
  getSession: vi.fn()
}))
vi.mock('./_anthropic.js', () => ({ askClaude: vi.fn(async () => ({ content: [{ type: 'text', text: modelAnswer }] })) }))
vi.mock('./_readDictatedBooking.js', () => ({ transcribe: vi.fn(async () => 'Mat said the plates are ordered') }))
vi.mock('./_taskDone.js', () => ({ settleWorklistItem: vi.fn(async () => []) }))
vi.mock('./_agenda.js', () => ({
  getAgenda: vi.fn(async () => ({ items: [{ title: 'Stock-take' }] })), saveAgenda: vi.fn(), cleanAgenda: vi.fn(),
  canEditAgenda: vi.fn(() => true), agendaActions: vi.fn(), newAgendaFor: vi.fn(),
  isWelcome: vi.fn(() => false), isGeneral: vi.fn(() => false), isNextMeeting: vi.fn(() => false)
}))
vi.mock('./_email.js', () => ({ sendMeetingSummaryEmail: vi.fn() }))
vi.mock('@vercel/blob/client', () => ({ handleUpload: vi.fn() }))

const { default: handler } = await import('./meetings/agent.js')

const call = async (action, method, body) => {
  const res = {
    statusCode: 0, payload: null,
    status(code) { this.statusCode = code; return this },
    json(data) { this.payload = data; return this }
  }
  await handler({ method, query: { action }, body, headers: {} }, res)
  return res
}

beforeEach(() => {
  kv.clear(); store.items.clear(); store.projects.clear(); store.meetings.clear()
  modelAnswer = '{"suggestions":[]}'
})

const open = [{ id: 't1', task: 'Order the plates', assignee: 'Mat Usher', due_date: '' }]
const staffNames = ['Mat Usher', 'Toni Hoppitt']

describe('suggestions are kept only where they make sense', () => {
  it('drops unknown kinds, unknown tasks and invented people', () => {
    const out = cleanSuggestions({ suggestions: [
      { kind: 'new', task: 'Book the stock-take', assignee: 'Somebody Else', due_date: 'next week' },
      { kind: 'done', taskId: 't1', why: 'reported ordered' },
      { kind: 'done', taskId: 'nope' },
      { kind: 'gossip', task: 'x' },
      { kind: 'update', taskId: 't1', assignee: 'Mat Usher' }
    ] }, { openTasks: open, staffNames })
    expect(out.map(s => s.kind)).toEqual(['new', 'done'])
    expect(out[0]).toMatchObject({ assignee: 'Unassigned', due_date: '', status: 'waiting' })
    expect(out[1].task).toBe('Order the plates')
  })
  it('does not offer the same thing twice', () => {
    const first = cleanSuggestions({ suggestions: [{ kind: 'new', task: 'Book the stock-take' }] }, { openTasks: open, staffNames })
    const again = cleanSuggestions({ suggestions: [{ kind: 'new', task: 'book the stock-take!' }] }, { openTasks: open, staffNames, existing: first })
    expect(again).toEqual([])
  })
  it('never puts a private-board or finished task in front of the room', () => {
    const brief = openTaskBrief([
      { id: 'a', task: 'Shared', status: 'open' },
      { id: 'b', task: 'Directors only', status: 'open', projectId: 'p2' },
      { id: 'c', task: 'Finished', status: 'done' }
    ], new Set(['p2']))
    expect(brief.map(t => t.id)).toEqual(['a'])
  })
  it('reads JSON through fences, and asks only about what was just said', () => {
    expect(readJsonObject('```json\n{"suggestions":[]}\n```')).toEqual({ suggestions: [] })
    expect(readJsonObject('no')).toBe(null)
    const p = suggestionPrompt({ chunk: 'Toni will ring Signus', openTasks: open, staffNames, today: '2026-11-11' })
    expect(p).toContain('Toni will ring Signus')
    expect(p).toContain('t1 — Order the plates — Mat Usher')
  })
  it('knows when the recording phone has gone quiet', () => {
    const now = Date.parse('2026-11-11T01:00:00Z')
    expect(recorderActive({ recorder: { name: 'Erin', lastAt: '2026-11-11T00:59:30Z' } }, now)).toBe(true)
    expect(recorderActive({ recorder: { name: 'Erin', lastAt: '2026-11-11T00:50:00Z' } }, now)).toBe(false)
  })
})

describe('a live meeting, over the wire', () => {
  it('turns what was said into suggestions, and only Accept writes to the board', async () => {
    store.items.set('t1', { id: 't1', task: 'Order the plates', assignee: 'Mat Usher', status: 'open', column: 'open' })
    const started = await call('live', 'POST', { title: 'Staff meeting' })
    expect(started.statusCode).toBe(200)
    expect(started.payload.live.openTasks).toBeUndefined()
    expect(started.payload.live.agenda).toEqual(['Stock-take'])

    modelAnswer = JSON.stringify({ suggestions: [
      { kind: 'done', taskId: 't1', why: 'plates ordered' },
      { kind: 'new', task: 'Ring Signus about the drill guide', assignee: 'Toni Hoppitt', due_date: '2026-11-13', why: 'Toni will ring' }
    ] })
    const said = await call('live-say', 'POST', { audio: 'AAAA', contentType: 'audio/webm' })
    expect(said.statusCode).toBe(200)
    expect(said.payload.added).toHaveLength(2)
    expect(store.items.size).toBe(1)

    const live = JSON.parse(kv.get('meeting:live'))
    expect(live.recorder.name).toBe('Erin')
    const [done, fresh] = live.suggestions

    const a = await call('live-act', 'POST', { id: fresh.id, decision: 'accept', edits: { task: 'Ring Signus re drill guide', assignee: 'Toni Hoppitt', due_date: '2026-11-13' } })
    expect(a.statusCode).toBe(200)
    const added = [...store.items.values()].find(t => t.source === 'live')
    expect(added).toMatchObject({ task: 'Ring Signus re drill guide', assignee: 'Toni Hoppitt', sourceMeetingId: live.id })

    // Twice is once.
    expect((await call('live-act', 'POST', { id: fresh.id, decision: 'accept' })).statusCode).toBe(409)

    await call('live-act', 'POST', { id: done.id, decision: 'accept' })
    expect(store.items.get('t1')).toMatchObject({ status: 'done', doneBy: 'Erin' })

    const ended = await call('live', 'DELETE')
    expect(ended.statusCode).toBe(200)
    expect(kv.has('meeting:live')).toBe(false)
    const meeting = store.meetings.get(live.id)
    expect(meeting).toMatchObject({ status: 'sent', live: true })
    expect(meeting.actionItems.map(i => i.task)).toEqual(['Ring Signus re drill guide'])
  })

  it('a skipped suggestion changes nothing, and a typed note works with no recording', async () => {
    await call('live', 'POST', {})
    modelAnswer = '{"suggestions":[{"kind":"new","task":"Draft the Christmas roster"}]}'
    const said = await call('live-say', 'POST', { text: 'Erin to draft the Christmas roster' })
    expect(said.payload.added).toHaveLength(1)
    const live = JSON.parse(kv.get('meeting:live'))
    expect(live.recorder).toBe(null)
    expect(live.lines[0]).toMatchObject({ typed: true, by: 'Erin' })
    await call('live-act', 'POST', { id: said.payload.added[0].id, decision: 'skip' })
    expect(store.items.size).toBe(0)
  })

  it('refuses to listen when no meeting is live', async () => {
    expect((await call('live-say', 'POST', { text: 'hello' })).statusCode).toBe(404)
  })
})
