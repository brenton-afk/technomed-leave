import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = new Map()
const hashes = new Map()
const lists = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, ...a) => {
    const c = cmd.toLowerCase()
    if (c === 'get') return store.get(a[0]) ?? null
    if (c === 'mget') return a.map(k => store.get(k) ?? null)
    if (c === 'set') {
      if (a.includes('NX') && store.has(a[0])) return null
      store.set(a[0], a[1]); return 'OK'
    }
    if (c === 'del') { store.delete(a[0]); return 1 }
    if (c === 'hset') { const h = hashes.get(a[0]) || {}; h[a[1]] = a[2]; hashes.set(a[0], h); return 1 }
    if (c === 'hdel') { delete (hashes.get(a[0]) || {})[a[1]]; return 1 }
    if (c === 'hgetall') return Object.entries(hashes.get(a[0]) || {}).flat()
    if (c === 'lpush') { const l = lists.get(a[0]) || []; l.unshift(a[1]); lists.set(a[0], l); return l.length }
    if (c === 'ltrim') return 'OK'
    if (c === 'lrange') return (lists.get(a[0]) || []).slice(Number(a[1]), Number(a[2]) + 1)
    return null
  }),
  redisSetBody: vi.fn(async (k, v) => { store.set(k, v) }),
  getUsageHistory: vi.fn(async () => []),
  getCaseResupplies: vi.fn(async () => []),
  getBookingQueue: vi.fn(async () => [])
}))

const threads = {}
vi.mock('./_gmail.js', async () => {
  const real = await vi.importActual('./_gmail.js')
  return {
    addressOf: real.addressOf,
    listThreadsOf: vi.fn(async () => Object.keys(threads)),
    threadMetaOf: vi.fn(async (_m, id) => threads[id]),
    readMessageHeadline: vi.fn(async () => ({ text: 'Could you send the invoice for PO LVH0012240?\n\nOn Mon, someone wrote:\n> old stuff' }))
  }
})

const askClaude = vi.fn()
vi.mock('./_anthropic.js', () => ({ askClaude: (...a) => askClaude(...a) }))
vi.mock('./_usageReminders.js', () => ({ owingFor: vi.fn(async () => ({ owing: [] })), caseLine: () => 'A case' }))

const D = await import('./_decisions.js')
const NOW = Date.parse('2026-11-07T00:00:00Z')
const hoursAgo = h => new Date(NOW - h * 3600000).toISOString()

beforeEach(() => {
  store.clear(); hashes.clear(); lists.clear()
  for (const k of Object.keys(threads)) delete threads[k]
  askClaude.mockReset()
})

describe('who may open it', () => {
  it('is Brent alone unless DECISIONS_USERS says otherwise', () => {
    expect(D.mayUseDecisions('brenton@technomed.com.au', {})).toBe(true)
    expect(D.mayUseDecisions('toni@technomed.com.au', {})).toBe(false)
    expect(D.mayUseDecisions('toni@technomed.com.au', { DECISIONS_USERS: 'brenton@technomed.com.au, toni@technomed.com.au' })).toBe(true)
    expect(D.mayUseDecisions('', {})).toBe(false)
  })

  it('reads brenton@, bookings@ and accounts@, each with its owner', () => {
    expect(D.decisionMailboxes({})).toEqual([
      { address: 'brenton@technomed.com.au', owner: 'brent' },
      { address: 'bookings@technomed.com.au', owner: 'leader' },
      { address: 'accounts@technomed.com.au', owner: 'toni' }
    ])
  })
})

describe('what counts as waiting on us', () => {
  const ext = (h, extra = {}) => ({ id: `m${h}`, from: 'Sam Woods <sam.woods@calvarycare.org.au>', subject: 'PO query', at: hoursAgo(h), labelIds: ['INBOX'], ...extra })

  it('a person outside, unanswered for a day', () => {
    expect(D.waitingOnUs([ext(30)], { now: NOW })).toMatchObject({ days: 1 })
  })
  it('not when it only just arrived', () => {
    expect(D.waitingOnUs([ext(3)], { now: NOW })).toBeNull()
  })
  it('not once anyone at TechnoMed has replied, or the mailbox sent the last one', () => {
    expect(D.waitingOnUs([ext(50), ext(30, { from: 'Toni <toni@technomed.com.au>' })], { now: NOW })).toBeNull()
    expect(D.waitingOnUs([ext(50), ext(30, { from: 'x@y.com', labelIds: ['SENT'] })], { now: NOW })).toBeNull()
  })
  it('never robots, calendar replies or out-of-office', () => {
    expect(D.waitingOnUs([ext(30, { from: 'no-reply@xero.com' })], { now: NOW })).toBeNull()
    expect(D.waitingOnUs([ext(30, { from: 'Notifications <notifications@github.com>' })], { now: NOW })).toBeNull()
    expect(D.waitingOnUs([ext(30, { subject: 'Accepted: Spine meeting' })], { now: NOW })).toBeNull()
    expect(D.waitingOnUs([ext(30, { subject: 'Automatic reply: PO query' })], { now: NOW })).toBeNull()
  })
  it('keeps only the new part of an email', () => {
    expect(D.freshText('Hi\nPlease advise\n\nOn Mon 3 Nov 2026, Bob <b@x.com> wrote:\n> earlier')).toBe('Hi\nPlease advise')
  })
})

describe('reviewing a mailbox', () => {
  it('asks once per new message, keeps only what needs action, and remembers the verdict', async () => {
    threads.t1 = [{ id: 'a1', from: 'Sam <sam@calvarycare.org.au>', subject: 'Invoice please', at: hoursAgo(48), labelIds: ['INBOX'] }]
    threads.t2 = [{ id: 'b1', from: 'News <news@supplier.com>', subject: 'November specials', at: hoursAgo(48), labelIds: ['INBOX'] }]
    threads.t3 = [{ id: 'c1', from: 'Rep <rep@supplier.com>', subject: 'Thanks', at: hoursAgo(48), labelIds: ['INBOX'] }]
    askClaude.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify([
      { n: 1, action: true, owner: 'toni', summary: 'Calvary wants the PO invoice', ask: 'Invoice PO', urgency: 'today', draft: 'Hi Sam, attached.' },
      { n: 2, action: false }
    ]) }] })

    const items = await D.reviewMailbox({ address: 'accounts@technomed.com.au', owner: 'toni' }, { now: NOW })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ source: 'email', owner: 'toni', urgency: 'today', waitingDays: 2, draft: 'Hi Sam, attached.' })
    expect(items[0].id).toBe('email:t1:a1')
    // The robot never reached the model; the quoted history was cut off.
    const prompt = askClaude.mock.calls[0][0].request.messages[0].content
    expect(prompt).not.toContain('November specials')
    expect(prompt).not.toContain('old stuff')

    await D.reviewMailbox({ address: 'accounts@technomed.com.au', owner: 'toni' }, { now: NOW })
    expect(askClaude).toHaveBeenCalledTimes(1)
  })

  it('a mailbox that fails keeps what it had and says why', async () => {
    const gmail = await import('./_gmail.js')
    gmail.listThreadsOf.mockRejectedValueOnce(new Error('Not authorised for this mailbox'))
    store.set('decisions:inbox:accounts@technomed.com.au', JSON.stringify({ at: 'earlier', items: [{ id: 'x' }] }))
    const [r] = await D.refreshInboxes({ mailboxes: [{ address: 'accounts@technomed.com.au', owner: 'toni' }], now: NOW })
    expect(r.error).toMatch(/Not authorised/)
    expect(r.items).toEqual([{ id: 'x' }])
  })

  it('an unknown owner from the model falls back to the inbox owner', () => {
    expect(D.cleanVerdict({ action: true, owner: 'nobody', urgency: 'soon' }, 'leader')).toMatchObject({ owner: 'leader', urgency: 'week' })
  })
})

describe('what people do with an item', () => {
  const item = { id: 'email:t1:a1', source: 'email', owner: 'toni', from: 'news@x.com', subject: 'Specials' }

  it('done hides it; later brings it back after three days; open restores it', async () => {
    await D.markItem('b@t', 'Brent', { id: item.id, state: 'done', item }, NOW)
    expect(D.openItems([item], await D.readStates('b@t'), NOW)).toEqual([])
    await D.markItem('b@t', 'Brent', { id: item.id, state: 'later', item }, NOW)
    expect(D.openItems([item], await D.readStates('b@t'), NOW + 86400000)).toEqual([])
    expect(D.openItems([item], await D.readStates('b@t'), NOW + 4 * 86400000)).toEqual([item])
    await D.markItem('b@t', 'Brent', { id: item.id, state: 'open' }, NOW)
    expect(D.openItems([item], await D.readStates('b@t'), NOW)).toEqual([item])
  })

  it('"not needed" on an email becomes a lesson the next review is told', async () => {
    await D.markItem('b@t', 'Brent', { id: item.id, state: 'not-needed', reason: 'supplier marketing', item }, NOW)
    const lessons = await D.readLessons()
    expect(lessons[0]).toMatchObject({ from: 'news@x.com', reason: 'supplier marketing' })
    expect(D.triagePrompt('a@t', 'toni', [], lessons)).toContain('supplier marketing')
  })

  it('refuses a choice it does not know', async () => {
    await expect(D.markItem('b@t', 'Brent', { id: 'x', state: 'delete' })).rejects.toThrow(/Unknown/)
  })

  it('today first, then the longest waiting', () => {
    const r = D.ranked([
      { id: 'a', urgency: 'week', waitingDays: 9 },
      { id: 'b', urgency: 'today', waitingDays: 1 },
      { id: 'c', urgency: 'today', waitingDays: 4 }
    ])
    expect(r.map(i => i.id)).toEqual(['c', 'b', 'a'])
  })
})
