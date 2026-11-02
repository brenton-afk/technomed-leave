// ─── Amber transactions ──────────────────────────────────────────────────────
// Reads Amber's CSV export and works out the purchase tracker from it. Pure:
// the server parses and stores, and the Purchases screen draws from the same
// functions, so the numbers on screen are the numbers that were checked.
//
// Columns (by header name, in any order): datetime_hobart, type, status,
// aud_amount, btc_amount, price_aud_per_btc, fee_aud. Anything else in the
// file — a wallet address, a reference — is never read, so it is never stored.
//
//   buy_recurring, buy, buy_on_deposit   a purchase
//   send_to_cold_storage                  BTC moved off Amber, not a sale
//   aud_deposit                           cash in
//
// Only settled rows. A row is the same row again when its datetime, type and
// BTC amount match, so importing a newer export adds only what is new.

import { SATS, addDays, weekStart } from './logic.js'

export const PURCHASE_TYPES = {
  buy_recurring: 'Daily auto-buy',
  buy: 'One-off buy',
  buy_on_deposit: 'Buy on deposit'
}
export const SEND = 'send_to_cold_storage'
export const DEPOSIT = 'aud_deposit'
const KNOWN = new Set([...Object.keys(PURCHASE_TYPES), SEND, DEPOSIT])

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsvText(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const s = String(text || '').replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++ } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(f => f.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some(f => f.trim() !== '')) rows.push(row)
  return rows
}

const num = v => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** "2026-10-30 12:20:05", "2026-10-30T12:20", "30/10/2026 12:20" → {at, date}. */
export function readHobartTime(v) {
  const s = String(v || '').trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})[T ]?(\d{1,2})?:?(\d{2})?:?(\d{2})?/.exec(s)
  if (!m) {
    const a = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T]?(\d{1,2})?:?(\d{2})?:?(\d{2})?/.exec(s)
    if (a) m = [a[0], a[3], a[2].padStart(2, '0'), a[1].padStart(2, '0'), a[4], a[5], a[6]]
  }
  if (!m) return null
  const date = `${m[1]}-${m[2]}-${m[3]}`
  const time = `${String(m[4] || '0').padStart(2, '0')}:${m[5] || '00'}:${m[6] || '00'}`
  return { at: `${date}T${time}`, date }
}

const REQUIRED = ['datetime_hobart', 'type', 'status', 'aud_amount', 'btc_amount']

/**
 * The export as rows, plus what was set aside and why.
 * @returns {{rows: Array, skipped: Array<{line:number, reason:string}>, error?: string}}
 */
export function parseAmberCsv(text) {
  const table = parseCsvText(text)
  if (!table.length) return { rows: [], skipped: [], error: 'The file is empty.' }
  const head = table[0].map(h => h.trim().toLowerCase())
  const missing = REQUIRED.filter(c => !head.includes(c))
  if (missing.length) return { rows: [], skipped: [], error: `Not an Amber export: no ${missing.join(', ')} column.` }
  const col = name => head.indexOf(name)
  const rows = []
  const skipped = []
  table.slice(1).forEach((cells, i) => {
    const line = i + 2
    const get = name => (col(name) >= 0 ? cells[col(name)] ?? '' : '')
    const type = get('type').trim().toLowerCase()
    const status = get('status').trim().toLowerCase()
    if (status !== 'settled') { skipped.push({ line, reason: `status "${status || 'blank'}", not settled` }); return }
    if (!KNOWN.has(type)) { skipped.push({ line, reason: `type "${type || 'blank'}" is not one this reads` }); return }
    const when = readHobartTime(get('datetime_hobart'))
    if (!when) { skipped.push({ line, reason: 'date and time could not be read' }); return }
    const audAmount = num(get('aud_amount'))
    const btcAmount = num(get('btc_amount'))
    const sats = btcAmount == null ? null : Math.round(Math.abs(btcAmount) * SATS)
    if (type !== DEPOSIT && !(sats > 0)) { skipped.push({ line, reason: 'no BTC amount' }); return }
    if (type !== SEND && !(Math.abs(audAmount ?? 0) > 0)) { skipped.push({ line, reason: 'no A$ amount' }); return }
    const price = num(get('price_aud_per_btc'))
    rows.push({
      key: `${when.at}|${type}|${sats ?? 0}`,
      at: when.at, date: when.date, type,
      aud: audAmount == null ? null : Math.abs(audAmount),
      sats,
      priceAud: price > 0 ? price : (sats > 0 && audAmount ? Math.abs(audAmount) / (sats / SATS) : null),
      feeAud: Math.abs(num(get('fee_aud')) ?? 0)
    })
  })
  return { rows, skipped }
}

/** Adds the rows not already held. @returns {{rows, added}} */
export function mergeAmber(existing = [], incoming = []) {
  const seen = new Set(existing.map(r => r.key))
  const fresh = incoming.filter(r => !seen.has(r.key) && seen.add(r.key))
  const rows = [...existing, ...fresh].sort((a, b) => a.at.localeCompare(b.at))
  return { rows, added: fresh.length }
}

export const isPurchase = r => Object.hasOwn(PURCHASE_TYPES, r.type)

/** What the import adds up to — the figures to check it against. */
export function amberTotals(rows = []) {
  const buys = rows.filter(isPurchase)
  const sends = rows.filter(r => r.type === SEND)
  const deposits = rows.filter(r => r.type === DEPOSIT)
  const sum = (list, k) => list.reduce((s, r) => s + (r[k] || 0), 0)
  const boughtSats = sum(buys, 'sats')
  const invested = sum(buys, 'aud')
  const sentSats = sum(sends, 'sats')
  return {
    rows: rows.length,
    purchases: buys.length, invested, boughtSats,
    averageCost: boughtSats > 0 ? invested / (boughtSats / SATS) : null,
    firstPurchase: buys[0]?.date || null, lastPurchase: buys[buys.length - 1]?.date || null,
    sends: sends.length, sentSats,
    atAmberSats: Math.max(0, boughtSats - sentSats),
    deposits: deposits.length, depositedAud: sum(deposits, 'aud'),
    fees: sum(buys, 'feeAud')
  }
}

// ─── The tracker ─────────────────────────────────────────────────────────────

/**
 * The summary cards. Transfers in (coins received, not bought — the trust's
 * repayment) are counted in BTC held and its value, but never in what was
 * invested or the average cost of buying, which would flatter both.
 */
export function purchaseSummary(rows, transfers = [], priceAud, today) {
  const t = amberTotals(rows)
  const buys = rows.filter(isPurchase)
  const since = addDays(today, -30)
  const transferSats = transfers.reduce((s, x) => s + (x.sats || 0), 0)
  const value = priceAud > 0 ? (t.boughtSats / SATS) * priceAud : null
  const largest = buys.reduce((m, r) => (!m || r.aud > m.aud ? r : m), null)
  return {
    boughtSats: t.boughtSats, invested: t.invested, averageCost: t.averageCost,
    value, gain: value == null ? null : value - t.invested,
    gainPct: value == null || !t.invested ? null : (value / t.invested - 1) * 100,
    purchases: buys.length, largest,
    last30Sats: buys.filter(r => r.date >= since).reduce((s, r) => s + r.sats, 0),
    sentSats: t.sentSats, atAmberSats: t.atAmberSats,
    transferSats, transferValue: priceAud > 0 ? (transferSats / SATS) * priceAud : null,
    firstPurchase: t.firstPurchase
  }
}

/** One row per month: A$ invested, BTC bought, average price paid, buys. Newest first. */
export function monthlyTable(rows) {
  const m = new Map()
  for (const r of rows.filter(isPurchase)) {
    const k = r.date.slice(0, 7)
    const x = m.get(k) || { month: k, invested: 0, sats: 0, buys: 0 }
    x.invested += r.aud; x.sats += r.sats; x.buys += 1
    m.set(k, x)
  }
  return [...m.values()].map(x => ({ ...x, averagePrice: x.sats ? x.invested / (x.sats / SATS) : null }))
    .sort((a, b) => b.month.localeCompare(a.month))
}

/**
 * The dots: each purchase, or one per week or month. A group's price is what
 * was actually paid on average across it, so the dot sits where the money went.
 */
export function purchaseDots(rows, group = 'none') {
  const buys = rows.filter(isPurchase)
  if (group === 'none') {
    return buys.map(r => ({ date: r.date, at: r.at, aud: r.aud, sats: r.sats, priceAud: r.priceAud, type: r.type, count: 1, auto: r.type === 'buy_recurring' }))
  }
  const keyOf = r => (group === 'week' ? weekStart(r.date) : `${r.date.slice(0, 7)}-01`)
  const m = new Map()
  for (const r of buys) {
    const k = keyOf(r)
    const x = m.get(k) || { date: k, aud: 0, sats: 0, count: 0, autos: 0 }
    x.aud += r.aud; x.sats += r.sats; x.count += 1
    if (r.type === 'buy_recurring') x.autos += 1
    m.set(k, x)
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date))
    .map(x => ({ ...x, priceAud: x.aud / (x.sats / SATS), type: group, auto: x.autos === x.count }))
}

/** BTC held over time: the running total of buys and transfers in, as steps. */
export function cumulativeSteps(rows, transfers = []) {
  const events = [
    ...rows.filter(isPurchase).map(r => [r.date, r.sats]),
    ...transfers.map(t => [t.date, t.sats || 0])
  ].sort((a, b) => a[0].localeCompare(b[0]))
  const out = []
  let total = 0
  for (const [d, s] of events) {
    if (out.length && out[out.length - 1][0] === d) { total += s; out[out.length - 1][1] = total / SATS; continue }
    if (out.length) out.push([d, out[out.length - 1][1]])
    total += s
    out.push([d, total / SATS])
  }
  return out
}

/** Dot area proportional to A$: radius by square root, so small buys stay visible. */
export function dotRadius(aud, maxAud, { min = 2.5, max = 16 } = {}) {
  if (!(aud > 0) || !(maxAud > 0)) return min
  return Math.max(min, max * Math.sqrt(aud / maxAud))
}
