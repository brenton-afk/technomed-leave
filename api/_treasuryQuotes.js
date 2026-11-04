import { tget, tset } from './_treasuryStore.js'

// ─── Share prices for the trust's holdings ───────────────────────────────────
// From Yahoo Finance's public chart endpoint (no key): US tickers as they are,
// ASX ones with ".AX". Cached for 15 minutes; when it does not answer, the last
// price stored is used and marked stale. A price typed in on the screen, or the
// last annual statement's, stands in where neither exists.

export const QUOTE_TTL_MS = 15 * 60 * 1000

export const symbolFor = (ticker, currency) => (currency === 'AUD' ? `${ticker}.AX` : ticker)

export function parseChart(body) {
  const meta = body?.chart?.result?.[0]?.meta
  const price = Number(meta?.regularMarketPrice)
  if (!(price > 0)) throw new Error('no price')
  return { price, currency: meta.currency || null, at: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString() }
}

async function fetchOne(symbol, fetchImpl) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetchImpl(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`, {
      signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (treasury price check)' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return parseChart(await res.json())
  } finally { clearTimeout(timer) }
}

/** @param {Array<{ticker, currency}>} holdings  @returns {{[ticker]: {price, at, source, stale}}} */
export async function getQuotes(holdings, { fetchImpl = fetch, now = Date.now() } = {}) {
  const cache = await tget('quotes', {})
  const out = {}
  let changed = false
  for (const h of holdings) {
    const c = cache[h.ticker]
    if (c && now - Date.parse(c.fetchedAt) < QUOTE_TTL_MS) { out[h.ticker] = { ...c, source: 'live', stale: false }; continue }
    try {
      const q = await fetchOne(symbolFor(h.ticker, h.currency), fetchImpl)
      cache[h.ticker] = { price: q.price, at: q.at, fetchedAt: new Date(now).toISOString() }
      out[h.ticker] = { ...cache[h.ticker], source: 'live', stale: false }
      changed = true
    } catch {
      if (c) out[h.ticker] = { ...c, source: 'live', stale: true }
    }
  }
  if (changed) await tset('quotes', cache).catch(() => {})
  return out
}
