// ─── Treasury arithmetic ─────────────────────────────────────────────────────
// Pure functions, shared by the server (which decides) and the screens (which
// show the same numbers). Nothing here fetches or stores.
//
// Days are "YYYY-MM-DD" strings in Australia/Hobart, as everywhere else in the
// portal — see src/clinicalPlan/week.js.

import { parseDateStr, addCivilDays, toDateStr, mondayOf } from '../clinicalPlan/week.js'

export const ENTITIES = [
  { id: 'company', label: 'TechnoMed Pty Ltd' },
  { id: 'trust', label: 'Family trust' },
  { id: 'personal', label: 'Personal' },
  { id: 'smsf', label: 'SMSF' }
]

export const DEFAULT_SETTINGS = {
  baseWeekly: 1700,
  dailyAuto: 150,
  amberCash: 0,
  amberCashAt: null,
  dcaEntity: 'company',
  payroll: { amount: 0, nextDate: null },
  manualCash: null
}

export const SATS = 100_000_000

export function addDays(day, n) {
  return toDateStr(addCivilDays(parseDateStr(day), n))
}

export function weekStart(day) {
  return toDateStr(mondayOf(parseDateStr(day)))
}

// ─── Dynamic DCA ─────────────────────────────────────────────────────────────

/** MVRV Z-score band. Lower bound inclusive: exactly 1.0 is in "1 to 2". */
export function zBand(z) {
  if (z < 0) return 2.0
  if (z < 1) return 1.5
  if (z < 2) return 1.0
  if (z < 3) return 0.75
  if (z < 5) return 0.5
  if (z < 7) return 0.25
  return 0
}

/** STH-SOPR adjustment. 1.00 and 1.03 both sit in the neutral band. */
export function soprAdjust(s) {
  if (s < 0.98) return 0.5
  if (s < 1.0) return 0.25
  if (s <= 1.03) return 0
  return -0.25
}

/** STH-MVRV adjustment. 0.90 and 1.20 both sit in the neutral band. */
export function sthMvrvAdjust(m) {
  if (m < 0.9) return 0.25
  if (m <= 1.2) return 0
  return -0.25
}

export const MULTIPLIER_CAP = 2.5

export function roundTo(n, step) {
  return Math.round(n / step) * step
}

/**
 * This week's buy.
 *
 * @param {{mvrvZ:number, sthSopr:number, sthMvrv:number}} m  latest readings
 * @param {{baseWeekly:number, dailyAuto:number, amberCash:number}} s
 * @param {{asOf?: string, today?: string}} [opts]  asOf is the date of the
 *   oldest of the three readings; it drives the "more than a week old" warning.
 */
export function dcaPlan(m, s, { asOf = null, today = null } = {}) {
  const have = [m?.mvrvZ, m?.sthSopr, m?.sthMvrv].every(v => Number.isFinite(v))
  if (!have) return { ready: false, reason: 'On-chain data has not arrived yet' }
  const band = zBand(m.mvrvZ)
  const sopr = soprAdjust(m.sthSopr)
  const sth = sthMvrvAdjust(m.sthMvrv)
  const raw = band + sopr + sth
  const multiplier = Math.min(MULTIPLIER_CAP, Math.max(0, raw))
  const base = Number(s.baseWeekly) || 0
  const daily = Number(s.dailyAuto) || 0
  const amber = Math.max(0, Number(s.amberCash) || 0)
  const target = roundTo(base * multiplier, 50)
  // Never more than the Amber cash entered. Rounded down to the $50 step so the
  // cap itself cannot round back up past what is there.
  const capped = target > amber
  const total = capped ? Math.floor(amber / 50) * 50 : target
  const autoWeek = 7 * daily
  const topUp = Math.max(0, total - autoWeek)
  const weeksLeft = total > 0 ? amber / total : null
  const ageDays = asOf && today ? daysBetween(asOf, today) : null
  return {
    ready: true,
    parts: { band, sopr, sth, raw },
    multiplier, target, total, capped, autoWeek, topUp,
    // When the plan is below what the daily auto-buy spends anyway.
    autoExceeds: autoWeek > total ? autoWeek - total : 0,
    weeksLeft, asOf, ageDays,
    stale: ageDays != null && ageDays > 7
  }
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3)
}

// ─── Key levels ──────────────────────────────────────────────────────────────

export const LEVELS = [
  { id: 'sthRealizedPrice', label: 'STH cost basis' },
  { id: 'realizedPrice', label: 'Realised price' },
  { id: 'lthRealizedPrice', label: 'LTH cost basis' }
]

/** Each cost basis and how far price is above (+) or below (−) it, in %. */
export function keyLevels(priceUsd, latest) {
  return LEVELS.map(l => {
    const level = latest?.[l.id]
    const pct = priceUsd > 0 && level > 0 ? (priceUsd / level - 1) * 100 : null
    return { ...l, level: level ?? null, pct }
  })
}

/** "Price is 2.5% above the STH cost basis" — the line under the charts. */
export function summaryLine(priceUsd, latest) {
  const sth = keyLevels(priceUsd, latest).find(l => l.id === 'sthRealizedPrice')
  if (sth?.pct == null) return null
  const pct = Math.abs(sth.pct).toFixed(1)
  if (Math.abs(sth.pct) < 0.05) return 'Price is sitting on the STH cost basis.'
  const side = sth.pct > 0 ? 'above' : 'below'
  let line = `Price is ${pct}% ${side} the STH cost basis`
  const sopr = latest?.sthSopr
  if (Number.isFinite(sopr)) {
    line += sopr < 1
      ? ', and short-term holders are selling at a loss (STH-SOPR below 1).'
      : ', and short-term holders are selling in profit (STH-SOPR above 1).'
  } else line += '.'
  return line
}

/** The last value of each series, and the date of each. */
export function latestOf(series) {
  const values = {}
  const dates = {}
  for (const [id, s] of Object.entries(series || {})) {
    if (s?.length) { values[id] = s[s.length - 1][1]; dates[id] = s[s.length - 1][0] }
  }
  return { values, dates }
}

/** The part of a series a chart shows: 3 months, a year, or everything thinned to weekly. */
export function slice(series, range, today) {
  if (!series?.length) return []
  if (range === '3m' || range === '1y') {
    const from = addDays(today, range === '3m' ? -92 : -366)
    return series.filter(([d]) => d >= from)
  }
  const out = series.filter((_, i) => i % 7 === 0)
  if (out[out.length - 1] !== series[series.length - 1]) out.push(series[series.length - 1])
  return out
}

// ─── Reading a typed BTC amount ──────────────────────────────────────────────
// "4.20005325" and "4,20005325" are the same number to a person: an iPhone set
// to a comma-decimal region puts a comma on the decimal key. Stripping commas
// as thousands separators turned that into 420,005,325 BTC. A lone comma with
// no full stop is read as the decimal point; commas alongside a full stop, or
// more than one, are thousands separators. Nothing over the 21 million that can
// ever exist is accepted, so a slip cannot pass as a holding.

export const MAX_BTC = 21_000_000

/** @returns {{sats: number|null, error: string|null}} blank is 0 sats. */
export function parseBtc(input) {
  let s = String(input ?? '').replace(/[\s\u00a0'₿]|BTC/gi, '')
  if (s === '') return { sats: 0, error: null }
  const commas = (s.match(/,/g) || []).length
  if (commas === 1 && !s.includes('.')) s = s.replace(',', '.')
  else s = s.replace(/,/g, '')
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return { sats: null, error: 'Not a number' }
  const btc = Number(s)
  if (!Number.isFinite(btc)) return { sats: null, error: 'Not a number' }
  if (btc > MAX_BTC) return { sats: null, error: 'More than 21 million BTC — check the decimal point' }
  const decimals = (s.split('.')[1] || '').length
  if (decimals > 8) return { sats: null, error: 'BTC has at most 8 decimal places' }
  return { sats: Math.round(btc * SATS), error: null }
}

/**
 * More than any one entity here plausibly holds. Not a limit — a prompt to
 * look again: a stray 1,436.7 in the wrong field passed every other check.
 */
export const LARGE_BTC = 100

export function isLargeBtc(sats) {
  return sats > LARGE_BTC * SATS
}

/** Sats as a plain BTC string for a field — never exponent notation. */
export function satsToBtcText(sats) {
  if (!sats) return ''
  return (sats / SATS).toFixed(8).replace(/\.?0+$/, '')
}

/** A typed dollar amount: "$563,993.50" → 563993.5; blank → 0; junk → null. */
export function parseMoney(input) {
  const s = String(input ?? '').replace(/[\s$]|AUD|A\$/gi, '').replace(/,/g, '')
  if (s === '') return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// ─── Holdings ────────────────────────────────────────────────────────────────

/** Each entity's BTC, value and unrealised P/L, and the total. */
export function holdingsView(holdings, priceAud) {
  const rows = ENTITIES.map(e => {
    const h = holdings?.[e.id] || {}
    const sats = Math.round((Number(h.exchangeSats) || 0) + (Number(h.coldSats) || 0))
    const cost = Number(h.costAud) || 0
    const value = priceAud > 0 ? (sats / SATS) * priceAud : null
    return {
      ...e, exchangeSats: Number(h.exchangeSats) || 0, coldSats: Number(h.coldSats) || 0,
      sats, btc: sats / SATS, costAud: cost, value,
      pl: value == null ? null : value - cost,
      plPct: value == null || cost <= 0 ? null : (value / cost - 1) * 100
    }
  })
  const sats = rows.reduce((s, r) => s + r.sats, 0)
  const cost = rows.reduce((s, r) => s + r.costAud, 0)
  const value = priceAud > 0 ? (sats / SATS) * priceAud : null
  return { rows, total: { sats, btc: sats / SATS, costAud: cost, value, pl: value == null ? null : value - cost } }
}

// ─── ATO and the 13-week cash view ───────────────────────────────────────────

export function atoOutlook(schedule, today) {
  const open = (schedule || []).filter(a => a.status !== 'paid' && a.due)
    .sort((a, b) => a.due.localeCompare(b.due))
  const within = days => {
    const until = addDays(today, days)
    return open.filter(a => a.due <= until).reduce((s, a) => s + (Number(a.amount) || 0), 0)
  }
  return {
    next: open[0] || null,
    overdue: open.filter(a => a.due < today),
    due30: within(30),
    due90: within(90)
  }
}

/** Payroll dates, fortnightly from the next pay date, up to (and including) `until`. */
export function payDates(nextDate, from, until) {
  if (!nextDate) return []
  let d = nextDate
  while (d < from) d = addDays(d, 14)
  const out = []
  while (d <= until) { out.push(d); d = addDays(d, 14) }
  return out
}

/**
 * Thirteen weeks from the Monday of this week.
 *
 * Opening balance is cash at bank. Each week: plus invoices falling due, minus
 * bills falling due, minus ATO, minus payroll, plus or minus one-off items.
 * Overdue receivables are not counted in any week — when they arrive is not
 * known — and are reported separately so they can be judged by eye.
 */
export function cashForecast({ today, opening, receivables = [], payables = [], ato = [], payroll = {}, oneOffs = [] }) {
  const start = weekStart(today)
  const weeks = []
  let balance = Number(opening) || 0
  const inWeek = (day, from, to) => day && day >= from && day <= to
  for (let i = 0; i < 13; i++) {
    const from = addDays(start, i * 7)
    const to = addDays(from, 6)
    // Week one also takes anything due earlier this week that is not overdue yet.
    const recv = receivables.filter(r => r.due >= today && inWeek(r.due, from, to)).reduce((s, r) => s + r.amountDue, 0)
    const bills = payables.filter(b => (i === 0 ? b.due && b.due <= to : inWeek(b.due, from, to))).reduce((s, b) => s + b.amountDue, 0)
    const tax = ato.filter(a => a.status !== 'paid' && (i === 0 ? a.due && a.due <= to : inWeek(a.due, from, to))).reduce((s, a) => s + (Number(a.amount) || 0), 0)
    const pay = payDates(payroll.nextDate, from, to).length * (Number(payroll.amount) || 0)
    const other = oneOffs.filter(o => inWeek(o.date, from, to)).reduce((s, o) => s + (Number(o.amount) || 0), 0)
    const net = recv - bills - tax - pay + other
    balance += net
    weeks.push({ from, to, receipts: recv, bills, ato: tax, payroll: pay, other, net, closing: balance })
  }
  const overdueReceivables = receivables.filter(r => r.due && r.due < today).reduce((s, r) => s + r.amountDue, 0)
  return { weeks, opening: Number(opening) || 0, overdueReceivables, low: weeks.reduce((m, w) => Math.min(m, w.closing), Infinity) }
}

// ─── Family trust ledger ─────────────────────────────────────────────────────

export const TRUST_CATEGORIES = ['Distribution', 'Loan', 'Loan repayment', 'Transfer', 'Income', 'Expense', 'Other']

/** "FY27" for 1 July 2026 – 30 June 2027. */
export function fyLabel(day) {
  const [y, m] = day.split('-').map(Number)
  const end = m >= 7 ? y + 1 : y
  return `FY${String(end).slice(-2)}`
}

export function trustTotals(entries, fy) {
  const list = (entries || []).filter(e => !fy || fyLabel(e.date) === fy)
  const by = key => {
    const m = new Map()
    for (const e of list) m.set(e[key] || '—', (m.get(e[key] || '—') || 0) + (Number(e.amount) || 0))
    return [...m.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
  }
  return { count: list.length, total: list.reduce((s, e) => s + (Number(e.amount) || 0), 0), byCategory: by('category'), byParty: by('party') }
}

function csvCell(v) {
  const s = v == null ? '' : String(v)
  // A leading = + - @ makes a spreadsheet run the cell as a formula.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(header, rows) {
  return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function trustCsv(entries, fy) {
  const list = (entries || []).filter(e => !fy || fyLabel(e.date) === fy)
    .sort((a, b) => a.date.localeCompare(b.date))
  return toCsv(['Date', 'FY', 'Category', 'Party', 'Amount (AUD)', 'Note'],
    list.map(e => [e.date, fyLabel(e.date), e.category, e.party, (Number(e.amount) || 0).toFixed(2), e.note || '']))
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function aud(n, { cents = false } = {}) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD', maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: cents ? 2 : 0
  }).format(n)
}

export function usd(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return 'US' + new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export function btc(sats) {
  if (sats == null) return '—'
  return `₿${(sats / SATS).toLocaleString('en-AU', { minimumFractionDigits: 4, maximumFractionDigits: 8 })}`
}

export function pct(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`
}
