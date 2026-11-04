// ─── SelfWealth cash reports ─────────────────────────────────────────────────
// The family trust's investments, from SelfWealth's "Cash Report" PDF: every
// trade, distribution, withholding, fee, tax refund and currency conversion on
// the account. SelfWealth has no API and its CSV exports are thinner than this
// report, so the report is the record.
//
// The phone pulls the text out of the PDF with each piece's position on the
// page (readCashReport.js); this turns those pieces into rows. A row starts
// at a date in the Date column; a description that wraps onto a second line
// sits just below it. Which column an amount is in says whether it is a
// credit, a debit or the running balance — and the running balance is then
// used to check that every row was read: opening balance plus the rows must
// come to the closing balance, or the import says so.
//
// Pure: no fetching, no storing. Tested with invented reports only.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const DATE = /^(\d{1,2}) ([A-Za-z]+) (\d{4}) (\d{2}):(\d{2}):(\d{2})$/

/** "7 July 2026 00:00:00" → {date: "2026-07-07", at: "2026-07-07T00:00:00"}. */
export function readReportDate(s) {
  const m = DATE.exec(String(s || '').trim())
  if (!m) return null
  const month = MONTHS[m[2].toLowerCase().slice(0, 4)] || MONTHS[m[2].toLowerCase().slice(0, 3)]
  if (!month) return null
  const date = `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return { date, at: `${date}T${m[4]}:${m[5]}:${m[6]}` }
}

/** "$1,288.88" → 1288.88; "-$74.59" → -74.59. */
export function readMoney(s) {
  const t = String(s || '').trim()
  if (!/^-?\$[\d,]+(\.\d+)?$/.test(t)) return null
  const n = Number(t.replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : null
}

// Column edges, in PDF points from the left. The Date column ends before the
// description starts at ~164; Credit sits at ~384, Debit ~450–465, Balance
// ~510–530. The edges are set midway between, so a slightly wider amount
// still lands in the right column.
export const COLUMNS = { descFrom: 160, creditTo: 430, debitTo: 495 }

/**
 * Text pieces → the report's rows.
 * @param {Array<{p:number, x:number, y:number, s:string}>} items  y grows upwards, as in PDF
 * @returns {{account, opening, closing, rows: Array<{at, date, desc, credit, debit, balance}>}}
 */
export function rowsFromItems(items) {
  const sorted = [...items].filter(i => String(i.s).trim()).sort((a, b) => a.p - b.p || b.y - a.y || a.x - b.x)
  const rows = []
  let account = null
  let opening = null
  let closing = null
  let current = null
  let pendingLabel = null

  for (const it of sorted) {
    const s = String(it.s).trim()
    const when = it.x < COLUMNS.descFrom ? readReportDate(s) : null
    if (when) {
      current = { p: it.p, y: it.y, at: when.at, date: when.date, parts: [], credit: null, debit: null, balance: null }
      rows.push(current)
      continue
    }
    if (/^MR |^MRS |^MS |<.*>/.test(s) && !account && it.x < 200) { account = s; continue }
    if (s === 'Opening Balance') { pendingLabel = 'opening'; current = null; continue }
    if (/^Closing Balance/.test(s)) { pendingLabel = 'closing'; current = null; continue }
    const money = readMoney(s)
    if (pendingLabel && money != null && it.x >= COLUMNS.debitTo) {
      if (pendingLabel === 'opening') opening = money; else closing = money
      pendingLabel = null
      continue
    }
    // Belongs to the row whose date it sits beside, or just below (a wrapped line).
    if (!current || current.p !== it.p || it.y > current.y + 2 || current.y - it.y > 16) continue
    if (money != null && it.x >= COLUMNS.descFrom + 150) {
      if (it.x < COLUMNS.creditTo) current.credit = money
      else if (it.x < COLUMNS.debitTo) current.debit = money
      else current.balance = money
    } else if (it.x >= COLUMNS.descFrom) {
      current.parts.push(s)
    }
  }
  return {
    account, opening, closing,
    rows: rows.map(({ parts, p: _p, y: _y, ...r }) => ({ ...r, desc: parts.join(' ').replace(/\s+/g, ' ').trim() }))
  }
}

// ─── What each line is ───────────────────────────────────────────────────────

const N = '(\\d+(?:\\.\\d+)?)'

// Older reports name the fund rather than the ticker.
const FUNDS = [[/YieldMax MSTR Option Income/i, 'MSTY']]
const tickerOf = name => (FUNDS.find(([re]) => re.test(name)) || [null, name.trim()])[1]

// SelfWealth has worded these lines three ways since 2025; all are read.
const PATTERNS = [
  // 2025: "WHT 3999 MSTY CASHDIV @ USD 1.2382", "Cash Div Fee 3999 MSTY CASHDIV @ USD 1.2382"
  [new RegExp(`^WHT ${N} ([A-Z.]+) CASHDIV @ USD ${N}$`, 'i'), m => ({ kind: 'withholding', units: +m[1], ticker: m[2], perUnit: +m[3] })],
  [new RegExp(`^Cash Div Fee ${N} ([A-Z.]+) CASHDIV @ USD ${N}$`, 'i'), m => ({ kind: 'divfee', units: +m[1], ticker: m[2], perUnit: +m[3] })],
  // Late 2025: three lines with the same words — payment, withholding, fee —
  // told apart by their amounts (see parseCashReport).
  [new RegExp(`^CASH DIV @ USD ${N} LESS TAX (\\d+)% ${N} (.+)$`, 'i'), m => ({ kind: 'cashdiv3', perUnit: +m[1], taxPct: +m[2], units: +m[3], ticker: tickerOf(m[4]) })],
  [new RegExp(`^${N} ([A-Z.]+) CASHDIV @ USD ${N} \\(WITH ?HOLDING TAX\\)$`, 'i'), m => ({ kind: 'withholding', units: +m[1], ticker: m[2], perUnit: +m[3] })],
  [new RegExp(`^${N} ([A-Z.]+) CASHDIV @ USD ${N} \\(Cash Div Fee\\)$`, 'i'), m => ({ kind: 'divfee', units: +m[1], ticker: m[2], perUnit: +m[3] })],
  [new RegExp(`^${N} ([A-Z.]+) CASHDIV @ USD ${N}$`, 'i'), m => ({ kind: 'distribution', units: +m[1], ticker: m[2], perUnit: +m[3] })],
  [new RegExp(`^${N} ([A-Z.]+) TAX REFUND @ USD ${N}$`, 'i'), m => ({ kind: 'refund', units: +m[1], ticker: m[2], perUnit: +m[3] })],
  [new RegExp(`^Order (\\d+): (Buy|Sell) ${N} ([A-Z.]+) @ (?:US)?\\$([\\d,.]+)$`, 'i'), m => ({ kind: m[2].toLowerCase(), order: m[1], units: +m[3], ticker: m[4], price: +m[5].replace(/,/g, '') })],
  [/^Order (\d+): Brokerage (BUY|SELL) ([A-Z.]+)$/i, m => ({ kind: 'brokerage', order: m[1], side: m[2].toLowerCase(), ticker: m[3] })],
  [/^(?:Convert|Transfer) ([\d,.]+) USD to AUD\. Estimate 1 USD = ([\d.]+) AUD$/i, m => ({ kind: 'to_aud', usd: +m[1].replace(/,/g, ''), rate: +m[2] })],
  [/^(?:Convert|Transfer) ([\d,.]+) AUD TO USD\. 1 AUD = ([\d.]+) USD$/i, m => ({ kind: 'from_aud', aud: +m[1].replace(/,/g, ''), rate: +m[2] })]
]

export function classify(desc) {
  for (const [re, make] of PATTERNS) {
    const m = re.exec(desc)
    if (m) return make(m)
  }
  return { kind: 'other' }
}

/**
 * A whole report: rows classified, keyed for de-duplication, and checked.
 * The key includes the running balance, which makes two otherwise identical
 * lines different, and is the same in two reports that overlap.
 */
export function parseCashReport(items) {
  const { account, opening, closing, rows } = rowsFromItems(items)
  if (!rows.length) return { error: 'No transactions found. Is this a SelfWealth Cash Report?' }
  const out = rows.map(r => {
    const amount = r.credit != null ? r.credit : -(r.debit ?? 0)
    const c = classify(r.desc)
    if (c.kind === 'cashdiv3') {
      // The credit is the payment. Of the two debits, the one near the stated
      // tax rate of the payment is withholding; the other is the fee.
      const gross = c.perUnit * c.units
      const tax = gross * c.taxPct / 100
      c.kind = amount > 0 ? 'distribution' : Math.abs(-amount - tax) <= Math.max(1, tax * 0.05) ? 'withholding' : 'divfee'
      delete c.taxPct
    }
    return { key: `${r.at}|${r.desc}|${amount}|${r.balance}`, at: r.at, date: r.date, desc: r.desc, amount, balance: r.balance, ...c }
  })
  // Every row read: opening + the rows = closing, and each running balance follows.
  let running = opening ?? 0
  const breaks = []
  for (const r of out) {
    running = Math.round((running + r.amount) * 100) / 100
    if (r.balance != null && Math.abs(running - r.balance) > 0.011) { breaks.push(r.at); running = r.balance }
  }
  const reconciles = closing == null ? null : Math.abs(running - closing) < 0.011 && !breaks.length
  const currency = out.some(r => r.kind === 'to_aud' || /@ US(D|\$)/.test(r.desc)) ? 'USD' : 'AUD'
  return {
    account, currency, opening, closing, reconciles, breaks,
    from: out[0].date, to: out[out.length - 1].date, rows: out,
    others: out.filter(r => r.kind === 'other').map(r => r.desc)
  }
}

/** Adds rows not already held. */
export function mergeReport(existing = [], incoming = []) {
  const seen = new Set(existing.map(r => r.key))
  const fresh = incoming.filter(r => !seen.has(r.key) && seen.add(r.key))
  return { rows: [...existing, ...fresh].sort((a, b) => a.at.localeCompare(b.at)), added: fresh.length }
}

// ─── The investments, from the rows ──────────────────────────────────────────

export function fyOf(date) {
  const [y, m] = date.split('-').map(Number)
  return `FY${String(m >= 7 ? y + 1 : y).slice(-2)}`
}

/**
 * Holdings by ticker from trades, plus any opening positions held before the
 * first report (entered once by hand). Cost includes brokerage. The units on
 * the latest distribution are what SelfWealth says is held, a check on both.
 */
export function holdingsFrom(rows = [], openings = [], actions = []) {
  const t = {}
  // costUsd is the cost in the holding's own currency: US$ for the USA
  // market, A$ for an ASX holding (currency says which).
  const currencyOf = new Map([
    ...openings.filter(o => o.ticker && o.currency).map(o => [o.ticker, o.currency]),
    ...rows.filter(r => r.ticker && r.currency).map(r => [r.ticker, r.currency])
  ])
  const get = k => (t[k] = t[k] || { ticker: k, currency: currencyOf.get(k) || 'USD', units: 0, costUsd: 0, bought: 0, sold: 0, proceedsUsd: 0, lastDistUnits: null, lastDistDate: null })
  for (const o of openings) { const h = get(o.ticker); h.units += Number(o.units) || 0; h.costUsd += Number(o.costUsd) || 0 }
  const brokerage = new Map(rows.filter(r => r.kind === 'brokerage').map(r => [`${r.order}|${r.side}`, -r.amount]))
  // A consolidation is an event in the timeline like a trade: on its date the
  // units divide by its ratio (the fraction cashed out), and the cost stays.
  const events = [
    ...rows.map(r => ({ date: r.date, at: r.at, r })),
    ...actions.map(a => ({ date: a.date, at: `${a.date}T00:00:00`, a }))
  ].sort((x, y) => x.at.localeCompare(y.at))
  for (const { r, a } of events) {
    if (a) { const h = get(a.ticker); h.units = Math.floor(h.units / (Number(a.ratio) || 1) + 1e-9); continue }
    if (r.kind === 'buy') { const h = get(r.ticker); h.units += r.units; h.bought += r.units; h.costUsd += -r.amount + (brokerage.get(`${r.order}|buy`) || 0) }
    if (r.kind === 'sell') {
      const h = get(r.ticker)
      const avg = h.units > 0 ? h.costUsd / h.units : 0
      h.costUsd -= avg * r.units; h.units -= r.units; h.sold += r.units
      h.proceedsUsd += r.amount - (brokerage.get(`${r.order}|sell`) || 0)
    }
    if (r.kind === 'distribution') { const h = get(r.ticker); h.lastDistUnits = r.units; h.lastDistDate = r.date }
  }
  return Object.values(t).map(h => ({
    ...h, units: Math.round(h.units * 1e6) / 1e6, costUsd: Math.round(h.costUsd * 100) / 100,
    averageUsd: h.units > 0 ? h.costUsd / h.units : null,
    // If the trades do not add up to what SelfWealth paid a distribution on, units are missing — usually from before the first report.
    unitsGap: h.lastDistUnits == null ? null : Math.round((h.lastDistUnits - h.units) * 1e6) / 1e6
  })).sort((a, b) => a.ticker.localeCompare(b.ticker))
}

/** Income by financial year and ticker: gross, withholding, fees, refunds, net (in the holding's currency). */
export function incomeByYear(rows = []) {
  const m = new Map()
  for (const r of rows) {
    if (!['distribution', 'withholding', 'divfee', 'refund'].includes(r.kind)) continue
    const k = `${fyOf(r.date)}|${r.ticker}`
    const x = m.get(k) || { fy: fyOf(r.date), ticker: r.ticker, currency: r.currency || 'USD', gross: 0, withholding: 0, fees: 0, refunds: 0, payments: 0 }
    if (r.kind === 'distribution') { x.gross += r.amount; x.payments += 1 }
    if (r.kind === 'withholding') x.withholding += -r.amount
    if (r.kind === 'divfee') x.fees += -r.amount
    if (r.kind === 'refund') x.refunds += r.amount
    m.set(k, x)
  }
  return [...m.values()].map(x => ({ ...x, net: x.gross - x.withholding - x.fees + x.refunds }))
    .sort((a, b) => b.fy.localeCompare(a.fy) || a.ticker.localeCompare(b.ticker))
}

/** Money moved between the US$ and A$ sides, by financial year. */
export function conversionsByYear(rows = []) {
  const m = new Map()
  for (const r of rows) {
    if (r.kind !== 'to_aud' && r.kind !== 'from_aud') continue
    const fy = fyOf(r.date)
    const x = m.get(fy) || { fy, toAudUsd: 0, toAudAud: 0, fromAudAud: 0, fromAudUsd: 0 }
    if (r.kind === 'to_aud') { x.toAudUsd += r.usd; x.toAudAud += r.usd * r.rate }
    else { x.fromAudAud += r.aud; x.fromAudUsd += r.amount }
    m.set(fy, x)
  }
  return [...m.values()].sort((a, b) => b.fy.localeCompare(a.fy))
}

// ─── What the reports imply but do not say ───────────────────────────────────
// A cash report shows cash. Units held before the first report, and a
// consolidation (a reverse split moves no cash), are invisible in it — but
// the units each distribution was paid on reveal both. Offered to be added,
// never added on their own.

const daysBefore = (a, b) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3

/**
 * Consolidations: a distribution paid on far fewer units than were held, with
 * no sale between. The ratio is held ÷ paid-on, rounded; the date is the first
 * payment on the smaller number. Payments on a handful of units (a part
 * payment in the changeover week) are passed over.
 */
export function suggestConsolidations(rows = [], openings = [], actions = []) {
  const out = []
  const tickers = [...new Set(rows.filter(r => r.kind === 'distribution').map(r => r.ticker))]
  for (const ticker of tickers) {
    if (actions.some(a => a.ticker === ticker)) continue
    let held = openings.filter(o => o.ticker === ticker).reduce((s, o) => s + (Number(o.units) || 0), 0)
    const timeline = rows.filter(r => r.ticker === ticker && ['buy', 'sell', 'distribution'].includes(r.kind))
    for (const r of timeline) {
      if (r.kind === 'buy') { held += r.units; continue }
      if (r.kind === 'sell') { held -= r.units; continue }
      if (held > 0 && r.units >= held * 0.05 && r.units < held * 0.6) {
        const ratio = Math.round(held / r.units)
        if (ratio >= 2) { out.push({ ticker, date: r.date, ratio, before: held, after: r.units }); break }
      }
    }
  }
  return out
}

/**
 * Units held before the first report: on each early distribution, units paid
 * on less units bought more than two days before it (a buy settles after a
 * day or two, so a buy the day before is not yet counted). The most common
 * answer is offered.
 */
export function suggestOpenings(rows = [], openings = []) {
  const out = []
  const tickers = [...new Set(rows.filter(r => r.kind === 'distribution').map(r => r.ticker))]
  for (const ticker of tickers) {
    if (openings.some(o => o.ticker === ticker)) continue
    const buys = rows.filter(r => r.ticker === ticker && r.kind === 'buy')
    const counts = new Map()
    for (const d of rows.filter(r => r.ticker === ticker && r.kind === 'distribution').slice(0, 6)) {
      const settled = buys.filter(b => daysBefore(b.date, d.date) > 2).reduce((s, b) => s + b.units, 0)
      const implied = Math.round((d.units - settled) * 1e6) / 1e6
      counts.set(implied, (counts.get(implied) || 0) + 1)
    }
    const [units, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || []
    if (units > 0 && n >= 2) out.push({ ticker, units, date: rows[0]?.date || null })
  }
  return out
}

// ─── One ledger from statements and cash reports ─────────────────────────────

/**
 * The annual statements are the record. A cash report's lines count only after
 * the last statement in its currency ends — the current financial year — so a
 * trade or distribution is never counted from both.
 *
 * @param {Array} cashRows   stored cash-report rows (currency 'USD' unless set)
 * @param {Array} annuals    [{currency, from, to, rows, actions, snapshots}]
 */
export function buildLedger(cashRows = [], annuals = []) {
  const lastTo = {}
  for (const a of annuals) if (!lastTo[a.currency] || a.to > lastTo[a.currency]) lastTo[a.currency] = a.to
  const after = cashRows.filter(r => !lastTo[r.currency || 'USD'] || r.date > lastTo[r.currency || 'USD'])
    .map(r => ({ ...r, currency: r.currency || 'USD', source: 'cash' }))
  const merged = mergeReport(annuals.flatMap(a => a.rows), after).rows
  const actions = []
  for (const a of annuals) for (const x of a.actions || []) if (!actions.some(y => y.ticker === x.ticker && y.date === x.date)) actions.push(x)
  const snapshots = annuals.flatMap(a => (a.snapshots || []).map(sn => ({ ...sn, currency: a.currency })))
  return { rows: merged, actions, snapshots, lastTo }
}

/**
 * Units held on a day, by the ledger, against what SelfWealth's statement says
 * was held that day. A mismatch means a line was missed or misread.
 */
export function checkAgainstStatements(rows, actions, snapshots, openings = []) {
  return snapshots.map(sn => {
    const held = holdingsFrom(rows.filter(r => r.date <= sn.date), openings, actions.filter(a => a.date <= sn.date))
      .find(h => h.ticker === sn.ticker)
    const units = held ? held.units : 0
    return { date: sn.date, ticker: sn.ticker, statement: sn.units, ledger: units, matches: Math.abs(units - sn.units) < 1e-6 }
  })
}

/** The latest statement price per ticker, as a fallback until a live one is set. */
export function statementPrices(snapshots = []) {
  const out = {}
  for (const sn of [...snapshots].sort((a, b) => a.date.localeCompare(b.date))) {
    if (sn.price > 0) out[sn.ticker] = { price: sn.price, at: `${sn.date}T00:00:00.000Z`, source: 'statement' }
  }
  return out
}
