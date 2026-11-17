import { describe, it, expect, vi, beforeEach } from 'vitest'

// What is in situ, looked up and sent to the team leader a week out (Brent,
// 17 Nov 2026). Invented patients only.

const store = new Map()
const records = []
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, ...args) => {
    if (cmd === 'mget') return args.map(k => store.get(k) ?? null)
    if (cmd === 'set') {
      const [k, v, nx] = args
      if (nx === 'NX' && store.has(k)) return null
      store.set(k, v); return 'OK'
    }
    if (cmd === 'del') { store.delete(args[0]); return 1 }
    if (cmd === 'expire') return 1
    return null
  }),
  redisSetBody: vi.fn(async (k, v) => { store.set(k, v) }),
  getUsageRecordsBulk: vi.fn(async () => records)
}))
const dropbox = { on: false, found: [] }
vi.mock('./_dropbox.js', () => ({
  dropboxConfigured: () => true,
  usageReadsAllowed: () => dropbox.on,
  searchUsage: vi.fn(async () => dropbox.found)
}))

const { lookupInSitu, inSituFor, confirmInSitu, inSituAlerts } = await import('./_inSitu.js')

const CASE = { id: 'evt1', patient: 'Testa', surgeon: 'Thani', date: '2026-11-24', hospital: 'CLV', operation: 'Extension of L4-5 fusion to L3', inSitu: 'extension' }
const USAGE = {
  id: 'u1', patientSurname: 'Testa', date: '2025-03-12', surgeonSurname: 'Thani', hospital: 'CLV',
  items: [{ productName: 'Signus Diplomat pedicle screw', quantity: 4 }, { productName: 'Signus Diplomat rod', quantity: 2 }]
}

beforeEach(() => { store.clear(); records.length = 0; dropbox.on = false; dropbox.found = [] })

describe('looking it up', () => {
  it('reads the portal usage and keeps the answer', async () => {
    records.push(USAGE)
    const a = await lookupInSitu(CASE)
    expect(a.sentence).toBe('Last usage (Thani, Calvary, 12 Mar 2025): Diplomat — 4 screws, 2 rods.')
    expect(JSON.parse(store.get('insitu:evt1')).status).toBe('found')
  })

  it('does not search Dropbox while the usage folders are locked', async () => {
    const a = await lookupInSitu(CASE)
    expect(a.status).toBe('not-checked')
  })

  it('says "No usage in Dropbox" when Dropbox was searched and had nothing', async () => {
    dropbox.on = true
    const a = await lookupInSitu(CASE)
    expect(a.sentence).toBe('No usage in Dropbox.')
  })

  it('finds an older case in Dropbox, from before the portal', async () => {
    dropbox.on = true
    dropbox.found = [{ name: 'Testa 29.09.24 Thani Diplomat PSF CLV', path: '/ALL SURGEON USAGE/SPINE/Thani/September 2024/Testa 29.09.24 Thani Diplomat PSF CLV' }]
    const a = await lookupInSitu(CASE)
    expect(a.sentence).toMatch(/^Last usage in Dropbox \(Thani, Calvary, 29 Sep 2024\): Diplomat/)
  })

  it('reuses a stored answer and carries the confirmation', async () => {
    records.push(USAGE)
    await lookupInSitu(CASE)
    records.length = 0
    await confirmInSitu(CASE, 'same', { name: 'Aimee Vulinovich' })
    const out = await inSituFor([CASE])
    expect(out.evt1.status).toBe('found')
    expect(out.evt1.confirmed).toMatchObject({ answer: 'same', by: 'Aimee Vulinovich' })
  })

  it('a confirmation made for another patient on that booking does not count', async () => {
    await confirmInSitu(CASE, 'none-confirmed', { name: 'Ben' })
    const out = await inSituFor([{ ...CASE, patient: 'Rossi' }])
    expect(out.evt1.confirmed).toBeNull()
  })

  it('refuses an answer it does not know', async () => {
    await expect(confirmInSitu(CASE, 'maybe', {})).rejects.toThrow(/Unknown answer/)
  })
})

describe('a week before, to the team leader on shift', () => {
  const deps = sent => ({
    today: '2026-11-17',
    addDays: (d, n) => (n === 7 ? '2026-11-24' : d),
    casesOn: async day => (day === '2026-11-24' ? [CASE, { ...CASE, id: 'evt2', inSitu: null }] : []),
    leaderEmailOn: async day => (day === '2026-11-17' ? 'mat@technomed.com.au' : null),
    send: async m => { sent.push(m) },
    ready: true
  })

  it('emails the answer for each in-situ case seven days out, once', async () => {
    records.push(USAGE)
    const sent = []
    const r = await inSituAlerts(deps(sent))
    expect(r).toMatchObject({ day: '2026-11-24', alerted: 1, to: 'mat@technomed.com.au' })
    expect(sent[0].answer.sentence).toMatch(/Diplomat/)
    await inSituAlerts(deps(sent))
    expect(sent).toHaveLength(1)
  })

  it('waits for the Dropbox usage search before emailing anyone', async () => {
    const sent = []
    const r = await inSituAlerts({ ...deps(sent), ready: false })
    expect(r.skipped).toMatch(/Dropbox/)
    expect(sent).toHaveLength(0)
  })

  it('tries again tomorrow if the email failed', async () => {
    const fail = { ...deps([]), send: async () => { throw new Error('Resend down') } }
    const r = await inSituAlerts(fail)
    expect(r.failed).toHaveLength(1)
    const sent = []
    await inSituAlerts(deps(sent))
    expect(sent).toHaveLength(1)
  })
})
