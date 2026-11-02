import { tget, tset } from './_treasuryStore.js'

// ─── On-chain metrics ────────────────────────────────────────────────────────
// Daily history from BGeometrics' free API (bitcoin-data.com), stored in our
// own Redis so the charts load from here and still draw when the source is
// down. Each endpoint returns a metric's whole history in one call, so the
// first run *is* the backfill — years of it, not just the two asked for.
//
// ── Not hammering it ──
// The free tier is a handful of requests an hour and not many more a day. Every
// request is recorded in `treasury:onchain:budget` and nothing is sent past
// MAX_PER_HOUR / MAX_PER_DAY, whoever asks — the cron, or the Update button.
// A run takes the metrics in order of need (never fetched, then oldest), up to
// PER_RUN, so two runs a day keep all nine current with requests to spare.
//
// ── When it is down, or a metric is missing ──
// Price falls back to Kraken's daily candles (public, about two years). The
// three ratios that are only price over a cost basis — MVRV, STH-MVRV, LTH-MVRV
// — are extended from price and the cost basis when their own series stops,
// and those points are counted in `derived` so the screen can say so. Z-score
// and SOPR cannot be rebuilt from anything free; they go stale, with a badge.

export const METRICS = {
  price: { path: '/v1/btc-price', label: 'BTC price (USD)' },
  mvrv: { path: '/v1/mvrv', label: 'MVRV ratio' },
  mvrvZ: { path: '/v1/mvrv-zscore', label: 'MVRV Z-score' },
  realizedPrice: { path: '/v1/realized-price', label: 'Realised price' },
  sthRealizedPrice: { path: '/v1/sth-realized-price', label: 'STH cost basis' },
  sthMvrv: { path: '/v1/sth-mvrv', label: 'STH-MVRV' },
  sthSopr: { path: '/v1/sth-sopr', label: 'STH-SOPR' },
  lthRealizedPrice: { path: '/v1/lth-realized-price', label: 'LTH cost basis' },
  lthMvrv: { path: '/v1/lth-mvrv', label: 'LTH-MVRV' }
}

/** Ratios that are price ÷ a cost basis, and so can be rebuilt from the two. */
export const DERIVABLE = { mvrv: 'realizedPrice', sthMvrv: 'sthRealizedPrice', lthMvrv: 'lthRealizedPrice' }

export const MAX_PER_HOUR = 8
export const MAX_PER_DAY = 15
export const PER_RUN = 6
/** A metric fetched more recently than this is left alone. */
export const REFETCH_AFTER_MS = 20 * 60 * 60 * 1000

const DATE_KEYS = ['d', 'date', 'day', 'theDay', 'time', 'timestamp', 'unixTs', 'unixts']

function toDay(v) {
  if (v == null) return null
  if (typeof v === 'number' || /^\d{9,13}$/.test(String(v))) {
    const n = Number(v)
    return new Date(n < 1e12 ? n * 1000 : n).toISOString().slice(0, 10)
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v))
  return m ? m[1] : null
}

/**
 * [[YYYY-MM-DD, number], ...] ascending, from whatever shape the source sent.
 * Rows whose value is missing or not a number are dropped, not zeroed — a zero
 * would draw as a real reading.
 */
export function parseSeries(body) {
  const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : body ? [body] : []
  const map = new Map()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    let day = null
    for (const k of DATE_KEYS) { if (row[k] != null) { day = toDay(row[k]); if (day) break } }
    if (!day) continue
    let value = null
    for (const [k, v] of Object.entries(row)) {
      if (DATE_KEYS.includes(k)) continue
      const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN)
      if (Number.isFinite(n)) { value = n; break }
    }
    if (value != null) map.set(day, value)
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

/** Kraken daily candles → [[date, close], ...]. */
export function parseKrakenOhlc(body) {
  const result = body?.result || {}
  const key = Object.keys(result).find(k => k !== 'last')
  return (result[key] || [])
    .map(c => [new Date(Number(c[0]) * 1000).toISOString().slice(0, 10), Number(c[4])])
    .filter(([, v]) => Number.isFinite(v) && v > 0)
}

/** Joins a fresh history onto a stored one; the fresh value wins a clash. */
export function mergeSeries(stored = [], fresh = []) {
  const map = new Map(stored)
  for (const [d, v] of fresh) map.set(d, v)
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

/**
 * Extends a price/cost-basis ratio past where its own series stops.
 * @returns {{series: Array, derived: number}}
 */
export function extendRatio(ratio = [], price = [], basis = []) {
  const last = ratio.length ? ratio[ratio.length - 1][0] : ''
  const basisMap = new Map(basis)
  const extra = []
  for (const [d, p] of price) {
    if (d <= last) continue
    const b = basisMap.get(d)
    if (b > 0) extra.push([d, p / b])
  }
  return { series: extra.length ? [...ratio, ...extra] : ratio, derived: extra.length }
}

// ─── Budget ──────────────────────────────────────────────────────────────────

export function budgetLeft(stamps = [], now = Date.now()) {
  const hour = stamps.filter(t => now - t < 3600e3).length
  const day = stamps.filter(t => now - t < 86400e3).length
  return Math.max(0, Math.min(MAX_PER_HOUR - hour, MAX_PER_DAY - day))
}

/** Which metrics to ask for this run, most in need first. */
export function planRun(meta = {}, budget = PER_RUN, now = Date.now()) {
  const need = Object.keys(METRICS)
    .map(id => ({ id, at: meta[id]?.fetchedAt ? Date.parse(meta[id].fetchedAt) : 0 }))
    .filter(m => now - m.at > REFETCH_AFTER_MS)
    .sort((a, b) => a.at - b.at)
  return need.slice(0, Math.min(PER_RUN, budget)).map(m => m.id)
}

// ─── The run ─────────────────────────────────────────────────────────────────

const BASE = () => (process.env.BGEOMETRICS_BASE || 'https://bitcoin-data.com').replace(/\/$/, '')

async function getJson(url, fetchImpl, timeoutMs = 20000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    if (res.status === 429) throw new Error('rate limited')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally { clearTimeout(timer) }
}

function urlFor(id) {
  const token = process.env.BGEOMETRICS_TOKEN
  return `${BASE()}${METRICS[id].path}${token ? `?token=${encodeURIComponent(token)}` : ''}`
}

/**
 * Fetches what is due, within the budget, and stores it.
 * Never throws for a source failure: each metric's outcome is in the result.
 */
export async function syncOnchain({ fetchImpl = fetch, now = Date.now(), force = false } = {}) {
  const meta = await tget('onchain:meta', {})
  const stamps = (await tget('onchain:budget', [])).filter(t => now - t < 86400e3)
  const left = budgetLeft(stamps, now)
  const ids = force
    ? Object.keys(METRICS).sort((a, b) => Date.parse(meta[a]?.fetchedAt || 0) - Date.parse(meta[b]?.fetchedAt || 0)).slice(0, Math.min(PER_RUN, left))
    : planRun(meta, left, now)
  const outcome = {}

  for (const id of ids) {
    stamps.push(Date.now())
    try {
      const fresh = parseSeries(await getJson(urlFor(id), fetchImpl))
      if (!fresh.length) throw new Error('empty')
      const merged = mergeSeries(await tget(`onchain:${id}`, []), fresh)
      await tset(`onchain:${id}`, merged)
      meta[id] = { fetchedAt: new Date(now).toISOString(), lastDate: merged[merged.length - 1][0], source: 'BGeometrics', error: null }
      outcome[id] = 'ok'
    } catch (err) {
      meta[id] = { ...(meta[id] || {}), triedAt: new Date(now).toISOString(), error: String(err.message || err).slice(0, 80) }
      outcome[id] = 'failed'
    }
  }
  await tset('onchain:budget', stamps)

  // Price has a second source that costs nothing against the budget.
  if (outcome.price === 'failed' || !meta.price?.lastDate) {
    try {
      const k = parseKrakenOhlc(await getJson('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440', fetchImpl))
      if (k.length) {
        const merged = mergeSeries(await tget('onchain:price', []), k)
        await tset('onchain:price', merged)
        meta.price = { ...(meta.price || {}), lastDate: merged[merged.length - 1][0], backupAt: new Date(now).toISOString(), source: 'Kraken (backup)' }
        outcome.price = 'backup'
      }
    } catch { /* stays stale */ }
  }

  meta.lastRun = new Date(now).toISOString()
  await tset('onchain:meta', meta)
  return { fetched: ids, outcome, budgetLeft: budgetLeft(stamps, now) }
}

/** Every stored series, with the ratios extended where the source stopped. */
export async function readOnchain() {
  const meta = await tget('onchain:meta', {})
  const series = {}
  for (const id of Object.keys(METRICS)) series[id] = await tget(`onchain:${id}`, [])
  const derived = {}
  for (const [ratio, basis] of Object.entries(DERIVABLE)) {
    const r = extendRatio(series[ratio], series.price, series[basis])
    series[ratio] = r.series
    if (r.derived) derived[ratio] = r.derived
  }
  return { series, meta, derived }
}
