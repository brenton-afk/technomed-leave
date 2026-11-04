// ─── MSTY return of capital ──────────────────────────────────────────────────
// Most of what MSTY pays is, for US tax, a return of capital. In Australia that
// reduces the cost base of the units it is paid on (CGT event E4); once a
// parcel's cost base reaches nil, every further return of capital on it is a
// capital gain in the year it is received. This works that out parcel by
// parcel, in A$, and projects when each remaining parcel runs out.
//
// The share of each payment that is return of capital is only final when the
// fund publishes its year-end figures (early the next year). Until then it is
// an assumption per calendar year, with any payment's own estimate allowed to
// override it — the settings say which is which.
//
// Estimates for Sam to confirm, not a tax calculation: exchange rates are the
// day's AUD/USD from stored market prices, where the ATO accepts RBA rates.
//
// Pure. Parcels come from the SelfWealth rows (selfwealth.js): each buy is a
// parcel, an opening position is one, and a consolidation divides the units of
// every parcel held at the time without changing its cost.

export const DEFAULT_ROC = { tickers: ['MSTY'], years: { 2025: 100, 2026: 97 }, overrides: {} }

const daysBetween = (a, b) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10)
export const fyOf = date => { const [y, m] = date.split('-').map(Number); return `FY${String(m >= 7 ? y + 1 : y).slice(-2)}` }

/**
 * AUD/USD (US$ per A$1) on a day, from daily closes of the same asset in both
 * currencies: the nearest earlier day that has both, else the first that does.
 */
export function makeFx(audCloses = [], usdCloses = [], fallback = null) {
  const u = new Map(usdCloses)
  const days = audCloses.filter(([d, a]) => a > 0 && u.get(d) > 0).map(([d, a]) => [d, u.get(d) / a])
  return date => {
    if (!days.length) return fallback
    let lo = 0
    let hi = days.length - 1
    if (date < days[0][0]) return days[0][1]
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (days[mid][0] <= date) lo = mid; else hi = mid - 1 }
    return days[lo][1]
  }
}

/** The return-of-capital share (%) for a payment on `date`. */
export function rocShare(date, cfg = DEFAULT_ROC) {
  if (cfg.overrides?.[date] != null) return { pct: Number(cfg.overrides[date]), basis: 'payment' }
  const y = date.slice(0, 4)
  if (cfg.years?.[y] != null) return { pct: Number(cfg.years[y]), basis: 'year' }
  const latest = Object.keys(cfg.years || {}).sort().pop()
  return { pct: latest ? Number(cfg.years[latest]) : 100, basis: 'assumed' }
}

/**
 * @param {object} p
 * @param {Array} p.rows       SelfWealth rows
 * @param {Array} p.openings   [{ticker, units, costUsd, date}]
 * @param {Array} p.actions    consolidations [{ticker, date, ratio}]
 * @param {(date:string)=>number} p.fx   US$ per A$1 on a day
 * @param {string} p.ticker
 * @param {object} p.cfg
 * @param {string} p.today
 */
export function trackRoc({ rows = [], openings = [], actions = [], fx, ticker = 'MSTY', cfg = DEFAULT_ROC, today }) {
  const parcels = []
  const firstDate = rows[0]?.date || today
  for (const o of openings.filter(x => x.ticker === ticker)) {
    const date = o.date || addDays(firstDate, -1)
    const costAud = (Number(o.costUsd) || 0) / (fx(date) || 1)
    parcels.push({ id: `open-${date}`, date, settle: date, units: Number(o.units) || 0, costUsd: Number(o.costUsd) || 0, costAud, base: costAud, roc: 0, nilOn: null, gains: [] })
  }
  const brokerage = new Map(rows.filter(r => r.kind === 'brokerage').map(r => [`${r.order}|${r.side}`, -r.amount]))
  const events = [
    ...rows.filter(r => r.ticker === ticker && ['buy', 'distribution'].includes(r.kind)).map(r => ({ at: r.at, date: r.date, r })),
    // A consolidation takes effect at the end of its day: a payment that day
    // was declared on the units held before it.
    ...actions.filter(a => a.ticker === ticker).map(a => ({ at: `${a.date}T23:59:59`, date: a.date, a }))
  ].sort((x, y) => x.at.localeCompare(y.at))

  const payments = []
  for (const e of events) {
    if (e.a) { for (const p of parcels) p.units = p.units / (Number(e.a.ratio) || 1); continue }
    const r = e.r
    if (r.kind === 'buy') {
      const costUsd = -r.amount + (brokerage.get(`${r.order}|buy`) || 0)
      const costAud = costUsd / (fx(r.date) || 1)
      parcels.push({ id: r.key, date: r.date, settle: r.settle || null, units: r.units, costUsd, costAud, base: costAud, roc: 0, nilOn: null, gains: [] })
      continue
    }
    // A distribution: paid on parcels settled by its record date. The annual
    // statement gives both dates; a cash report gives neither, so there a buy
    // more than two days before the payment counts (it settles in one or two).
    const { pct, basis } = rocShare(r.date, cfg)
    const rate = fx(r.date) || 1
    const perUnitAud = (r.perUnit * pct / 100) / rate
    let rocAud = 0
    let gainAud = 0
    for (const p of parcels) {
      const settled = r.recordDate && p.settle ? p.settle <= r.recordDate : daysBetween(p.date, r.date) > 2
      if (!settled || p.units <= 0) continue
      const amount = perUnitAud * p.units
      const reduce = Math.min(p.base, amount)
      p.base -= reduce
      p.roc += reduce
      rocAud += reduce
      const over = amount - reduce
      if (over > 1e-9) {
        if (!p.nilOn) p.nilOn = r.date
        const discount = daysBetween(p.date, r.date) >= 365
        p.gains.push({ date: r.date, fy: fyOf(r.date), amount: over, discount })
        gainAud += over
      } else if (p.base <= 1e-6 && !p.nilOn) p.nilOn = r.date
    }
    payments.push({ date: r.date, fy: fyOf(r.date), perUnitUsd: r.perUnit, pct, basis, rate, rocAud, gainAud })
  }

  // The projection: the recent average payment per unit, at today's share and rate.
  const recent = payments.slice(-13)
  const avgPerUnitUsd = recent.length ? recent.reduce((s, x) => s + x.perUnitUsd, 0) / recent.length : 0
  const { pct } = rocShare(today, cfg)
  const rateNow = fx(today) || 1
  const weeklyAudPerUnit = avgPerUnitUsd * pct / 100 / rateNow
  const out = parcels.map(p => {
    const weekly = weeklyAudPerUnit * p.units
    const weeksLeft = p.base > 1e-6 && weekly > 0 ? Math.ceil(p.base / weekly) : 0
    return {
      ...p,
      gainTotal: p.gains.reduce((s, g) => s + g.amount, 0),
      projectedNil: p.nilOn || (weekly > 0 ? addDays(today, weeksLeft * 7) : null)
    }
  })

  const byFy = new Map()
  for (const pay of payments) {
    const x = byFy.get(pay.fy) || { fy: pay.fy, rocAud: 0, gainAud: 0, gainDiscount: 0, payments: 0 }
    x.rocAud += pay.rocAud; x.gainAud += pay.gainAud; x.payments += 1
    byFy.set(pay.fy, x)
  }
  for (const p of out) for (const g of p.gains) { const x = byFy.get(g.fy); if (x && g.discount) x.gainDiscount += g.amount }

  // A year of projected gains: each payment-week ahead, gains from parcels already at nil.
  const projected = new Map()
  if (weeklyAudPerUnit > 0) {
    const bases = out.map(p => ({ base: p.base, units: p.units, date: p.date }))
    for (let w = 1; w <= 52 * 2; w++) {
      const d = addDays(today, w * 7)
      const fy = fyOf(d)
      for (const b of bases) {
        const amount = weeklyAudPerUnit * b.units
        const reduce = Math.min(b.base, amount)
        b.base -= reduce
        const over = amount - reduce
        if (over > 1e-9) {
          const x = projected.get(fy) || { fy, gainAud: 0, gainDiscount: 0 }
          x.gainAud += over
          if (daysBetween(b.date, d) >= 365) x.gainDiscount += over
          projected.set(fy, x)
        }
      }
    }
  }

  const sum = k => out.reduce((s, p) => s + p[k], 0)
  return {
    ticker,
    parcels: out.sort((a, b) => a.date.localeCompare(b.date)),
    payments,
    byFy: [...byFy.values()].sort((a, b) => b.fy.localeCompare(a.fy)),
    projected: [...projected.values()].sort((a, b) => a.fy.localeCompare(b.fy)),
    totals: {
      units: sum('units'), costAud: sum('costAud'), baseAud: sum('base'), rocAud: sum('roc'), gainAud: sum('gainTotal'),
      atNil: out.filter(p => p.base <= 1e-6).length, parcels: out.length
    },
    assumption: { avgPerUnitUsd, pct, rateNow, weeklyAudPerUnit, from: recent[0]?.date || null }
  }
}
