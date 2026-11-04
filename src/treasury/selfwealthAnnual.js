// ─── SelfWealth annual statements ────────────────────────────────────────────
// The authoritative record of the trust's SelfWealth account, one PDF per
// financial year and market (USA in US$, Australia in A$). Where the cash
// report can only show cash, the statement also has:
//
//   Holdings Valuation as at …   units and price at the start and end of the year
//   Contracts / Transaction Summary   every trade, with settlement date and brokerage
//   Scrip Movement                consolidations (reverse splits), exactly
//   Corporate Action Cash Movement   every distribution, with record date,
//                                 units paid on, withholding and fees
//   Transaction History (USA)     conversions between A$ and US$
//
// Its rows are turned into the same shape the cash report's are (selfwealth.js),
// so holdings and return of capital read one ledger whichever document a line
// came from. The phone sends positioned text pieces; lines are rebuilt here by
// grouping pieces at the same height on a page.
//
// Pure. Tested with invented statements only.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

/** "8 July 2025", "17 Sept 2025", "2 Apr 2026" → "2025-07-08". */
export function readDay(s) {
  const m = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(String(s || '').trim())
  if (!m) return null
  const month = MONTHS[m[2].toLowerCase().slice(0, 3)]
  return month ? `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
}
const num = s => {
  const t = String(s ?? '').trim().replace(/[$,\s]/g, '')
  if (t === '' || !/^-?\d*\.?\d+$/.test(t)) return null
  return Number(t)
}

/** Text pieces → lines, each a list of cells left to right. */
export function linesFromItems(items) {
  const byPage = new Map()
  for (const it of items) {
    if (!String(it.s).trim()) continue
    const page = byPage.get(it.p) || []
    let row = page.find(r => Math.abs(r.y - it.y) <= 2)
    if (!row) { row = { y: it.y, cells: [] }; page.push(row) }
    row.cells.push([it.x, String(it.s).trim()])
    byPage.set(it.p, page)
  }
  const lines = []
  for (const p of [...byPage.keys()].sort((a, b) => a - b)) {
    for (const r of byPage.get(p).sort((a, b) => b.y - a.y)) {
      lines.push({ p, y: r.y, cells: r.cells.sort((a, b) => a[0] - b[0]).map(c => c[1]) })
    }
  }
  return lines
}

export function isAnnualStatement(items) {
  return items.some(i => /Detailed Holdings Summary/i.test(i.s))
}

/**
 * @returns {{
 *   market: 'USA'|'Australia', currency: 'USD'|'AUD', from, to,
 *   snapshots: [{date, ticker, name, units, price, value}],
 *   rows: Array (cash-report shaped: buy, brokerage, distribution, withholding, divfee, to_aud, from_aud),
 *   actions: [{ticker, date, ratio}], counts
 * }}
 */
export function parseAnnualStatement(items) {
  const lines = linesFromItems(items)
  const text = lines.map(l => l.cells.join(' '))
  const head = text.find(t => /Detailed Holdings Summary - Period/i.test(t)) || ''
  const period = /Period (\d{1,2} \w+ \d{4}) - (\d{1,2} \w+ \d{4})/.exec(head)
  if (!period) return { error: 'Not a SelfWealth annual statement.' }
  const market = /^USA/i.test(head) ? 'USA' : 'Australia'
  const currency = market === 'USA' ? 'USD' : 'AUD'
  const from = readDay(period[1])
  const to = readDay(period[2])

  const snapshots = []
  const rows = []
  const actions = []
  const names = new Map() // instrument name → ticker
  let section = null
  let snapDate = null
  let asxTicker = null
  const scrip = []
  const pendingDists = []

  for (const { cells } of lines) {
    const line = cells.join(' ')
    // Section headings.
    let m = /^Holdings Valuation as at (\d{1,2} \w+ \d{4})$/.exec(line)
    if (m) { section = 'holdings'; snapDate = readDay(m[1]); continue }
    if (/^Transaction History/.test(line)) { section = 'history'; continue }
    if (/^Contracts between/.test(line)) { section = 'contracts'; continue }
    if (/^Transaction Summary/.test(line)) { section = 'asxtrades'; continue }
    if (/^Scrip Movement/.test(line)) { section = 'scrip'; continue }
    if (/^Corporate Action Cash Movement/.test(line)) { section = 'dists'; continue }
    if (/^Estimated Dividends and Distributions -/.test(line)) { section = 'asxdists'; continue }
    if (/^(Overall Summary|Holdings Summary as at)/.test(line)) { section = null; continue }

    if (section === 'holdings' && cells.length === 5 && /^[A-Z0-9.]{1,8}$/.test(cells[0])) {
      const units = num(cells[2])
      if (units != null) {
        snapshots.push({ date: snapDate, ticker: cells[0], name: cells[1], units, price: num(cells[3]), value: num(cells[4]) })
        names.set(cells[1].toLowerCase(), cells[0])
      }
      continue
    }

    if (section === 'contracts' && cells.length >= 15 && readDay(cells[0]) && /^(BUY|SELL)$/i.test(cells[3])) {
      const [d, settle, contract, side, ticker, name] = cells
      const [units, price, , , gross, brokerage, gst, other] = cells.slice(6, 14).map(num)
      const date = readDay(d)
      names.set(name.toLowerCase(), ticker)
      const kind = side.toLowerCase()
      const at = `${date}T12:00:00`
      rows.push({ key: `annual|${contract}`, source: 'annual', at, date, settle: readDay(settle), kind, order: contract, units, ticker, price, amount: kind === 'buy' ? -gross : gross, currency })
      rows.push({ key: `annual|${contract}|fee`, source: 'annual', at, date, kind: 'brokerage', order: contract, side: kind, ticker, amount: -((brokerage || 0) + (gst || 0) + (other || 0)), currency })
      continue
    }

    if (section === 'asxtrades') {
      if (cells.length === 2 && /^[A-Z0-9]{2,6}$/.test(cells[0])) { asxTicker = cells[0]; names.set(cells[1].toLowerCase(), cells[0]); continue }
      if (cells.length >= 10 && readDay(cells[0]) && /^(Buy|Sell)$/i.test(cells[2]) && asxTicker) {
        const date = readDay(cells[0])
        const [units, price, consideration, brokerage, fees] = cells.slice(4, 9).map(num)
        const kind = cells[2].toLowerCase()
        const at = `${date}T12:00:00`
        rows.push({ key: `annual|${cells[3]}`, source: 'annual', at, date, settle: readDay(cells[1]), kind, order: cells[3], units, ticker: asxTicker, price, amount: kind === 'buy' ? -consideration : consideration, currency })
        rows.push({ key: `annual|${cells[3]}|fee`, source: 'annual', at, date, kind: 'brokerage', order: cells[3], side: kind, ticker: asxTicker, amount: -((brokerage || 0) + (fees || 0)), currency })
      }
      continue
    }

    if (section === 'scrip' && cells.length === 5 && readDay(cells[0])) {
      const vol = num(cells[4])
      if (vol != null) scrip.push({ date: readDay(cells[0]), ticker: cells[1], vol })
      continue
    }

    if (section === 'dists' && cells.length >= 15 && readDay(cells[0])) {
      // Action date | name | description | record | payable | holding | curr | pymt amt | fx | wht% | gross | wht | fees | gst | net
      const per = /@ USD ([\d.]+)/.exec(cells[2])
      pendingDists.push({
        date: readDay(cells[0]), name: cells[1], perUnit: per ? Number(per[1]) : null,
        record: readDay(cells[3]), payable: readDay(cells[4]), units: num(cells[5]),
        gross: num(cells[10]), wht: num(cells[11]), fees: (num(cells[12]) || 0) + (num(cells[13]) || 0)
      })
      continue
    }

    if (section === 'history' && cells.length >= 7 && readDay(cells[0]) && cells[1] === 'Cash Movement') {
      const date = readDay(cells[0])
      const fx = /^S (AUD|USD)([\d.,]+) B (AUD|USD)([\d.,]+) @FX([\d.]+)$/.exec(cells[2])
      if (!fx) continue
      const sold = Number(fx[2].replace(/,/g, ''))
      const bought = Number(fx[4].replace(/,/g, ''))
      const key = `annual|fx|${date}|${cells[2]}|${cells[6]}`
      if (fx[1] === 'AUD') rows.push({ key, source: 'annual', at: `${date}T09:00:00`, date, kind: 'from_aud', aud: sold, rate: bought / sold, amount: bought, currency })
      else rows.push({ key, source: 'annual', at: `${date}T09:00:00`, date, kind: 'to_aud', usd: sold, rate: bought / sold, amount: -sold, currency })
    }
  }

  // Distributions: name → ticker from the trades and holdings in the same document.
  const tickerOf = name => {
    const n = name.toLowerCase()
    for (const [k, t] of names) if (k.startsWith(n) || n.startsWith(k)) return t
    if (/yieldmax mstr option income/i.test(name)) return 'MSTY'
    return name
  }
  for (const d of pendingDists) {
    const ticker = tickerOf(d.name)
    const base = { source: 'annual', date: d.date, at: `${d.date}T00:00:00`, ticker, units: d.units, perUnit: d.perUnit, recordDate: d.record, currency }
    const k = `annual|div|${ticker}|${d.date}|${d.gross}`
    rows.push({ ...base, key: k, kind: 'distribution', amount: d.gross })
    if (d.wht) rows.push({ ...base, key: `${k}|wht`, kind: 'withholding', amount: -d.wht })
    if (d.fees) rows.push({ ...base, key: `${k}|fee`, kind: 'divfee', amount: -d.fees })
  }

  // Consolidations: a holding taken out and a smaller one put back, same day.
  const byDay = new Map()
  for (const s of scrip) { const k = `${s.ticker}|${s.date}`; byDay.set(k, [...(byDay.get(k) || []), s.vol]) }
  for (const [k, vols] of byDay) {
    const out = -Math.min(...vols)
    const back = Math.max(...vols)
    if (out > 0 && back > 0 && back < out) {
      const [ticker, date] = k.split('|')
      actions.push({ ticker, date, ratio: Math.round(out / back), source: 'annual', before: out, after: back })
    }
  }

  rows.sort((a, b) => a.at.localeCompare(b.at))
  const count = kind => rows.filter(r => r.kind === kind).length
  return {
    market, currency, from, to, snapshots, rows, actions,
    counts: { trades: count('buy') + count('sell'), distributions: count('distribution'), conversions: count('to_aud') + count('from_aud'), consolidations: actions.length, holdings: snapshots.filter(s => s.date === to).length }
  }
}
