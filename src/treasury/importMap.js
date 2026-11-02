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
  if (/company|technomed|pty|business|\btm\b/.test(s)) return 'company'
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
  ato: v => mapList(v, o => {
    const amount = toNumber(pickKey(o, AMOUNT))
    const due = toDay(pickKey(o, DUE))
    if (amount == null || !due) return { reason: 'needs an amount and a due date' }
    const st = String(pickKey(o, ['status', 'state']) ?? (pickKey(o, ['paid', 'done']) ? 'paid' : '')).toLowerCase()
    return {
      id: id(), due, amount,
      label: String(pickKey(o, ['label', 'name', 'type', 'what', ...NOTE]) || 'ATO payment'),
      status: /paid|done|complete|true/.test(st) ? 'paid' : 'due'
    }
  }),

  dca: v => mapList(v, o => {
    const date = toDay(pickKey(o, DATE))
    const amount = toNumber(pickKey(o, AMOUNT))
    let sats = satsOf(o)
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
      netWorth: n(['netWorth', 'total', 'nw'])
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

  payroll: v => {
    const amount = typeof v === 'object' && v ? toNumber(pickKey(v, ['amount', 'fortnight', 'fortnightly', 'net', 'gross', 'total'])) : toNumber(v)
    if (amount == null) return { error: 'expected a fortnightly payroll amount' }
    const nextDate = typeof v === 'object' && v ? toDay(pickKey(v, ['next', 'nextDate', 'nextPay', 'date'])) : null
    return { settings: { payroll: { amount, nextDate } }, records: [1] }
  }
}

const SUPERSEDED = {
  inv: 'Invoices now come live from Xero',
  onchain: 'On-chain history now comes from BGeometrics automatically'
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
    btc: 'Holdings', cashBank: 'Manual cash at bank', dcaPlan: 'DCA settings', payroll: 'Payroll'
  }

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
    if (r.settings) data.settings = { ...data.settings, ...r.settings }
    report.mapped.push({ key, to: LABEL[key], count: r.records.length })
    for (const s of r.skipped || []) report.skipped.push({ key, ...s })
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
