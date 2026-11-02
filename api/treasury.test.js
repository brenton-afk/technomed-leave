import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'

// ─── Treasury: who gets in, and what is written down ─────────────────────────
// Only the people on TREASURY_USERS, only after Face ID or the PIN, and
// everybody else is told the page does not exist. Every figure here is made up.

const store = new Map()
const lists = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, ...args) => {
    if (cmd === 'get') return store.get(args[0]) ?? null
    if (cmd === 'set') { store.set(args[0], args[1]); return 'OK' }
    if (cmd === 'del') { store.delete(args[0]); return 1 }
    if (cmd === 'expire') return 1
    if (cmd === 'lpush') { lists.set(args[0], [args[1], ...(lists.get(args[0]) || [])]); return 1 }
    if (cmd === 'ltrim') return 'OK'
    if (cmd === 'lrange') return lists.get(args[0]) || []
    throw new Error(`unexpected ${cmd}`)
  }),
  redisSetBody: vi.fn(async (k, v) => { store.set(k, v); return 'OK' })
}))

const { default: handler } = await import('./treasury.js')
const { tget, readAudit } = await import('./_treasuryStore.js')

const BRENT = 'brenton@technomed.com.au'
const ERIN = 'erin@technomed.com.au'

function session(email, { ageMs = 0 } = {}) {
  const token = randomBytes(8).toString('hex')
  store.set(`session:${token}`, JSON.stringify({ email, name: email, isAdmin: true, createdAt: new Date(Date.now() - ageMs).toISOString() }))
  return token
}

function call({ action, method = 'GET', token, body, query = {}, headers = {} }) {
  const res = {
    statusCode: 200, headers: {}, body: undefined, redirected: null,
    status(c) { this.statusCode = c; return this },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this },
    json(b) { this.body = b; return this },
    send(b) { this.body = b; return this },
    redirect(code, url) { this.statusCode = code; this.redirected = url; return this }
  }
  const req = {
    method, body, query: { action, ...query },
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }
  }
  return Promise.resolve(handler(req, res)).then(() => res)
}

async function unlocked(email = BRENT) {
  const main = session(email, { ageMs: 5 * 86400e3 })
  const proof = session(email)
  const r = await call({ action: 'unlock', method: 'POST', token: proof, body: { mainToken: main } })
  expect(r.statusCode).toBe(200)
  return main
}

const NOT_FOUND = 'The page could not be found\n\nNOT_FOUND\n'

beforeEach(() => {
  store.clear(); lists.clear()
  process.env.TREASURY_USERS = BRENT
  process.env.TREASURY_ENC_KEY = randomBytes(32).toString('base64')
  process.env.CRON_SECRET = 'cron-test-secret'
  // No network in tests: every outside source is down.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
})
afterEach(() => vi.unstubAllGlobals())

describe('anyone not on the list is told it does not exist', () => {
  it('signed out', async () => {
    const r = await call({ action: 'home' })
    expect(r.statusCode).toBe(404)
    expect(r.body).toBe(NOT_FOUND)
  })

  it('another admin, even with a fresh sign-in', async () => {
    const r = await call({ action: 'access', token: session(ERIN) })
    expect(r.statusCode).toBe(404)
    expect(r.body).toBe(NOT_FOUND)
    const u = await call({ action: 'unlock', method: 'POST', token: session(ERIN), body: { mainToken: session(ERIN) } })
    expect(u.statusCode).toBe(404)
  })

  it('an unknown action is the same 404 as a refusal', async () => {
    const r = await call({ action: 'nope', token: session(ERIN) })
    expect(r.body).toBe(NOT_FOUND)
  })

  it('nobody at all when TREASURY_USERS is unset — it fails closed', async () => {
    delete process.env.TREASURY_USERS
    const r = await call({ action: 'access', token: session(BRENT) })
    expect(r.statusCode).toBe(404)
  })

  it('takes a second person from the list', async () => {
    process.env.TREASURY_USERS = `${BRENT}, marketing@technomed.com.au`
    const r = await call({ action: 'access', token: session('marketing@technomed.com.au') })
    expect(r.body).toEqual({ allowed: true, unlocked: false })
  })
})

describe('the Face ID step-up is the server’s, not the phone’s', () => {
  it('an allowed session that has not unlocked sees nothing', async () => {
    const t = session(BRENT, { ageMs: 86400e3 })
    expect((await call({ action: 'access', token: t })).body).toEqual({ allowed: true, unlocked: false })
    const r = await call({ action: 'home', token: t })
    expect(r.statusCode).toBe(403)
    expect(r.body).toEqual({ locked: true })
  })

  it('a sign-in from minutes ago unlocks the main session, and is then destroyed', async () => {
    const main = session(BRENT, { ageMs: 86400e3 })
    const proof = session(BRENT)
    await call({ action: 'unlock', method: 'POST', token: proof, body: { mainToken: main } })
    expect(store.has(`session:${proof}`)).toBe(false)
    expect((await call({ action: 'access', token: main })).body.unlocked).toBe(true)
    expect((await call({ action: 'home', token: main })).statusCode).toBe(200)
  })

  it('an old session cannot be passed off as the proof', async () => {
    const main = session(BRENT, { ageMs: 86400e3 })
    const old = session(BRENT, { ageMs: 10 * 60e3 })
    const r = await call({ action: 'unlock', method: 'POST', token: old, body: { mainToken: main } })
    expect(r.statusCode).toBe(404)
  })

  it('lock ends it', async () => {
    const t = await unlocked()
    await call({ action: 'lock', method: 'POST', token: t })
    expect((await call({ action: 'home', token: t })).statusCode).toBe(403)
  })
})

describe('audit', () => {
  it('records refusals and access, encrypted', async () => {
    await call({ action: 'home', token: session(ERIN) })
    const t = await unlocked()
    await call({ action: 'home', token: t, query: { page: 'home' } })
    const log = await readAudit()
    expect(log.find(e => e.email === ERIN)).toMatchObject({ action: 'home', ok: false })
    expect(log.find(e => e.email === BRENT && e.action === 'home')).toMatchObject({ ok: true, page: 'home' })
    for (const raw of lists.get('treasury:audit')) expect(raw).not.toContain('technomed')
  })
})

describe('storage', () => {
  it('nothing is written in plain text', async () => {
    const t = await unlocked()
    await call({ action: 'settings-save', method: 'POST', token: t, body: { settings: { amberCash: 12345, baseWeekly: 1000 } } })
    await call({ action: 'trust-save', method: 'POST', token: t, body: { entry: { date: '2026-08-01', amount: 999, category: 'Distribution', party: 'Fake Beneficiary' } } })
    for (const [k, v] of store) {
      if (!k.startsWith('treasury:') || k.startsWith('treasury:unlock:')) continue
      expect(v).not.toMatch(/12345|Fake Beneficiary|amberCash/)
    }
    expect((await tget('settings')).amberCash).toBe(12345)
  })

  it('says what is missing rather than failing obscurely without a key', async () => {
    const t = await unlocked()
    delete process.env.TREASURY_ENC_KEY
    const r = await call({ action: 'settings-save', method: 'POST', token: t, body: { settings: { amberCash: 1 } } })
    expect(r.statusCode).toBe(503)
    expect(r.body.error).toMatch(/TREASURY_ENC_KEY/)
  })

  it('a write sent as a GET does nothing', async () => {
    const t = await unlocked()
    const r = await call({ action: 'settings-save', token: t, body: { settings: { amberCash: 5 } } })
    expect(r.statusCode).toBe(404)
    expect(await tget('settings')).toBe(null)
  })
})

describe('the requests that come without a session', () => {
  it('cron needs CRON_SECRET', async () => {
    expect((await call({ action: 'cron' })).statusCode).toBe(404)
    expect((await call({ action: 'cron', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(404)
    const ok = await call({ action: 'cron', headers: { authorization: 'Bearer cron-test-secret' } })
    expect(ok.statusCode).toBe(200)
  })

  it('cron is not open when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET
    expect((await call({ action: 'cron', headers: { authorization: 'Bearer undefined' } })).statusCode).toBe(404)
  })

  it('the Xero callback ignores a state it did not issue', async () => {
    const r = await call({ action: 'xero-callback', query: { state: 'x'.repeat(32), code: 'abc' } })
    expect(r.statusCode).toBe(404)
  })
})

describe('when every source is down', () => {
  it('home still answers, with nothing invented', async () => {
    const t = await unlocked()
    const r = await call({ action: 'home', token: t })
    expect(r.statusCode).toBe(200)
    expect(r.body.price).toBe(null)
    expect(r.body.dca.plan.ready).toBe(false)
    expect(r.body.xero.status.connected).toBe(false)
  })
})

describe('DCA logging', () => {
  it('logs the buy, adds the sats to the entity and takes it off Amber cash; delete undoes it', async () => {
    const t = await unlocked()
    await call({ action: 'settings-save', method: 'POST', token: t, body: { settings: { amberCash: 10000, dcaEntity: 'personal' } } })
    const r = await call({ action: 'dca-log', method: 'POST', token: t, body: { aud: 1000, priceAud: 100000 } })
    expect(r.body.entry).toMatchObject({ aud: 1000, sats: 1_000_000, entity: 'personal' })
    expect((await tget('settings')).amberCash).toBe(9000)
    expect((await tget('holdings')).personal.exchangeSats).toBe(1_000_000)
    const again = await call({ action: 'dca-log', method: 'POST', token: t, body: { aud: 1000, priceAud: 100000 } })
    expect(again.statusCode).toBe(409)
    await call({ action: 'dca-delete', method: 'POST', token: t, body: { id: r.body.entry.id } })
    expect((await tget('settings')).amberCash).toBe(10000)
    expect((await tget('holdings')).personal.exchangeSats).toBe(0)
  })
})

describe('holdings', () => {
  it('refuses an amount no entity could hold — a decimal point read the wrong way', async () => {
    const t = await unlocked()
    const r = await call({ action: 'holdings-save', method: 'POST', token: t, body: { holdings: { smsf: { exchangeSats: 420005325 * 1e8 } } } })
    expect(r.statusCode).toBe(400)
    expect(r.body.error).toMatch(/SMSF/)
    const ok = await call({ action: 'holdings-save', method: 'POST', token: t, body: { holdings: { smsf: { exchangeSats: 420005325, costAud: '$1,000' } } } })
    expect(ok.body.holdings.smsf).toEqual({ exchangeSats: 420005325, coldSats: 0, costAud: 1000, amberAud: 0 })
  })
})

describe('Amber cash per entity', () => {
  it('saves each entity\'s cash; the DCA entity\'s is the DCA screen\'s figure', async () => {
    const t = await unlocked()
    await call({ action: 'settings-save', method: 'POST', token: t, body: { settings: { amberCash: 5000, dcaEntity: 'company' } } })
    await call({ action: 'holdings-save', method: 'POST', token: t, body: { holdings: {
      company: { exchangeSats: 1, amberAud: 6000 }, smsf: { coldSats: 2, amberAud: '$1,436.70' }
    } } })
    expect((await tget('settings')).amberCash).toBe(6000)
    expect((await tget('holdings')).smsf.amberAud).toBe(1436.7)
    const h = await call({ action: 'holdings', token: t })
    expect(h.body.view.total.amberAud).toBeCloseTo(7436.7)
    // A save that does not mention Amber cash leaves it alone.
    await call({ action: 'holdings-save', method: 'POST', token: t, body: { holdings: { smsf: { coldSats: 3 } } } })
    expect((await tget('holdings')).smsf.amberAud).toBe(1436.7)
  })
})

describe('import', () => {
  const FILE = {
    ato: [{ label: 'BAS Q1', amount: '1,234.00', due: '28/10/2026', status: 'due' }],
    dca: [{ date: '2026-09-01', aud: 500, sats: 400000 }],
    trustLog: [{ date: '2026-07-15', amount: 100, category: 'Distribution', party: 'Beneficiary A' }],
    todo: ['call someone'],
    inv: [{ n: 1 }]
  }

  it('previews without saving, then saves once even if sent twice', async () => {
    const t = await unlocked()
    const p = await call({ action: 'import-preview', method: 'POST', token: t, body: { json: FILE } })
    expect(p.body.counts).toMatchObject({ ato: 1, dca: 1, trust: 1 })
    expect(p.body.report.unmapped.map(u => u.key)).toEqual(['todo', 'inv'])
    expect(await tget('ato')).toBe(null)
    await call({ action: 'import-commit', method: 'POST', token: t, body: { json: FILE } })
    const second = await call({ action: 'import-commit', method: 'POST', token: t, body: { json: FILE } })
    expect(second.body.added).toMatchObject({ ato: 0, dca: 0, trust: 0 })
    expect(await tget('ato')).toHaveLength(1)
  })
})
