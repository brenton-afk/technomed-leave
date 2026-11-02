import { tget, tset } from './_treasuryStore.js'

// ─── Live BTC price ──────────────────────────────────────────────────────────
// Kraken's public ticker first, CoinGecko if Kraken is down, and the last good
// price — marked stale — if both are. Cached for 60 seconds so a page that
// polls cannot turn into a stream of requests to either.
//
// Kraken names its pairs inconsistently (XBTAUD comes back as "XBTAUD", XBTUSD
// as "XXBTZUSD"), so the result is matched by quote currency, not by key.

export const PRICE_TTL_MS = 60 * 1000
const TIMEOUT_MS = 6000

async function getJson(url, fetchImpl) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally { clearTimeout(timer) }
}

export function parseKraken(body) {
  if (body?.error?.length) throw new Error('Kraken error')
  const result = body?.result || {}
  const pick = quote => {
    const key = Object.keys(result).find(k => k.endsWith(quote) && /XBT|BTC/.test(k))
    const last = Number(result[key]?.c?.[0])
    return Number.isFinite(last) && last > 0 ? last : null
  }
  const aud = pick('AUD')
  const usd = pick('USD')
  if (!aud || !usd) throw new Error('Kraken: missing pair')
  // The ticker carries no timestamp; the moment it was asked is the price time.
  return { aud, usd, source: 'Kraken', at: new Date().toISOString() }
}

export function parseCoinGecko(body) {
  const b = body?.bitcoin || {}
  const aud = Number(b.aud)
  const usd = Number(b.usd)
  if (!(aud > 0) || !(usd > 0)) throw new Error('CoinGecko: missing price')
  const at = b.last_updated_at ? new Date(b.last_updated_at * 1000).toISOString() : new Date().toISOString()
  return { aud, usd, source: 'CoinGecko', at }
}

export async function fetchLivePrice(fetchImpl = fetch) {
  try {
    return parseKraken(await getJson('https://api.kraken.com/0/public/Ticker?pair=XBTAUD,XBTUSD', fetchImpl))
  } catch {
    return parseCoinGecko(await getJson(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=aud,usd&include_last_updated_at=true',
      fetchImpl))
  }
}

/**
 * The price to show: cached if under a minute old, live otherwise, and the
 * last good one with `stale: true` if neither source answers. Null only if
 * nothing has ever been fetched.
 */
export async function getPrice({ fetchImpl = fetch, now = Date.now(), force = false } = {}) {
  const cached = await tget('price')
  if (!force && cached && now - Date.parse(cached.fetchedAt) < PRICE_TTL_MS) return { ...cached, stale: false }
  try {
    const fresh = { ...(await fetchLivePrice(fetchImpl)), fetchedAt: new Date(now).toISOString() }
    await tset('price', fresh)
    return { ...fresh, stale: false }
  } catch {
    return cached ? { ...cached, stale: true } : null
  }
}

// ─── 24-hour change ──────────────────────────────────────────────────────────
// Kraken's ticker gives today's open (from midnight UTC), not the price a day
// ago, so the reference comes from its hourly candles: the close of the hour
// 24 hours back. Fetched at most every ten minutes — the change does not need
// the minute-by-minute freshness the price itself has.

export const REF_TTL_MS = 10 * 60 * 1000

/** The close of the last hourly candle at or before `target` (ms). */
export function closeAt(body, target) {
  const result = body?.result || {}
  const key = Object.keys(result).find(k => k !== 'last')
  let best = null
  for (const c of result[key] || []) {
    const t = Number(c[0]) * 1000
    if (t <= target && (!best || t > best.t)) best = { t, close: Number(c[4]) }
  }
  return best?.close > 0 ? best.close : null
}

async function reference24h(fetchImpl, now) {
  const cached = await tget('price:ref24')
  if (cached && now - Date.parse(cached.fetchedAt) < REF_TTL_MS) return cached
  try {
    const since = Math.floor((now - 26 * 3600e3) / 1000)
    const target = now - 24 * 3600e3
    const [a, u] = await Promise.all(['XBTAUD', 'XBTUSD'].map(p =>
      getJson(`https://api.kraken.com/0/public/OHLC?pair=${p}&interval=60&since=${since}`, fetchImpl)))
    const ref = { aud: closeAt(a, target), usd: closeAt(u, target), fetchedAt: new Date(now).toISOString() }
    if (ref.aud || ref.usd) await tset('price:ref24', ref)
    return ref
  } catch {
    return cached || null
  }
}

/** The price with its change over 24 hours, in % for each currency. */
export async function getPriceWithChange({ fetchImpl = fetch, now = Date.now(), force = false } = {}) {
  const price = await getPrice({ fetchImpl, now, force })
  if (!price) return null
  const ref = await reference24h(fetchImpl, now)
  const pct = (a, b) => (a > 0 && b > 0 ? (a / b - 1) * 100 : null)
  return { ...price, change24: { aud: pct(price.aud, ref?.aud), usd: pct(price.usd, ref?.usd) } }
}

// ─── Daily closing prices ────────────────────────────────────────────────────
// For the purchase chart: one close a day in AUD and USD, stored so the chart
// draws from here. Kraken's daily candles cover about two years, which reaches
// back past the first purchase. Refreshed at most every six hours.

export const HISTORY_TTL_MS = 6 * 3600e3

export function dailyCloses(body) {
  const result = body?.result || {}
  const key = Object.keys(result).find(k => k !== 'last')
  return (result[key] || [])
    .map(c => [new Date(Number(c[0]) * 1000).toISOString().slice(0, 10), Number(c[4])])
    .filter(([, v]) => v > 0)
}

function merge(stored = [], fresh = []) {
  const m = new Map(stored)
  for (const [d, v] of fresh) m.set(d, v)
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

/** {aud: [[date, close]], usd: [...], fetchedAt, stale} — the last stored if Kraken is down. */
export async function getPriceHistory({ fetchImpl = fetch, now = Date.now(), force = false } = {}) {
  const stored = await tget('pricehist', { aud: [], usd: [], fetchedAt: null })
  if (!force && stored.fetchedAt && now - Date.parse(stored.fetchedAt) < HISTORY_TTL_MS) return { ...stored, stale: false }
  try {
    const [a, u] = await Promise.all(['XBTAUD', 'XBTUSD'].map(p =>
      getJson(`https://api.kraken.com/0/public/OHLC?pair=${p}&interval=1440`, fetchImpl)))
    const next = { aud: merge(stored.aud, dailyCloses(a)), usd: merge(stored.usd, dailyCloses(u)), fetchedAt: new Date(now).toISOString() }
    if (!next.aud.length) throw new Error('empty')
    await tset('pricehist', next)
    return { ...next, stale: false }
  } catch {
    return { ...stored, stale: true }
  }
}
