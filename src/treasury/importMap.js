// ─── Importing the old tracker ───────────────────────────────────────────────
// The old tracker was a Claude artifact whose export is a JSON object with keys
// like ato, btc, cashBank, dca, dcaPlan, inv, onchain, trustLog, history, plan,
// val, payroll and todo. Its exact shapes were never written down, so every
// mapper here is tolerant: it looks for the fields a thing must have under the
// names a person would have used, takes what it can, and lists the rest.
//
// Nothing is guessed silently. Each key ends up in exactly one of:
//   mapped      → where it went and how many records
//   superseded  → deliberately not imported, because a live source replaces it
//   unmapped    → could not be read; shown to Brent with the reason
// and each record that a mapper had to skip is listed with its position.
//
// Pure. The server runs it twice — once to preview, once to save — and never
// keeps the uploaded file.

import { ENTITIES, SATS } from './logic.js'

const pickKey = (o, names) => {
  if (!o || typeof o !== 'object') return undefined
  const keys = Object.keys(o)
  for (const n of names) {
    const k = keys.find(k => k.toLowerCase() === n.toLowerCase())
    if (k !== undefined && o[k] !== '' && o[k] != null) return o[k]
  }
  return undefined
}

export function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const neg = /^\s*\(.*\)\s*$/.test(v)
  const n = Number(v.replace(/[$,\s()A]|AUD|aud/g, ''))
  return Number.isFinite(n) ? (neg ? -n : n) : null
}

/** "2026-07-28", "28/07/2026", "28 Jul 2026", an ISO timestamp → "2026-07-28". */
export function toDay(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v).toISOString().slice(0, 10)
  const s = String(v).trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  const t = Date.parse(s)
  if (Number.isFinite(t)) {
    const d = new Date(t)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return null
}

const asList = v => Array.isArray(v) ? v : (v && typeof v === 'object' && Array.isArray(v.items) ? v.items : null)

const DATE = ['date', 'd', 'when', 'day', 'paidOn', 'boughtOn']
const DUE = ['due', 'dueDate', 'due_date', 'date', 'when']
const AMOUNT = ['amount', 'amt', 'aud', 'value', 'total', 'a$', 'cost', 'spent']
const NOTE = ['note', 'notes', 'memo', 'description', 'desc', 'comment']
const id = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

function satsOf(o) {
  const sats = toNumber(pickKey(o, ['sats', 'satoshis', 'sat']))
  if (sats != null) return Math.round(sats)
  const b = toNumber(pickKey(o, ['btc', 'xbt', 'coins', 'qty', 'quantity']))
  return b != null ? Math.round(b * SATS) : null
}

function entityOf(name) {
  const s = String(name || '').toLowerCase()
  if (/smsf|super/.test(s)) return 'smsf'
  if (/trust|family/.test(s)) return 'trust'
  // Company before personal: "TechnoMed" contains "me".
  if (/company|technomed|pty|business|\btm\b|\bcorp/.test(s)) return 'company'
  if (/personal|^me$|\bself\b|\bbrent/.test(s)) return 'personal'
  return null
}

// ─── One mapper per key ──────────────────────────────────────────────────────

function mapList(value, read) {
  const list = asList(value)
  if (!list) return { error: 'expected a list' }
  const records = []
  const skipped = []
  list.forEach((item, i) => {
    const r = read(item)
    if (r && !r.reason) records.push(r)
    else skipped.push({ index: i, reason: r?.reason || 'unreadable' })
  })
  return { records, skipped }
}

const MAPPERS = {
  ato: v => (v && !Array.isArray(v) && typeof v === 'object' && !Array.isArray(v.items) ? atoFromTracker(v) : mapList(v, o => {
    const amount = toNumber(pickKey(o, AMOUNT))
    const due = toDay(pickKey(o, DUE))
    if (amount == null || !due) return { reason: 'needs an amount and a due date' }
    const st = String(pickKey(o, ['status', 'state']) ?? (pickKey(o, ['paid', 'done']) ? 'paid' : '')).toLowerCase()
    return {
      id: id(), due, amount,
      label: String(pickKey(o, ['label', 'name', 'type', 'what', ...NOTE]) || 'ATO payment'),
      status: /paid|done|complete|true/.test(st) ? 'paid' : 'due'
    }
  })),

  // The tracker's own shape is {log: [{d, a, b, note}]} — a is A$, b is BTC —
  // and that log was TechnoMed's DCA, so its buys are the company's.
  dca: v => mapList(v && !Array.isArray(v) && Array.isArray(v.log) ? v.log.map(x => ({ entity: 'company', ...x })) : v, o => {
    const date = toDay(pickKey(o, DATE))
    const amount = toNumber(pickKey(o, [...AMOUNT, 'a']))
    let sats = satsOf(o)
    if (sats == null) { const b = toNumber(pickKey(o, ['b'])); if (b != null) sats = Math.round(b * SATS) }
    let price = toNumber(pickKey(o, ['price', 'priceAud', 'rate', 'btcPrice']))
    if (!date || amount == null) return { reason: 'needs a date and an amount' }
    if (sats == null && price > 0) sats = Math.round((amount / price) * SATS)
    if (price == null && sats > 0) price = amount / (sats / SATS)
    return {
      id: id(), date, aud: amount, sats: sats ?? null, priceAud: price ?? null,
      entity: entityOf(pickKey(o, ['entity', 'who', 'account'])) || null,
      note: pickKey(o, NOTE) || ''
    }
  }),

  trustLog: v => mapList(v, o => {
    const date = toDay(pickKey(o, DATE))
    const amount = toNumber(pickKey(o, AMOUNT))
    if (!date || amount == null) return { reason: 'needs a date and an amount' }
    return {
      id: id(), date, amount,
      category: String(pickKey(o, ['category', 'cat', 'type', 'kind']) || 'Other'),
      party: String(pickKey(o, ['party', 'to', 'from', 'who', 'beneficiary', 'counterparty']) || ''),
      note: String(pickKey(o, NOTE) || '')
    }
  }),

  history: v => mapList(v, o => {
    const day = toDay(pickKey(o, ['month', ...DATE, 'at', 'takenAt']))
    if (!day) return { reason: 'needs a date or month' }
    const n = k => toNumber(pickKey(o, k))
    return {
      month: day.slice(0, 7), takenAt: `${day}T00:00:00.000Z`, imported: true,
      cash: n(['cash', 'cashBank', 'bank']), receivables: n(['receivables', 'owed', 'ar', 'debtors']),
      overdue: n(['overdue']), profitFy: n(['profit', 'profitFy', 'pl', 'np']),
      btcAud: n(['btcAud', 'priceAud', 'btcPrice', 'price']),
      totalSats: satsOf(o), amberCash: n(['amber', 'amberCash']),
      btcValueAud: n(['btcValue', 'btcValueAud', 'btcAudValue']),
      netWorth: n(['netWorth', 'netAssets', 'total', 'nw'])
    }
  }),

  btc: v => {
    // Either {company: 0.5, trust: {...}} or a list of {entity, btc, cost}.
    const rows = Array.isArray(v) ? v : (v && typeof v === 'object'
      ? Object.entries(v).map(([k, x]) => (x && typeof x === 'object' ? { entity: k, ...x } : { entity: k, btc: x }))
      : null)
    if (!rows) return { error: 'expected holdings by entity' }
    const holdings = {}
    const skipped = []
    rows.forEach((r, i) => {
      const e = entityOf(pickKey(r, ['entity', 'name', 'who', 'account', 'label']))
      const sats = satsOf(r)
      if (!e || sats == null) { skipped.push({ index: i, reason: `not an entity with a BTC amount (${String(pickKey(r, ['entity', 'name']) || '?').slice(0, 30)})` }); return }
      const cold = /cold|ledger|trezor|coldcard/i.test(String(pickKey(r, ['where', 'location', 'wallet', 'type']) || ''))
      const h = holdings[e] || { exchangeSats: 0, coldSats: 0, costAud: 0 }
      if (cold) h.coldSats += sats; else h.exchangeSats += sats
      const coldOwn = toNumber(pickKey(r, ['cold', 'coldSats', 'coldStorage', 'coldBtc']))
      if (coldOwn != null) h.coldSats += coldOwn < 1000 ? Math.round(coldOwn * SATS) : Math.round(coldOwn)
      h.costAud += toNumber(pickKey(r, ['cost', 'costBase', 'costAud', 'basis', 'invested'])) || 0
      holdings[e] = h
    })
    return { holdings, records: Object.keys(holdings), skipped }
  },

  cashBank: v => {
    const amount = typeof v === 'object' && v ? toNumber(pickKey(v, ['balance', ...AMOUNT])) : toNumber(v)
    if (amount == null) return { error: 'expected a balance' }
    const at = typeof v === 'object' && v ? toDay(pickKey(v, [...DATE, 'at', 'asOf'])) : null
    return { settings: { manualCash: { amount, at } }, records: [1] }
  },

  dcaPlan: v => {
    if (!v || typeof v !== 'object') return { error: 'expected settings' }
    const s = {}
    const base = toNumber(pickKey(v, ['base', 'baseWeekly', 'weekly', 'baseBuy']))
    const daily = toNumber(pickKey(v, ['daily', 'dailyAuto', 'auto', 'dailyBuy']))
    const amber = toNumber(pickKey(v, ['amber', 'amberCash', 'cash']))
    if (base != null) s.baseWeekly = base
    if (daily != null) s.dailyAuto = daily
    if (amber != null) s.amberCash = amber
    if (!Object.keys(s).length) return { error: 'no base, daily or Amber figure found' }
    return { settings: s, records: Object.keys(s) }
  },

  val: v => {
    const cost = v && typeof v === 'object' ? toNumber(pickKey(v, ['btcCost'])) : null
    if (cost == null) return { error: 'no BTC cost base found' }
    return { companyCost: cost, records: [1], note: 'TechnoMed BTC cost base only; the valuation settings are not carried over' }
  },

  payroll: v => {
    const amount = typeof v === 'object' && v ? toNumber(pickKey(v, ['amount', 'fortnight', 'fortnightly', 'net', 'gross', 'total'])) : toNumber(v)
    if (amount == null) return { error: 'expected a fortnightly payroll amount' }
    const nextDate = typeof v === 'object' && v ? toDay(pickKey(v, ['next', 'nextDate', 'nextPay', 'date'])) : null
    return { settings: { payroll: { amount, nextDate } }, records: [1] }
  }
}

const SUPERSEDED = {
  onchain: 'On-chain history now comes from BGeometrics automatically',
  heat: 'On-chain readings now come from BGeometrics automatically',
  xero: 'Company figures now come live from Xero',
  spot: 'BTC price now comes live from Kraken',
  fxUsd: 'AUD and USD prices now come live from Kraken',
  updatedAt: 'Tracker housekeeping', tlSeed1: 'Tracker housekeeping', cashBankAt: 'Tracker housekeeping'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The tracker's `ato` object. Its schedule was worked out on screen from
 * assumptions, so only what it holds as known, dated amounts comes across:
 * lodged BAS/IAS amounts (`actual`), the FY26 tax balance and the personal tax.
 * The assumptions themselves are listed as skipped for Brent to re-enter.
 */
function atoFromTracker(v) {
  const records = []
  const skipped = []
  const paid = v.paid || {}
  for (const [key, a] of Object.entries(v.actual || {})) {
    const m = /^(bas|ias)-(\d{4})-(\d{2})/.exec(key)
    const amount = toNumber(a?.amt ?? a?.amount)
    const due = toDay(a?.due)
    if (amount == null || !due) { skipped.push({ index: key, reason: 'lodged amount without an amount or due date' }); continue }
    const label = m ? `${m[1].toUpperCase()} ${MONTHS[Number(m[3]) - 1]} ${m[2]}` : key
    records.push({ id: id(), due, amount, label: a?.inst ? `${label} (incl. ${a.inst} instalment)` : label, status: paid[key] ? 'paid' : 'due' })
  }
  const fy26 = toNumber(v.fy26Bal)
  if (fy26 && toDay(v.fy26Due)) {
    records.push({ id: id(), due: toDay(v.fy26Due), amount: fy26, status: 'due',
      label: v.fy26Plan === 'monthly' && v.fy26Monthly ? `FY26 company tax balance (paying ${v.fy26Monthly}/month from ${v.fy26From || 'Dec'})` : 'FY26 company tax balance' })
  }
  const pers = toNumber(v.persTax)
  if (pers && toDay(v.persDue)) records.push({ id: id(), due: toDay(v.persDue), amount: pers, status: 'due', label: 'FY26 personal tax, Brenton and Emma' })
  const assumptions = ['withholding', 'gstRate', 'gstIn', 'inst', 'atoInst', 'q1Inst', 'emmaInst', 'owedAdj', 'toInv', 'amex']
    .filter(k => v[k] !== undefined && v[k] !== '' && v[k] !== 0)
  if (assumptions.length) skipped.push({ index: 'assumptions', reason: `estimating settings not carried over: ${assumptions.join(', ')}` })
  if (!records.length) return { error: 'no dated ATO amounts found' }
  return { records, skipped }
}

/**
 * @returns {{
 *   data: {ato, dca, trust, snapshots, holdings, settings},
 *   report: {mapped: Array, superseded: Array, unmapped: Array, skipped: Array}
 * }}
 */
export function mapTracker(json) {
  const data = { ato: [], dca: [], trust: [], snapshots: [], holdings: null, settings: {} }
  const report = { mapped: [], superseded: [], unmapped: [], skipped: [] }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    report.unmapped.push({ key: '(file)', reason: 'Not a tracker export — expected a JSON object' })
    return { data, report }
  }
  const TARGET = { ato: 'ato', dca: 'dca', trustLog: 'trust', history: 'snapshots' }
  const LABEL = {
    ato: 'ATO schedule', dca: 'DCA purchase log', trustLog: 'Trust ledger', history: 'Snapshots',
    btc: 'Holdings', cashBank: 'Manual cash at bank', dcaPlan: 'DCA settings', payroll: 'Payroll',
    val: 'TechnoMed BTC cost base'
  }

  let companyCost = null
  for (const [key, value] of Object.entries(json)) {
    if (SUPERSEDED[key]) { report.superseded.push({ key, reason: SUPERSEDED[key] }); continue }
    const mapper = MAPPERS[key]
    if (!mapper) {
      report.unmapped.push({ key, reason: 'No matching section in Treasury', preview: describe(value) })
      continue
    }
    let r
    try { r = mapper(value) } catch { r = { error: 'could not be read' } }
    if (r.error) { report.unmapped.push({ key, reason: r.error, preview: describe(value) }); continue }
    if (TARGET[key]) data[TARGET[key]].push(...r.records)
    if (r.holdings) data.holdings = r.holdings
    if (r.companyCost != null) companyCost = r.companyCost
    if (r.settings) data.settings = { ...data.settings, ...r.settings }
    report.mapped.push({ key, to: LABEL[key], count: r.records.length, ...(r.note ? { note: r.note } : {}) })
    for (const s of r.skipped || []) report.skipped.push({ key, ...s })
  }
  // The cost base arrives under a different key from the coins; join them
  // whichever came first in the file.
  if (companyCost != null) {
    data.holdings = data.holdings || {}
    const c = data.holdings.company || { exchangeSats: 0, coldSats: 0, costAud: 0 }
    data.holdings.company = { ...c, costAud: companyCost }
  }
  return { data, report }
}

/** A shape, not the content: "list of 12", "object with 3 keys (a, b, c)". */
function describe(v) {
  if (Array.isArray(v)) return `list of ${v.length}`
  if (v && typeof v === 'object') {
    const keys = Object.keys(v)
    return `object with ${keys.length} key${keys.length === 1 ? '' : 's'}${keys.length ? ` (${keys.slice(0, 6).join(', ')}${keys.length > 6 ? '…' : ''})` : ''}`
  }
  return typeof v
}

export { ENTITIES }
