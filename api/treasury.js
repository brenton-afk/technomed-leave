import { redis } from './_redis.js'
import { treasuryGate, unlockTreasury, lockTreasury, notFound } from './_treasuryAccess.js'
import { tokenHash, treasuryKey, TreasuryKeyMissing } from './_treasuryCrypto.js'
import { tget, tset, audit, readAudit } from './_treasuryStore.js'
import { getPrice } from './_treasuryPrice.js'
import { syncOnchain, readOnchain, METRICS } from './_treasuryOnchain.js'
import {
  xeroFigures, connectUrl, consumeState, completeConnect, disconnect, connectionStatus, xeroConfigured
} from './_treasuryXero.js'
import {
  DEFAULT_SETTINGS, ENTITIES, SATS, dcaPlan, latestOf, keyLevels, summaryLine, slice,
  holdingsView, atoOutlook, cashForecast, weekStart, TRUST_CATEGORIES, MAX_BTC, dcaEntityOf
} from '../src/treasury/logic.js'
import { mapTracker } from '../src/treasury/importMap.js'
import { todayStr } from '../src/clinicalPlan/week.js'

// ─── Treasury ────────────────────────────────────────────────────────────────
// One function for the whole section, switched on ?action=, like usage/agent.
//
// Who gets in is decided in _treasuryAccess.js: signed in, on TREASURY_USERS,
// and unlocked with Face ID or the PIN in the last fifteen minutes. Anyone
// else gets the same 404 as a path that does not exist. Every request is
// written to the audit log, refusals included.
//
// Three requests come without a Treasury session, each with its own check:
//   access        → asks whether to show the card; 404 unless allowed
//   xero-callback → Xero's redirect; only a `state` issued here in the last
//                   ten minutes is honoured, otherwise 404
//   cron          → Vercel's schedule; only with CRON_SECRET, otherwise 404
//
// Read-only toward Xero, always. Nothing here pays, posts or edits anything
// there — see _treasuryXero.js.

const BEFORE_UNLOCK = new Set(['access', 'unlock'])

const today = () => todayStr()

// ─── Small validators ────────────────────────────────────────────────────────

const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const money = v => {
  const n = typeof v === 'string' ? Number(v.replace(/[\s$,]/g, '')) : Number(v)
  return Number.isFinite(n) && Math.abs(n) < 1e12 ? Math.round(n * 100) / 100 : null
}
const str = (v, max = 200) => (v == null ? '' : String(v).slice(0, max))
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

class Invalid extends Error {}

async function settings() {
  return { ...DEFAULT_SETTINGS, ...(await tget('settings', {})) }
}

/** Upsert by id into one of the list "tables". */
async function upsert(name, item) {
  const list = await tget(name, [])
  const i = list.findIndex(x => x.id === item.id)
  if (i >= 0) list[i] = item; else list.push(item)
  await tset(name, list)
  return list
}

async function remove(name, id) {
  const list = (await tget(name, [])).filter(x => x.id !== id)
  await tset(name, list)
  return list
}

// ─── Shared reads ────────────────────────────────────────────────────────────

async function onchainNow() {
  const { series, meta, derived } = await readOnchain()
  const { values, dates } = latestOf(series)
  return { series, meta, derived, values, dates }
}

function planFor(values, dates, s, day) {
  const asOf = ['mvrvZ', 'sthSopr', 'sthMvrv'].map(k => dates[k]).filter(Boolean).sort()[0] || null
  return dcaPlan(values, s, { asOf, today: day })
}

async function homeData({ force = false } = {}) {
  const day = today()
  const [price, xero, chain, s, holdings, ato, dca] = await Promise.all([
    getPrice(), xeroFigures({ today: day, force }), onchainNow(), settings(),
    tget('holdings', {}), tget('ato', []), tget('dca', [])
  ])
  const week = weekStart(day)
  return {
    today: day, price, xero,
    onchain: { values: chain.values, dates: chain.dates, lastRun: chain.meta.lastRun || null },
    dca: { plan: planFor(chain.values, chain.dates, s, day), loggedThisWeek: dca.find(d => d.week === week) || null },
    holdings: holdingsView(holdings, price?.aud, s),
    ato: atoOutlook(ato, day),
    settings: s
  }
}

async function takeSnapshot() {
  const h = await homeData()
  const f = h.xero.figures
  const snap = {
    month: h.today.slice(0, 7), takenAt: new Date().toISOString(),
    cash: f.bank?.data?.total ?? h.settings.manualCash?.amount ?? null,
    receivables: f.receivables?.data?.total ?? null,
    overdue: f.receivables?.data?.overdue ?? null,
    payables: f.payables?.data?.total ?? null,
    profitFy: f.profit?.data?.netProfit ?? null,
    btcAud: h.price?.aud ?? null, btcUsd: h.price?.usd ?? null,
    totalSats: h.holdings.total.sats, btcValueAud: h.holdings.total.value,
    amberCash: h.settings.amberCash ?? null, ato90: h.ato.due90,
    mvrvZ: h.onchain.values.mvrvZ ?? null
  }
  const list = (await tget('snapshots', [])).filter(x => x.month !== snap.month)
  list.push(snap)
  list.sort((a, b) => a.month.localeCompare(b.month))
  await tset('snapshots', list)
  return snap
}

// ─── Actions ─────────────────────────────────────────────────────────────────

const ACTIONS = {
  async access(req, res, session) {
    const unlocked = Boolean(await redis('get', `treasury:unlock:${tokenHash(session.token)}`))
    return res.json({ allowed: true, unlocked })
  },

  async lock(req, res, session) {
    await lockTreasury(session.token)
    return res.json({ ok: true })
  },

  async home(req, res) {
    return res.json(await homeData({ force: req.query.refresh === '1' }))
  },

  async price(req, res) {
    return res.json({ price: await getPrice({ force: req.query.refresh === '1' }) })
  },

  async bitcoin(req, res) {
    const range = ['3m', '1y', 'all'].includes(req.query.range) ? req.query.range : '1y'
    const day = today()
    const [chain, price] = await Promise.all([onchainNow(), getPrice()])
    const shown = Object.fromEntries(Object.entries(chain.series).map(([k, v]) => [k, slice(v, range, day)]))
    const priceUsd = price?.usd ?? chain.values.price
    return res.json({
      range, today: day, price, series: shown, latest: chain.values, dates: chain.dates,
      levels: keyLevels(priceUsd, chain.values), summary: summaryLine(priceUsd, chain.values),
      meta: chain.meta, derived: chain.derived,
      labels: Object.fromEntries(Object.entries(METRICS).map(([k, m]) => [k, m.label]))
    })
  },

  async 'onchain-sync'(req, res) {
    const result = await syncOnchain({ force: true })
    return res.json(result)
  },

  async xero(req, res) {
    return res.json(await xeroFigures({ today: today(), force: req.query.refresh === '1' }))
  },

  async 'xero-connect'(req, res, session) {
    if (!xeroConfigured()) return res.json({ error: 'The Treasury Xero app is not set up yet — see the setup notes.' })
    return res.json({ url: await connectUrl(session.email) })
  },

  async 'xero-disconnect'(req, res) {
    await disconnect()
    return res.json(await connectionStatus())
  },

  async holdings(req, res) {
    const [h, dca, s, price] = await Promise.all([tget('holdings', {}), tget('dca', []), settings(), getPrice()])
    return res.json({ view: holdingsView(h, price?.aud, s), holdings: h, dca, settings: s, price, entities: ENTITIES })
  },

  async 'holdings-save'(req, res) {
    const input = req.body?.holdings || {}
    const s = await settings()
    const dcaEntity = dcaEntityOf(s)
    let dcaCash = null
    const prior = await tget('holdings', {})
    const h = {}
    for (const e of ENTITIES) {
      const x = input[e.id] || {}
      const sats = v => Math.max(0, Math.round(Number(v) || 0))
      h[e.id] = { exchangeSats: sats(x.exchangeSats), coldSats: sats(x.coldSats), costAud: Math.max(0, money(x.costAud) || 0) }
      // Amber cash: the DCA entity's is the DCA's own figure, kept in settings;
      // everyone else's lives here. A missing field leaves it as it was.
      if (x.amberAud === undefined) {
        if (e.id !== dcaEntity) h[e.id].amberAud = Number(prior?.[e.id]?.amberAud) || 0
      } else if (e.id === dcaEntity) {
        dcaCash = Math.max(0, money(x.amberAud) || 0)
      } else {
        h[e.id].amberAud = Math.max(0, money(x.amberAud) || 0)
      }
      // No entity can hold more than every bitcoin there will ever be. This is
      // what a decimal point read as a thousands separator looks like.
      if (h[e.id].exchangeSats + h[e.id].coldSats > MAX_BTC * SATS) {
        throw new Invalid(`${e.label}: more than 21 million BTC — check the decimal point.`)
      }
    }
    h.updatedAt = new Date().toISOString()
    await tset('holdings', h)
    if (dcaCash != null && dcaCash !== Number(s.amberCash)) {
      await tset('settings', { ...s, amberCash: dcaCash, amberCashAt: new Date().toISOString() })
    }
    return res.json({ holdings: h })
  },

  async 'settings-save'(req, res) {
    const s = await settings()
    const b = req.body?.settings || {}
    const next = { ...s }
    for (const k of ['baseWeekly', 'dailyAuto']) if (b[k] != null) next[k] = Math.max(0, money(b[k]) ?? s[k])
    if (b.amberCash != null) { next.amberCash = Math.max(0, money(b.amberCash) ?? 0); next.amberCashAt = new Date().toISOString() }
    if (b.dcaEntity && ENTITIES.some(e => e.id === b.dcaEntity)) next.dcaEntity = b.dcaEntity
    if (b.payroll) {
      next.payroll = {
        amount: Math.max(0, money(b.payroll.amount) ?? 0),
        nextDate: isDay(b.payroll.nextDate) ? b.payroll.nextDate : null
      }
    }
    if (b.manualCash !== undefined) {
      next.manualCash = b.manualCash == null ? null : { amount: money(b.manualCash.amount) ?? 0, at: today() }
    }
    await tset('settings', next)
    return res.json({ settings: next })
  },

  async dca(req, res) {
    const day = today()
    const [chain, s, log, price] = await Promise.all([onchainNow(), settings(), tget('dca', []), getPrice()])
    const week = weekStart(day)
    return res.json({
      today: day, week, plan: planFor(chain.values, chain.dates, s, day), settings: s, price,
      readings: { mvrvZ: chain.values.mvrvZ, sthSopr: chain.values.sthSopr, sthMvrv: chain.values.sthMvrv },
      dates: chain.dates,
      log: [...log].sort((a, b) => b.date.localeCompare(a.date)),
      loggedThisWeek: log.find(d => d.week === week) || null
    })
  },

  /**
   * Records this week's buy. The plan is worked out again here from stored
   * data rather than taken from the phone, so what is logged is what the rules
   * said. The amount actually bought may differ (an exchange minimum, a fill);
   * `aud` and `sats` override it when given.
   */
  async 'dca-log'(req, res) {
    const day = today()
    const week = weekStart(day)
    const [chain, s, log, price, holdings] = await Promise.all([onchainNow(), settings(), tget('dca', []), getPrice(), tget('holdings', {})])
    if (log.some(d => d.week === week) && !req.body?.again) return res.status(409).json({ error: "This week's buy is already logged." })
    const plan = planFor(chain.values, chain.dates, s, day)
    const audAmount = req.body?.aud != null ? money(req.body.aud) : plan.total
    if (!(audAmount > 0)) throw new Invalid('Nothing to log — the buy for this week is A$0.')
    const priceAud = money(req.body?.priceAud) || price?.aud || null
    const sats = req.body?.sats != null ? Math.round(Number(req.body.sats)) : priceAud ? Math.round(audAmount / priceAud * SATS) : null
    const entity = ENTITIES.some(e => e.id === req.body?.entity) ? req.body.entity : s.dcaEntity
    const entry = {
      id: newId(), date: isDay(req.body?.date) ? req.body.date : day, week, aud: audAmount, sats, priceAud,
      entity, multiplier: plan.ready ? plan.multiplier : null, note: str(req.body?.note)
    }
    log.push(entry)
    const h = { ...holdings }
    const cur = h[entity] || { exchangeSats: 0, coldSats: 0, costAud: 0 }
    h[entity] = { ...cur, exchangeSats: (cur.exchangeSats || 0) + (sats || 0), costAud: (cur.costAud || 0) + audAmount }
    const next = { ...s, amberCash: Math.max(0, (Number(s.amberCash) || 0) - audAmount), amberCashAt: new Date().toISOString() }
    await Promise.all([tset('dca', log), tset('holdings', h), tset('settings', next)])
    return res.json({ entry, settings: next })
  },

  /** Takes a logged buy back out, and undoes what logging it did. */
  async 'dca-delete'(req, res) {
    const [log, s, holdings] = await Promise.all([tget('dca', []), settings(), tget('holdings', {})])
    const entry = log.find(d => d.id === req.body?.id)
    if (!entry) return res.status(404).json({ error: 'Not found' })
    const h = { ...holdings }
    const cur = h[entry.entity]
    if (cur) h[entry.entity] = { ...cur, exchangeSats: Math.max(0, (cur.exchangeSats || 0) - (entry.sats || 0)), costAud: Math.max(0, (cur.costAud || 0) - entry.aud) }
    const next = { ...s, amberCash: (Number(s.amberCash) || 0) + (req.body?.restoreAmber === false ? 0 : entry.aud) }
    await Promise.all([tset('dca', log.filter(d => d.id !== entry.id)), tset('holdings', h), tset('settings', next)])
    return res.json({ ok: true })
  },

  async 'dca-entry'(req, res) {
    // A historical buy, typed in by hand. Recorded in the log only — holdings
    // and Amber cash are set directly on their own screens.
    const b = req.body || {}
    if (!isDay(b.date) || !(money(b.aud) > 0)) throw new Invalid('A date and an amount are needed.')
    const entry = {
      id: b.id || newId(), date: b.date, week: weekStart(b.date), aud: money(b.aud),
      sats: b.sats != null && b.sats !== '' ? Math.round(Number(b.sats)) : null,
      priceAud: money(b.priceAud), entity: ENTITIES.some(e => e.id === b.entity) ? b.entity : null,
      multiplier: null, note: str(b.note), manual: true
    }
    if (entry.sats == null && entry.priceAud > 0) entry.sats = Math.round(entry.aud / entry.priceAud * SATS)
    if (entry.priceAud == null && entry.sats > 0) entry.priceAud = Math.round(entry.aud / (entry.sats / SATS))
    await upsert('dca', entry)
    return res.json({ entry })
  },

  async cash(req, res) {
    const day = today()
    const [xero, ato, items, s] = await Promise.all([xeroFigures({ today: day, force: req.query.refresh === '1' }), tget('ato', []), tget('cashitems', []), settings()])
    const f = xero.figures
    const opening = f.bank?.data?.total ?? s.manualCash?.amount ?? 0
    return res.json({
      today: day, ato: [...ato].sort((a, b) => a.due.localeCompare(b.due)), outlook: atoOutlook(ato, day),
      items: [...items].sort((a, b) => a.date.localeCompare(b.date)), settings: s,
      openingSource: f.bank?.data ? { from: 'Xero', at: f.bank.fetchedAt, stale: f.bank.stale } : s.manualCash ? { from: 'manual', at: s.manualCash.at } : null,
      forecast: cashForecast({
        today: day, opening,
        receivables: f.receivables?.data?.items || [], payables: f.payables?.data?.items || [],
        ato, payroll: s.payroll || {}, oneOffs: items
      }),
      xeroStatus: xero.status
    })
  },

  async 'ato-save'(req, res) {
    const b = req.body?.item || {}
    if (!isDay(b.due) || money(b.amount) == null) throw new Invalid('A due date and an amount are needed.')
    const item = { id: b.id || newId(), due: b.due, amount: money(b.amount), label: str(b.label) || 'ATO payment', status: b.status === 'paid' ? 'paid' : 'due' }
    return res.json({ list: await upsert('ato', item) })
  },
  async 'ato-delete'(req, res) { return res.json({ list: await remove('ato', req.body?.id) }) },

  async 'cashitem-save'(req, res) {
    const b = req.body?.item || {}
    if (!isDay(b.date) || money(b.amount) == null) throw new Invalid('A date and an amount are needed.')
    const item = { id: b.id || newId(), date: b.date, amount: money(b.amount), label: str(b.label) || 'One-off' }
    return res.json({ list: await upsert('cashitems', item) })
  },
  async 'cashitem-delete'(req, res) { return res.json({ list: await remove('cashitems', req.body?.id) }) },

  async trust(req, res) {
    const list = await tget('trust', [])
    return res.json({ entries: [...list].sort((a, b) => b.date.localeCompare(a.date)), categories: TRUST_CATEGORIES, today: today() })
  },
  async 'trust-save'(req, res) {
    const b = req.body?.entry || {}
    if (!isDay(b.date) || money(b.amount) == null) throw new Invalid('A date and an amount are needed.')
    const entry = { id: b.id || newId(), date: b.date, amount: money(b.amount), category: str(b.category, 60) || 'Other', party: str(b.party, 120), note: str(b.note, 500) }
    return res.json({ list: await upsert('trust', entry) })
  },
  async 'trust-delete'(req, res) { return res.json({ list: await remove('trust', req.body?.id) }) },

  async snapshots(req, res) { return res.json({ list: await tget('snapshots', []) }) },
  async 'snapshot-now'(req, res) { return res.json({ snapshot: await takeSnapshot() }) },

  async 'import-preview'(req, res) {
    const { data, report } = mapTracker(req.body?.json)
    const counts = { ato: data.ato.length, dca: data.dca.length, trust: data.trust.length, snapshots: data.snapshots.length, holdings: data.holdings ? Object.keys(data.holdings).length : 0, settings: Object.keys(data.settings).length }
    return res.json({ report, counts })
  },

  /**
   * Saves what the preview showed. Lists are added to, not replaced, and a
   * record already present (same date and amount) is not added twice — so
   * importing the same file again is harmless. The file itself is not kept.
   */
  async 'import-commit'(req, res) {
    const { data, report } = mapTracker(req.body?.json)
    const key = { ato: x => `${x.due}|${x.amount}`, dca: x => `${x.date}|${x.aud}`, trust: x => `${x.date}|${x.amount}|${x.party}` }
    const added = {}
    for (const [name, k] of Object.entries(key)) {
      const list = await tget(name, [])
      const seen = new Set(list.map(k))
      const fresh = data[name].filter(x => !seen.has(k(x)))
      if (name === 'dca') fresh.forEach(x => { x.week = weekStart(x.date) })
      if (fresh.length) await tset(name, [...list, ...fresh])
      added[name] = fresh.length
    }
    if (data.snapshots.length) {
      const list = await tget('snapshots', [])
      const have = new Set(list.map(s => s.month))
      const fresh = data.snapshots.filter(s => !have.has(s.month))
      await tset('snapshots', [...list, ...fresh].sort((a, b) => a.month.localeCompare(b.month)))
      added.snapshots = fresh.length
    }
    if (data.holdings) { await tset('holdings', { ...data.holdings, updatedAt: new Date().toISOString() }); added.holdings = Object.keys(data.holdings).length }
    if (Object.keys(data.settings).length) { await tset('settings', { ...(await settings()), ...data.settings }); added.settings = Object.keys(data.settings).length }
    return res.json({ added, report })
  },

  async audit(req, res) { return res.json({ entries: await readAudit(300) }) },

  async status(req, res) {
    let encryption = true
    try { treasuryKey() } catch { encryption = false }
    const { meta } = await readOnchain()
    return res.json({ xero: await connectionStatus(), onchain: meta, encryption })
  }
}

// ─── The two requests that arrive without a session ──────────────────────────

async function xeroCallback(req, res) {
  const email = await consumeState(req.query.state)
  if (!email) { await audit({ action: 'xero-callback', ok: false }); return notFound(res) }
  try {
    if (req.query.error) throw new Error('declined')
    await completeConnect(req.query.code)
    await audit({ email, action: 'xero-callback', ok: true })
    return res.redirect(302, '/?treasury=xero-connected')
  } catch {
    await audit({ email, action: 'xero-callback', ok: false, note: 'exchange failed' })
    return res.redirect(302, '/?treasury=xero-failed')
  }
}

async function cron(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret || (req.headers?.authorization || '') !== `Bearer ${secret}`) return notFound(res)
  const out = {}
  try { out.onchain = await syncOnchain() } catch { out.onchain = 'failed' }
  try { out.price = Boolean(await getPrice({ force: true })) } catch { out.price = false }
  try {
    const month = today().slice(0, 7)
    const snaps = await tget('snapshots', [])
    if (!snaps.some(s => s.month === month && !s.imported)) out.snapshot = (await takeSnapshot()).month
  } catch { out.snapshot = 'failed' }
  await audit({ email: 'cron', action: 'cron', ok: true })
  return res.json(out)
}

// ─── Entry ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const action = String(req.query?.action || '')
  try {
    if (action === 'xero-callback') return await xeroCallback(req, res)
    if (action === 'cron') return await cron(req, res)
    if (action === 'unlock') {
      if (req.method !== 'POST') return notFound(res)
      const main = await unlockTreasury(req, res)
      return main ? res.json({ ok: true }) : undefined
    }

    const fn = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null
    const page = str(req.query?.page, 40) || null
    const session = await treasuryGate(req, res, { action: fn ? action : 'unknown', page, needUnlock: !BEFORE_UNLOCK.has(action) })
    if (!session) return
    if (!fn) return notFound(res)
    // Writes are POSTs. A GET that changed something could be fired by a link.
    const reads = new Set(['access', 'home', 'price', 'bitcoin', 'xero', 'holdings', 'dca', 'cash', 'trust', 'snapshots', 'audit', 'status'])
    if (!reads.has(action) && req.method !== 'POST') return notFound(res)
    return await fn(req, res, session)
  } catch (err) {
    if (err instanceof Invalid) return res.status(400).json({ error: err.message })
    if (err instanceof TreasuryKeyMissing) {
      return res.status(503).json({ error: 'Treasury storage is not set up yet: TREASURY_ENC_KEY is missing in Vercel.' })
    }
    // Never the raw message: it can carry a URL or a figure.
    console.error('treasury', action, err?.name || 'Error')
    return res.status(500).json({ error: 'Something went wrong. The last saved figures are unchanged.' })
  }
}

