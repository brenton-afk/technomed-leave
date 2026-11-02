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
