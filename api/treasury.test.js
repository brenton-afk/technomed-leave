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

describe('correcting a logged buy', () => {
  it('moves holdings and Amber cash with the correction, not just the log', async () => {
    const t = await unlocked()
    await call({ action: 'settings-save', method: 'POST', token: t, body: { settings: { amberCash: 10000, dcaEntity: 'company' } } })
    const logged = await call({ action: 'dca-log', method: 'POST', token: t, body: { aud: 2000, sats: 2000000 } })
    expect(logged.body.entry).toMatchObject({ aud: 2000, sats: 2000000, priceAud: 100000, entity: 'company' })
    expect((await tget('settings')).amberCash).toBe(8000)

    // Actually bought 1,500 worth, for the SMSF.
    const id = logged.body.entry.id
    const r = await call({ action: 'dca-edit', method: 'POST', token: t, body: { id, date: logged.body.entry.date, aud: '1,500', sats: '1400000', entity: 'smsf' } })
    expect(r.body.entry).toMatchObject({ aud: 1500, sats: 1400000, entity: 'smsf', id })
    const h = await tget('holdings')
    expect(h.company).toMatchObject({ exchangeSats: 0, costAud: 0 })
    expect(h.smsf).toMatchObject({ exchangeSats: 1400000, costAud: 1500 })
    expect((await tget('settings')).amberCash).toBe(8500)
    expect(await tget('dca')).toHaveLength(1)
  })

  it('a past buy entered by hand stays in the log only, and does not block this week', async () => {
    const t = await unlocked()
    await call({ action: 'settings-save', method: 'POST', token: t, body: { settings: { amberCash: 1000 } } })
    const today = (await call({ action: 'dca', token: t })).body.today
    await call({ action: 'dca-entry', method: 'POST', token: t, body: { date: today, aud: 300, sats: 300000, entity: 'personal' } })
    expect(await tget('holdings')).toBe(null)
    expect((await call({ action: 'dca', token: t })).body.loggedThisWeek).toBe(null)
    const r = await call({ action: 'dca-log', method: 'POST', token: t, body: { aud: 100, sats: 100000 } })
    expect(r.statusCode).toBe(200)
  })
})

describe('snapshots can be corrected and deleted', () => {
  it('edits figures, clears a blank one, and deletes', async () => {
    const t = await unlocked()
    const snap = await call({ action: 'snapshot-now', method: 'POST', token: t })
    const month = snap.body.snapshot.month
    const r = await call({ action: 'snapshot-save', method: 'POST', token: t, body: { snapshot: { month, cash: '$12,000', totalBtc: '1,5', amberCash: '' } } })
    expect(r.body.list[0]).toMatchObject({ month, cash: 12000, totalSats: 150_000_000, amberCash: null })
    const d = await call({ action: 'snapshot-delete', method: 'POST', token: t, body: { month } })
    expect(d.body.list).toEqual([])
  })
})

describe('the Amber import', () => {
  const CSV = [
    'datetime_hobart,type,status,aud_amount,btc_amount,price_aud_per_btc,fee_aud',
    '2026-10-01 09:00:00,buy_on_deposit,settled,5000,0.05,100000,10',
    '2026-10-02 15:03:00,buy_recurring,settled,150,0.0015,100000,0.3',
    '2026-10-03 10:00:00,send_to_cold_storage,settled,,0.04,,',
    '2026-10-04 10:00:00,buy,pending,999,0.009,111000,1'
  ].join('\n')

  it('previews, imports, feeds TechnoMed\'s BTC on Amber, and re-imports without doubling', async () => {
    const t = await unlocked()
    await call({ action: 'holdings-save', method: 'POST', token: t, body: { holdings: { company: { exchangeSats: 123, coldSats: 400_000_000 } } } })
    const p = await call({ action: 'amber-preview', method: 'POST', token: t, body: { csv: CSV } })
    expect(p.body).toMatchObject({ added: 3, skippedCount: 1, file: { purchases: 2, invested: 5150, boughtSats: 5_150_000, sentSats: 4_000_000 } })
    expect(await tget('amber')).toBe(null)

    const c = await call({ action: 'amber-commit', method: 'POST', token: t, body: { csv: CSV } })
    expect(c.body.added).toBe(3)
    expect((await call({ action: 'amber-commit', method: 'POST', token: t, body: { csv: CSV } })).body.added).toBe(0)

    const h = await call({ action: 'holdings', token: t })
    const company = h.body.view.rows.find(r => r.id === 'company')
    expect(company).toMatchObject({ exchangeSats: 1_150_000, coldSats: 400_000_000 })
    expect(h.body.amberFed.entity).toBe('company')

    const r = await call({ action: 'purchases', token: t })
    expect(r.body.totals).toMatchObject({ purchases: 2, atAmberSats: 1_150_000 })
    expect(JSON.stringify(await tget('amber'))).not.toMatch(/pending/)
  })

  it('once imported, buys are not also recorded by hand on the DCA screen', async () => {
    const t = await unlocked()
    await call({ action: 'amber-commit', method: 'POST', token: t, body: { csv: CSV } })
    const r = await call({ action: 'dca-log', method: 'POST', token: t, body: { aud: 100, sats: 1000 } })
    expect(r.statusCode).toBe(400)
    expect(r.body.error).toMatch(/Amber import/)
  })

  it('refuses a file that is not an Amber export', async () => {
    const t = await unlocked()
    const r = await call({ action: 'amber-preview', method: 'POST', token: t, body: { csv: 'a,b\n1,2' } })
    expect(r.statusCode).toBe(400)
  })

  it('a transfer in is kept apart from purchases', async () => {
    const t = await unlocked()
    const r = await call({ action: 'transfer-save', method: 'POST', token: t, body: { transfer: { date: '2026-10-04', btc: '1,5', valueAud: '150000', from: 'Family trust' } } })
    expect(r.body.list[0]).toMatchObject({ sats: 150_000_000, priceAud: 100000, valueAud: 150000, from: 'Family trust' })
    expect((await call({ action: 'purchases', token: t })).body.transfers).toHaveLength(1)
  })
})

describe('the transfer form, as the phone sends it', () => {
  it('saves a new transfer typed in by hand', async () => {
    const t = await unlocked()
    const r = await call({ action: 'transfer-save', method: 'POST', token: t, body: { transfer: {
      date: '2026-10-04', btc: '1.71283228', priceAud: '122227.48', valueAud: '209361', from: 'Family trust', note: ''
    } } })
    expect(r.statusCode).toBe(200)
    expect(r.body.list[0]).toMatchObject({ sats: 171283228, priceAud: 122227.48, valueAud: 209361 })
  })

  it('saves an edit of one already there, with the fields the form carries back', async () => {
    const t = await unlocked()
    const first = await call({ action: 'transfer-save', method: 'POST', token: t, body: { transfer: { date: '2026-10-04', btc: '1.7', valueAud: '200000' } } })
    const saved = first.body.list[0]
    const r = await call({ action: 'transfer-save', method: 'POST', token: t, body: { transfer: {
      ...saved, btc: '1.71283228', priceAud: '122227.48', valueAud: '209361', from: 'Family trust', note: 'In specie'
    } } })
    expect(r.statusCode).toBe(200)
    expect(r.body.list).toHaveLength(1)
    expect(r.body.list[0]).toMatchObject({ id: saved.id, sats: 171283228, valueAud: 209361 })
  })

  it('a value typed with a $ and commas', async () => {
    const t = await unlocked()
    const r = await call({ action: 'transfer-save', method: 'POST', token: t, body: { transfer: { date: '2026-10-04', btc: '1.71283228', priceAud: '$122,227.48', valueAud: '$209,361' } } })
    expect(r.statusCode).toBe(200)
  })
})

describe('SelfWealth cash reports', () => {
  // Invented report pieces, positioned as the phone sends them.
  const piece = (y, x, s) => ({ p: 1, x, y, s })
  const report = [
    piece(720, 164, 'Opening Balance'), piece(720, 514, '$100.00'),
    piece(690, 60, '2 July 2025 23:30:01'), piece(690, 164, 'Order 1: Buy 10 MSTY @ US$5.00'), piece(690, 455, '$50.00'), piece(690, 513, '$50.00'),
    piece(660, 60, '8 July 2025 00:00:00'), piece(660, 164, '10 MSTY CASHDIV @ USD 1.00'), piece(660, 384, '$10.00'), piece(660, 513, '$60.00'),
    piece(630, 164, 'Closing Balance at end of day 30 June 2026'), piece(630, 513, '$60.00')
  ]

  it('previews, imports once, and builds holdings and income', async () => {
    const t = await unlocked()
    const p = await call({ action: 'sw-preview', method: 'POST', token: t, body: { items: report } })
    expect(p.body).toMatchObject({ reconciles: true, rows: 2, added: 2, currency: 'USD' })
    await call({ action: 'sw-commit', method: 'POST', token: t, body: { items: report } })
    expect((await call({ action: 'sw-commit', method: 'POST', token: t, body: { items: report } })).body.added).toBe(0)
    await call({ action: 'inv-price-save', method: 'POST', token: t, body: { ticker: 'msty', price: '6' } })
    const inv = await call({ action: 'investments', token: t })
    expect(inv.body.holdings[0]).toMatchObject({ ticker: 'MSTY', units: 10, costUsd: 50 })
    expect(inv.body.income[0]).toMatchObject({ fy: 'FY26', gross: 10, net: 10 })
    expect(inv.body.prices.MSTY.price).toBe(6)
    expect(inv.body.cash).toEqual({ usd: 60, at: '2025-07-08' })
  })

  it('refuses a report that does not add up', async () => {
    const t = await unlocked()
    const broken = report.map(i => (i.s === '$60.00' && i.y === 630 ? { ...i, s: '$61.00' } : i))
    const r = await call({ action: 'sw-commit', method: 'POST', token: t, body: { items: broken } })
    expect(r.statusCode).toBe(400)
    expect(await tget('selfwealth')).toBe(null)
  })

  it('keeps opening positions and consolidations, one of each per ticker and date', async () => {
    const t = await unlocked()
    await call({ action: 'inv-opening-save', method: 'POST', token: t, body: { opening: { ticker: 'msty', units: '3,999', costUsd: '$1,000' } } })
    await call({ action: 'inv-action-save', method: 'POST', token: t, body: { action: { ticker: 'MSTY', date: '2025-12-15', ratio: 5 } } })
    const bad = await call({ action: 'inv-action-save', method: 'POST', token: t, body: { action: { ticker: 'MSTY', date: '2025-12-15', ratio: 1 } } })
    expect(bad.statusCode).toBe(400)
    expect(await tget('invopenings')).toEqual([expect.objectContaining({ ticker: 'MSTY', units: 3999, costUsd: 1000 })])
    expect(await tget('invactions')).toEqual([expect.objectContaining({ ticker: 'MSTY', ratio: 5 })])
  })
})

describe('return of capital', () => {
  it('is worked out on the investments, with its share saved per year', async () => {
    const t = await unlocked()
    const piece = (y, x, s) => ({ p: 1, x, y, s })
    const report = [
      piece(720, 164, 'Opening Balance'), piece(720, 514, '$100.00'),
      piece(690, 60, '2 July 2025 23:30:01'), piece(690, 164, 'Order 1: Buy 10 MSTY @ US$5.00'), piece(690, 455, '$50.00'), piece(690, 513, '$50.00'),
      piece(660, 60, '8 Aug 2025 00:00:00'), piece(660, 164, '10 MSTY CASHDIV @ USD 1.00'), piece(660, 384, '$10.00'), piece(660, 513, '$60.00'),
      piece(630, 164, 'Closing Balance at end of day 30 June 2026'), piece(630, 513, '$60.00')
    ]
    await call({ action: 'sw-commit', method: 'POST', token: t, body: { items: report } })
    const bad = await call({ action: 'roc-save', method: 'POST', token: t, body: { roc: { years: { 2025: 140 } } } })
    expect(bad.statusCode).toBe(400)
    await call({ action: 'roc-save', method: 'POST', token: t, body: { roc: { years: { 2025: '50' }, final: ['2025'], overrides: { '2025-08-08': '80' } } } })
    const inv = await call({ action: 'investments', token: t })
    const [r] = inv.body.roc
    expect(inv.body.rocCfg).toMatchObject({ years: { 2025: 50 }, final: ['2025'], overrides: { '2025-08-08': 80 } })
    expect(r.payments[0]).toMatchObject({ pct: 80, basis: 'payment' })
    expect(r.totals.parcels).toBe(1)
  })
})

describe('buys brought in from the old tracker', () => {
  it('are history: removing one does not touch holdings or Amber cash', async () => {
    const t = await unlocked()
    await call({ action: 'settings-save', method: 'POST', token: t, body: { settings: { amberCash: 1000 } } })
    await call({ action: 'holdings-save', method: 'POST', token: t, body: { holdings: { company: { coldSats: 500_000_000, costAud: 50000 } } } })
    await call({ action: 'import-commit', method: 'POST', token: t, body: { json: { dca: { log: [{ a: 200, b: 0.002, d: '2026-10-30' }] } } } })
    const [entry] = await tget('dca')
    expect(entry.manual).toBe(true)
    await call({ action: 'dca-delete', method: 'POST', token: t, body: { id: entry.id } })
    expect((await tget('holdings')).company).toMatchObject({ coldSats: 500_000_000, costAud: 50000 })
    expect((await tget('settings')).amberCash).toBe(1000)
  })

  it('even ones imported before they were marked', async () => {
    const t = await unlocked()
    await call({ action: 'settings-save', method: 'POST', token: t, body: { settings: { amberCash: 1000 } } })
    await call({ action: 'holdings-save', method: 'POST', token: t, body: { holdings: { company: { exchangeSats: 1000, costAud: 500 } } } })
    // The shape the first importer wrote: no `manual`, no `multiplier`.
    const { tset } = await import('./_treasuryStore.js')
    await tset('dca', [{ id: 'old1', date: '2026-10-30', week: '2026-10-26', aud: 200, sats: 1000, priceAud: 1, entity: 'company', note: '' }])
    await call({ action: 'dca-delete', method: 'POST', token: t, body: { id: 'old1' } })
    expect((await tget('holdings')).company.exchangeSats).toBe(1000)
    expect((await tget('settings')).amberCash).toBe(1000)
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
