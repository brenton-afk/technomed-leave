import { redis } from './_redis.js'
import { treasuryGate, unlockTreasury, lockTreasury, notFound } from './_treasuryAccess.js'
import { tokenHash, treasuryKey, TreasuryKeyMissing } from './_treasuryCrypto.js'
import { tget, tset, audit, readAudit } from './_treasuryStore.js'
import { getPrice, getPriceWithChange, getPriceHistory } from './_treasuryPrice.js'
import { syncOnchain, readOnchain, METRICS } from './_treasuryOnchain.js'
import {
  xeroFigures, connectUrl, consumeState, completeConnect, disconnect, connectionStatus, xeroConfigured
} from './_treasuryXero.js'
import {
  DEFAULT_SETTINGS, ENTITIES, SATS, dcaPlan, latestOf, keyLevels, summaryLine, slice,
  holdingsView, atoOutlook, cashForecast, weekStart, TRUST_CATEGORIES, MAX_BTC, dcaEntityOf, parseBtc
} from '../src/treasury/logic.js'
import { mapTracker } from '../src/treasury/importMap.js'
import {
  parseCashReport, mergeReport, holdingsFrom, incomeByYear, conversionsByYear, suggestOpenings, suggestConsolidations,
  buildLedger, checkAgainstStatements, statementPrices
} from '../src/treasury/selfwealth.js'
import { isAnnualStatement, parseAnnualStatement } from '../src/treasury/selfwealthAnnual.js'
import { getQuotes } from './_treasuryQuotes.js'
import { trackRoc, makeFx, DEFAULT_ROC } from '../src/treasury/roc.js'
import { parseAmberCsv, mergeAmber, amberTotals, isPurchase, transferSuggestions } from '../src/treasury/amber.js'
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

/**
 * Holdings as shown: once an Amber export is imported, the DCA entity's BTC
 * "on exchange" is what Amber says is still there — bought less sent to cold
 * storage — rather than a number typed in. Cold storage stays as entered: it
 * also holds coins that never went through Amber.
 */
async function holdingsShown(holdings, s) {
  const amber = await tget('amber')
  if (!amber?.rows?.length) return { holdings, amberFed: null }
  const entity = dcaEntityOf(s)
  const t = amberTotals(amber.rows)
  const cur = holdings?.[entity] || { exchangeSats: 0, coldSats: 0, costAud: 0 }
  return { holdings: { ...holdings, [entity]: { ...cur, exchangeSats: t.atAmberSats } }, amberFed: { entity, importedAt: amber.importedAt } }
}

/** What Amber bought this week, by the last import. */
async function amberThisWeek(week) {
  const amber = await tget('amber')
  if (!amber?.rows?.length) return null
  const buys = amber.rows.filter(r => isPurchase(r) && r.date >= week)
  return { aud: buys.reduce((t, r) => t + r.aud, 0), sats: buys.reduce((t, r) => t + r.sats, 0), count: buys.length, importedAt: amber.importedAt }
}

/** A buy recorded from the DCA screen moved holdings and Amber cash; hand-entered and imported ones did not. */
const movedHoldings = d => !d.manual && Object.hasOwn(d, 'multiplier')

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
    dca: { plan: planFor(chain.values, chain.dates, s, day), loggedThisWeek: dca.find(d => d.week === week && movedHoldings(d)) || null },
    holdings: holdingsView((await holdingsShown(holdings, s)).holdings, price?.aud, s),
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

// ─── The trust's SelfWealth ledger ───────────────────────────────────────────

/**
 * Annual statements first, the current year's cash report after them, plus
 * anything entered by hand that the statements do not already cover. Units
 * held before the earliest statement (its opening holdings, when the year
 * before was not imported) count as an opening position with an unknown cost.
 */
function investmentLedger(sw, manualOpenings = [], manualActions = []) {
  const annuals = sw.annuals || []
  const L = buildLedger(sw.rows || [], annuals)
  const covered = new Set([...L.rows.filter(r => r.source === 'annual').map(r => r.ticker), ...L.snapshots.map(x => x.ticker)].filter(Boolean))
  const openings = []
  for (const cur of ['USD', 'AUD']) {
    const mine = annuals.filter(a => a.currency === cur).sort((a, b) => a.from.localeCompare(b.from))
    if (!mine.length) continue
    const first = mine[0]
    for (const sn of (first.snapshots || []).filter(x => x.date <= first.from || x.date === first.from)) {
      if (sn.units > 0) openings.push({ ticker: sn.ticker, units: sn.units, costUsd: 0, date: first.from, source: 'statement', costUnknown: true })
    }
  }
  const usedOpenings = [...openings, ...manualOpenings.filter(o => !covered.has(o.ticker))]
  const actions = [...L.actions, ...manualActions.filter(a => !L.actions.some(x => x.ticker === a.ticker))]
  const ignored = {
    openings: manualOpenings.filter(o => covered.has(o.ticker)),
    actions: manualActions.filter(a => L.actions.some(x => x.ticker === a.ticker))
  }
  return { ...L, openings: usedOpenings, actions, ignored }
}

// ─── A DCA buy ───────────────────────────────────────────────────────────────

/** A buy from what was typed, with defaults; derives sats or price from the other. */
function buyFrom(b = {}, defaults = {}) {
  const date = isDay(b.date) ? b.date : null
  const aud = b.aud != null && b.aud !== '' ? money(b.aud) : defaults.aud ?? null
  if (!date && !defaults.aud) throw new Invalid('A date and an amount are needed.')
  if (!(aud > 0)) throw new Invalid('The amount spent has to be more than A$0.')
  let sats = b.sats != null && b.sats !== '' ? Math.round(Number(String(b.sats).replace(/[,\s]/g, ''))) : null
  if (sats != null && !(sats >= 0 && sats <= MAX_BTC * SATS)) throw new Invalid('Sats received is not a sensible number.')
  // Sats received are the fact; a price is only used to estimate them. Given
  // both, the price is worked out from the sats so the two cannot disagree.
  let priceAud = b.priceAud != null && b.priceAud !== '' ? money(b.priceAud) : defaults.priceAud ?? null
  if (sats > 0) priceAud = Math.round(aud / (sats / SATS))
  else if (sats == null && priceAud > 0) sats = Math.round(aud / priceAud * SATS)
  const day = date || today()
  return {
    id: b.id || newId(), date: day, week: weekStart(day), aud, sats, priceAud,
    entity: ENTITIES.some(e => e.id === b.entity) ? b.entity : defaults.entity ?? null,
    note: str(b.note)
  }
}

/**
 * Applies a logged buy (sign +1) or takes it back out (-1): sats and cost on
 * the entity's holding, and the cash off the DCA's Amber balance.
 */
function applyBuy(holdings, s, entry, sign) {
  const h = { ...holdings }
  if (entry.entity) {
    const cur = h[entry.entity] || { exchangeSats: 0, coldSats: 0, costAud: 0 }
    h[entry.entity] = {
      ...cur,
      exchangeSats: Math.max(0, (Number(cur.exchangeSats) || 0) + sign * (entry.sats || 0)),
      costAud: Math.max(0, Math.round(((Number(cur.costAud) || 0) + sign * entry.aud) * 100) / 100)
    }
  }
  const amber = Math.max(0, Math.round(((Number(s.amberCash) || 0) - sign * entry.aud) * 100) / 100)
  return { holdings: h, settings: { ...s, amberCash: amber, amberCashAt: new Date().toISOString() } }
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
    return res.json({ price: await getPriceWithChange({ force: req.query.refresh === '1' }) })
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
    const shown = await holdingsShown(h, s)
    return res.json({ view: holdingsView(shown.holdings, price?.aud, s), holdings: h, amberFed: shown.amberFed, dca, settings: s, price, entities: ENTITIES })
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
      loggedThisWeek: log.find(d => d.week === week && movedHoldings(d)) || null,
      amberWeek: await amberThisWeek(week)
    })
  },

  /**
   * Records this week's buy — only once it has actually been made. The screen
   * asks for confirmation with the amounts as bought; the plan's figure is
   * only the default. `aud`, `sats`, `priceAud`, `date` and `entity` override.
   */
  async 'dca-log'(req, res) {
    const day = today()
    const [chain, s, log, price, holdings] = await Promise.all([onchainNow(), settings(), tget('dca', []), getPrice(), tget('holdings', {})])
    const plan = planFor(chain.values, chain.dates, s, day)
    const date = isDay(req.body?.date) ? req.body.date : day
    const week = weekStart(date)
    if (await tget('amber')) throw new Invalid('Buys now come from the Amber import. Import the latest Amber export on Purchases instead.')
    if (log.some(d => d.week === week && movedHoldings(d)) && !req.body?.again) return res.status(409).json({ error: "This week's buy is already logged. Edit it on Holdings instead." })
    const entry = buyFrom({ ...req.body, date }, { aud: plan.total, priceAud: price?.aud || null, entity: dcaEntityOf(s) })
    entry.multiplier = plan.ready ? plan.multiplier : null
    log.push(entry)
    const after = applyBuy(holdings, s, entry, +1)
    await Promise.all([tset('dca', log), tset('holdings', after.holdings), tset('settings', after.settings)])
    return res.json({ entry, settings: after.settings })
  },

  /** Takes a logged buy back out, and undoes what logging it did. */
  async 'dca-delete'(req, res) {
    const [log, s, holdings] = await Promise.all([tget('dca', []), settings(), tget('holdings', {})])
    const entry = log.find(d => d.id === req.body?.id)
    if (!entry) return res.status(404).json({ error: 'That buy is no longer in the log.' })
    const after = movedHoldings(entry) ? applyBuy(holdings, s, entry, -1) : { holdings, settings: s }
    await Promise.all([tset('dca', log.filter(d => d.id !== entry.id)), tset('holdings', after.holdings), tset('settings', after.settings)])
    return res.json({ ok: true })
  },

  /**
   * Corrects a logged buy. A buy logged from the DCA screen moved sats into
   * holdings and cash out of Amber, so its old effect is taken back out and the
   * corrected one put in — holdings and Amber cash stay right without being
   * re-typed. A past buy entered by hand only ever touched the log.
   */
  async 'dca-edit'(req, res) {
    const [log, s, holdings] = await Promise.all([tget('dca', []), settings(), tget('holdings', {})])
    const i = log.findIndex(d => d.id === req.body?.id)
    if (i < 0) return res.status(404).json({ error: 'That buy is no longer in the log.' })
    const old = log[i]
    const fresh = buyFrom(req.body, {})
    const entry = { ...old, ...fresh, id: old.id }
    let after = { holdings, settings: s }
    if (movedHoldings(old)) {
      after = applyBuy(holdings, s, old, -1)
      after = applyBuy(after.holdings, after.settings, entry, +1)
    }
    log[i] = entry
    await Promise.all([tset('dca', log), tset('holdings', after.holdings), tset('settings', after.settings)])
    return res.json({ entry })
  },

  async 'dca-entry'(req, res) {
    // A historical buy, typed in by hand. Recorded in the log only — holdings
    // and Amber cash are set directly on their own screens.
    const entry = { ...buyFrom(req.body, {}), multiplier: null, manual: true }
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

  /** Corrects the figures in one month's snapshot. Blank clears a figure. */
  async 'snapshot-save'(req, res) {
    const b = req.body?.snapshot || {}
    const list = await tget('snapshots', [])
    const i = list.findIndex(x => x.month === b.month)
    if (i < 0) return res.status(404).json({ error: 'That snapshot is no longer there.' })
    const next = { ...list[i], edited: new Date().toISOString() }
    for (const k of ['cash', 'receivables', 'overdue', 'payables', 'profitFy', 'btcAud', 'btcValueAud', 'amberCash', 'ato90', 'netWorth']) {
      if (b[k] === undefined) continue
      next[k] = b[k] === '' || b[k] == null ? null : money(b[k])
    }
    if (b.totalBtc !== undefined) {
      const { sats, error } = parseBtc(b.totalBtc)
      if (error) throw new Invalid(`Total BTC: ${error}`)
      next.totalSats = b.totalBtc === '' ? null : sats
    }
    list[i] = next
    await tset('snapshots', list)
    return res.json({ list })
  },

  async 'snapshot-delete'(req, res) {
    const list = (await tget('snapshots', [])).filter(x => x.month !== req.body?.month)
    await tset('snapshots', list)
    return res.json({ list })
  },

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
      // Imported buys are history: they go in the log and never move holdings.
      if (name === 'dca') fresh.forEach(x => { x.week = weekStart(x.date); x.manual = true })
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

  // ─── Purchases (the Amber import) ─────────────────────────────────────────

  async purchases(req, res) {
    const [amber, transfers, price, history, trust] = await Promise.all([
      tget('amber', { rows: [] }), tget('transfers', []), getPriceWithChange(), getPriceHistory(), tget('trust', [])
    ])
    const rows = amber.rows || []
    const first = [rows.find(isPurchase)?.date, ...transfers.map(t => t.date)].filter(Boolean).sort()[0] || null
    const from = first ? first.slice(0, 7) + '-01' : null
    return res.json({
      today: today(), price, importedAt: amber.importedAt || null,
      rows: rows.filter(r => isPurchase(r) || r.type === 'send_to_cold_storage'),
      totals: amberTotals(rows),
      transfers: [...transfers].sort((a, b) => a.date.localeCompare(b.date)),
      suggestions: transferSuggestions(trust, transfers),
      history: { aud: from ? history.aud.filter(([d]) => d >= from) : [], usd: from ? history.usd.filter(([d]) => d >= from) : [], stale: history.stale, fetchedAt: history.fetchedAt }
    })
  },

  /** Reads an Amber export and says what it would add. Saves nothing. */
  async 'amber-preview'(req, res) {
    const parsed = parseAmberCsv(req.body?.csv)
    if (parsed.error) throw new Invalid(parsed.error)
    const stored = await tget('amber', { rows: [] })
    const merged = mergeAmber(stored.rows, parsed.rows)
    return res.json({ file: amberTotals(parsed.rows), after: amberTotals(merged.rows), added: merged.added, skipped: parsed.skipped.slice(0, 50), skippedCount: parsed.skipped.length })
  },

  /** Adds the export's new rows. The file itself is not kept — only the columns read from it. */
  async 'amber-commit'(req, res) {
    const parsed = parseAmberCsv(req.body?.csv)
    if (parsed.error) throw new Invalid(parsed.error)
    const stored = await tget('amber', { rows: [] })
    const merged = mergeAmber(stored.rows, parsed.rows)
    await tset('amber', { rows: merged.rows, importedAt: new Date().toISOString() })
    return res.json({ added: merged.added, totals: amberTotals(merged.rows) })
  },

  async 'amber-clear'(req, res) {
    await tset('amber', { rows: [], importedAt: null })
    return res.json({ ok: true })
  },

  /** Coins received rather than bought — the trust's repayment in specie. */
  async 'transfer-save'(req, res) {
    const b = req.body?.transfer || {}
    if (!isDay(b.date)) throw new Invalid('A date is needed.')
    const { sats, error } = parseBtc(b.btc)
    if (error || !(sats > 0)) throw new Invalid(error ? `BTC: ${error}` : 'How much BTC came in?')
    const valueAud = b.valueAud === '' || b.valueAud == null ? null : money(b.valueAud)
    const priceAud = b.priceAud === '' || b.priceAud == null ? (valueAud ? valueAud / (sats / SATS) : null) : money(b.priceAud)
    const item = {
      id: b.id || newId(), date: b.date, sats, priceAud, valueAud: valueAud ?? (priceAud ? priceAud * sats / SATS : null),
      from: str(b.from, 120), note: str(b.note, 300)
    }
    return res.json({ list: await upsert('transfers', item) })
  },
  async 'transfer-delete'(req, res) { return res.json({ list: await remove('transfers', req.body?.id) }) },

  // ─── Trust investments (SelfWealth cash reports) ──────────────────────────

  async investments(req, res) {
    const [sw, openings, actions, s, price, history] = await Promise.all([
      tget('selfwealth', { rows: [], reports: [] }), tget('invopenings', []), tget('invactions', []), settings(), getPriceWithChange(), getPriceHistory()
    ])
    const L = investmentLedger(sw, openings, actions)
    const rows = L.rows
    const fx = price?.aud > 0 && price?.usd > 0 ? price.usd / price.aud : null
    // Return of capital, in A$ at each day's rate (from stored BTC closes in
    // both currencies; today's rate where the history has no such day).
    const rocCfg = { ...DEFAULT_ROC, ...(s.roc || {}) }
    const fxOn = makeFx(history.aud, history.usd, fx)
    const roc = rocCfg.tickers.filter(t => rows.some(r => r.ticker === t && r.kind === 'distribution'))
      .map(ticker => trackRoc({ rows, openings: L.openings, actions: L.actions, fx: fxOn, ticker, cfg: rocCfg, today: today() }))
    const holdings = holdingsFrom(rows, L.openings, L.actions)
    // Prices: live where the quote service answers, else typed, else the last statement's.
    const live = await getQuotes(holdings.filter(h => h.units > 0)).catch(() => ({}))
    const typed = Object.fromEntries(Object.entries(s.invPrices || {}).map(([k, v]) => [k, { ...v, source: 'typed' }]))
    const prices = { ...statementPrices(L.snapshots), ...typed }
    for (const [k, v] of Object.entries(live)) if (!v.stale || !prices[k]) prices[k] = v
    // Cash: the latest running balance on the US$ side (statements carry none).
    const last = [...rows].reverse().find(r => r.balance != null && (r.currency || 'USD') === 'USD')
    return res.json({
      today: today(), fx, prices, roc, rocCfg,
      holdings,
      checks: checkAgainstStatements(rows, L.actions, L.snapshots, L.openings),
      statements: (sw.annuals || []).map(a => ({ market: a.market, from: a.from, to: a.to, importedAt: a.importedAt })),
      autoOpenings: L.openings.filter(o => o.source === 'statement'),
      ignored: L.ignored,
      income: incomeByYear(rows), conversions: conversionsByYear(rows),
      openings, actions,
      suggestedOpenings: suggestOpenings(rows, L.openings),
      suggestedConsolidations: suggestConsolidations(rows, L.openings, L.actions),
      cash: last ? { usd: last.balance, at: last.date } : null,
      reports: sw.reports || [],
      recent: rows.slice(-40).reverse()
    })
  },

  /** Reads a cash report the phone has unpacked, and says what it would add. Saves nothing. */
  async 'sw-preview'(req, res) {
    const items = req.body?.items || []
    if (isAnnualStatement(items)) {
      const a = parseAnnualStatement(items)
      if (a.error) throw new Invalid(a.error)
      const sw = await tget('selfwealth', { rows: [], reports: [], annuals: [] })
      const others = (sw.annuals || []).filter(x => !(x.market === a.market && x.from === a.from && x.to === a.to))
      const L = investmentLedger({ ...sw, annuals: [...others, a] }, await tget('invopenings', []), await tget('invactions', []))
      const checks = checkAgainstStatements(L.rows, L.actions, a.snapshots, L.openings)
      return res.json({
        type: 'annual', market: a.market, currency: a.currency, from: a.from, to: a.to, counts: a.counts,
        consolidations: a.actions, checks, replaces: others.length < (sw.annuals || []).length
      })
    }
    const r = parseCashReport(items)
    if (r.error) throw new Invalid(r.error)
    const sw = await tget('selfwealth', { rows: [], reports: [] })
    const kinds = {}
    for (const x of r.rows) kinds[x.kind] = (kinds[x.kind] || 0) + 1
    return res.json({
      account: r.account, currency: r.currency, from: r.from, to: r.to, opening: r.opening, closing: r.closing,
      reconciles: r.reconciles, breaks: r.breaks, rows: r.rows.length, kinds,
      others: r.others.slice(0, 20), added: mergeReport(sw.rows, r.rows).added
    })
  },

  /**
   * Adds the report's new rows. A report whose balances do not add up is
   * refused: it means a line was misread, and a misread trade would put the
   * holdings wrong without anyone noticing.
   */
  async 'sw-commit'(req, res) {
    const items = req.body?.items || []
    if (isAnnualStatement(items)) {
      const a = parseAnnualStatement(items)
      if (a.error) throw new Invalid(a.error)
      const sw = await tget('selfwealth', { rows: [], reports: [], annuals: [] })
      const annuals = [...(sw.annuals || []).filter(x => !(x.market === a.market && x.from === a.from && x.to === a.to)),
        { market: a.market, currency: a.currency, from: a.from, to: a.to, rows: a.rows, actions: a.actions, snapshots: a.snapshots, importedAt: new Date().toISOString() }]
        .sort((x, y) => x.from.localeCompare(y.from))
      await tset('selfwealth', { ...sw, annuals })
      return res.json({ added: a.rows.length, type: 'annual' })
    }
    const r = parseCashReport(items)
    if (r.error) throw new Invalid(r.error)
    if (r.reconciles === false) throw new Invalid('This report did not add up when read, so it was not imported. Send it to Claude to look at.')
    const sw = await tget('selfwealth', { rows: [], reports: [] })
    const merged = mergeReport(sw.rows, r.rows)
    const reports = [...(sw.reports || []).filter(x => !(x.from === r.from && x.to === r.to)),
      { from: r.from, to: r.to, opening: r.opening, closing: r.closing, reconciles: r.reconciles, importedAt: new Date().toISOString() }]
      .sort((a, b) => a.from.localeCompare(b.from))
    await tset('selfwealth', { ...sw, rows: merged.rows.map(x => ({ ...x, currency: x.currency || r.currency })), reports })
    return res.json({ added: merged.added })
  },

  async 'sw-clear'(req, res) {
    await tset('selfwealth', { rows: [], reports: [], annuals: [] })
    return res.json({ ok: true })
  },

  /** Units held before the first report, with what they cost (US$). One per ticker. */
  async 'inv-opening-save'(req, res) {
    const b = req.body?.opening || {}
    const ticker = str(b.ticker, 12).toUpperCase().trim()
    const units = Number(String(b.units ?? '').replace(/,/g, ''))
    if (!ticker || !(units > 0)) throw new Invalid('A ticker and a number of units are needed.')
    const item = { id: ticker, ticker, units, costUsd: Math.max(0, money(b.costUsd) || 0), date: isDay(b.date) ? b.date : null, note: str(b.note, 200) }
    return res.json({ list: await upsert('invopenings', item) })
  },
  async 'inv-opening-delete'(req, res) { return res.json({ list: await remove('invopenings', req.body?.id) }) },

  /** A consolidation (reverse split): on `date`, every `ratio` units became one. */
  async 'inv-action-save'(req, res) {
    const b = req.body?.action || {}
    const ticker = str(b.ticker, 12).toUpperCase().trim()
    const ratio = Number(b.ratio)
    if (!ticker || !isDay(b.date) || !(ratio >= 2 && ratio <= 1000)) throw new Invalid('A ticker, a date and a ratio (e.g. 5 for 1-for-5) are needed.')
    const item = { id: `${ticker}-${b.date}`, ticker, date: b.date, ratio }
    return res.json({ list: await upsert('invactions', item) })
  },
  async 'inv-action-delete'(req, res) { return res.json({ list: await remove('invactions', req.body?.id) }) },

  /**
   * The share of each payment that is return of capital: a % per calendar
   * year (final once the fund publishes it), and any payment's own estimate.
   */
  async 'roc-save'(req, res) {
    const b = req.body?.roc || {}
    const pctOk = v => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100
    const years = {}
    for (const [y, v] of Object.entries(b.years || {})) {
      if (!/^\d{4}$/.test(y) || v === '' || v == null) continue
      if (!pctOk(v)) throw new Invalid(`${y}: a percentage from 0 to 100.`)
      years[y] = Number(v)
    }
    const overrides = {}
    for (const [d, v] of Object.entries(b.overrides || {})) {
      if (!isDay(d) || v === '' || v == null) continue
      if (!pctOk(v)) throw new Invalid(`${d}: a percentage from 0 to 100.`)
      overrides[d] = Number(v)
    }
    const final = Array.isArray(b.final) ? b.final.filter(y => /^\d{4}$/.test(y)) : []
    const s = await settings()
    const next = { ...s, roc: { ...DEFAULT_ROC, ...(s.roc || {}), years, overrides, final } }
    await tset('settings', next)
    return res.json({ roc: next.roc })
  },

  /** A US$ price per ticker, typed in until a quote service is connected. */
  async 'inv-price-save'(req, res) {
    const ticker = str(req.body?.ticker, 12).toUpperCase().trim()
    const price = money(req.body?.price)
    if (!ticker || !(price > 0)) throw new Invalid('A ticker and a price are needed.')
    const s = await settings()
    const next = { ...s, invPrices: { ...(s.invPrices || {}), [ticker]: { price, at: new Date().toISOString() } } }
    await tset('settings', next)
    return res.json({ prices: next.invPrices })
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
  try { out.history = !(await getPriceHistory()).stale } catch { out.history = false }
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
    const reads = new Set(['access', 'home', 'price', 'bitcoin', 'xero', 'holdings', 'dca', 'cash', 'trust', 'snapshots', 'audit', 'status', 'purchases', 'investments'])
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

