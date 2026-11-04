// ─── MSTY return of capital ──────────────────────────────────────────────────
// Working figures for Sam, not a tax position. Two things here are facts from
// the account and are checked: which parcels each payment was paid on (against
// the units SelfWealth paid it on), and what each parcel cost. Two are not:
//
//   - How much of a payment the US treats as return of capital. That is final
//     only when the fund reports the year. Evidence, strongest first: a share
//     typed in for the payment (from the 19a-1 notice or 1099), the US
//     withholding on it refunded (a refund means the US did not treat it as an
//     ordinary dividend — consistent with return of capital, but the 1042-S
//     says which), a share typed in for the year. Without any, the payment is
//     left unclassified and reduces nothing.
//   - Whether Australian tax follows the US classification at all. If it does,
//     return of capital reduces each parcel's cost base and, once a parcel is
//     at nil, the excess is a capital gain. If it does not, the whole payment
//     is assessable income and nothing reduces. Both are shown; Sam decides.
//
// Exchange rates are the day's AUD/USD from stored market prices; the ATO also
// accepts RBA rates, which can differ slightly.
//
// Pure. Parcels come from the SelfWealth rows (selfwealth.js): each buy is a
// parcel, an opening position is one, and a consolidation divides the units of
// every parcel held at the time without changing its cost.

export const DEFAULT_ROC = { tickers: ['MSTY'], years: {}, overrides: {}, final: [] }

const daysBetween = (a, b) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3
/** The CGT discount needs the asset held at least 12 months, not counting the days of acquiring it and of the event. */
export function discountable(acquired, event) {
  const [y, m, d] = acquired.split('-').map(Number)
  const anniversary = new Date(Date.UTC(y + 1, m - 1, d)).toISOString().slice(0, 10)
  return event > anniversary
}
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

/**
 * The return-of-capital share (%) for a payment on `date`, and what it rests
 * on: 'payment' (typed for it), 'refunded' (its US withholding came back),
 * 'final' / 'year' (typed for its year, final or not), or null — not known.
 */
export function rocShare(date, cfg = DEFAULT_ROC, refundedPct = null) {
  if (cfg.overrides?.[date] != null) return { pct: Number(cfg.overrides[date]), basis: 'payment' }
  if (refundedPct != null) return { pct: refundedPct, basis: 'refunded' }
  const y = date.slice(0, 4)
  if (cfg.years?.[y] != null) return { pct: Number(cfg.years[y]), basis: (cfg.final || []).includes(y) ? 'final' : 'year' }
  return { pct: null, basis: null }
}

/** For each payment, the share of its US withholding later refunded (%), matched on units and amount. */
export function refundShares(rows = [], ticker = 'MSTY') {
  const refunds = rows.filter(r => r.kind === 'refund' && r.ticker === ticker).map(r => ({ units: r.units, amount: r.amount }))
  const out = new Map()
  for (const w of rows.filter(r => r.kind === 'withholding' && r.ticker === ticker)) {
    const i = refunds.findIndex(f => f.units === w.units && Math.abs(f.amount + w.amount) < 0.005)
    if (i < 0) continue
    refunds.splice(i, 1)
    out.set(`${w.date}|${w.units}`, 100)
  }
  return out
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
  const consolidations = []
  const refunded = refundShares(rows, ticker)
  for (const e of events) {
    if (e.a) {
      for (const p of parcels) p.units = p.units / (Number(e.a.ratio) || 1)
      // SelfWealth's statement says how many units came back; any fraction
      // (cashed out, if at all) is taken off every parcel in proportion.
      const now = parcels.reduce((t, p) => t + p.units, 0)
      if (e.a.after > 0 && now > 0 && Math.abs(now - e.a.after) < 1) {
        for (const p of parcels) p.units *= e.a.after / now
        consolidations.push({ date: e.a.date, ratio: e.a.ratio, before: e.a.before, after: e.a.after, fraction: now - e.a.after })
      } else consolidations.push({ date: e.a.date, ratio: e.a.ratio, before: null, after: now, fraction: 0 })
      continue
    }
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
    const { pct, basis } = rocShare(r.date, cfg, refunded.get(`${r.date}|${r.units}`) ?? null)
    const rate = fx(r.date) || 1
    const grossAud = r.amount != null ? r.amount / rate : r.perUnit * r.units / rate
    const eligible = parcels.filter(p => p.units > 0 && (r.recordDate && p.settle ? p.settle <= r.recordDate : daysBetween(p.date, r.date) > 2))
    const eligibleUnits = eligible.reduce((t, p) => t + p.units, 0)
    // The check: the parcels it was paid on must add up to the units SelfWealth paid it on.
    const unitsMatch = r.units == null ? null : Math.abs(eligibleUnits - r.units) < 0.5
    let rocAud = 0
    let gainAud = 0
    if (pct != null) {
      const perUnitAud = (r.perUnit * pct / 100) / rate
      for (const p of eligible) {
        const amount = perUnitAud * p.units
        const reduce = Math.min(p.base, amount)
        p.base -= reduce
        p.roc += reduce
        rocAud += reduce
        const over = amount - reduce
        if (over > 1e-9) {
          if (!p.nilOn) p.nilOn = r.date
          p.gains.push({ date: r.date, fy: fyOf(r.date), amount: over, discount: discountable(p.date, r.date) })
          gainAud += over
        } else if (p.base <= 1e-6 && !p.nilOn) p.nilOn = r.date
      }
    }
    payments.push({ date: r.date, fy: fyOf(r.date), perUnitUsd: r.perUnit, units: r.units ?? null, eligibleUnits, unitsMatch, grossUsd: r.amount ?? r.perUnit * r.units, grossAud, pct, basis, rate, rocAud, gainAud })
  }

  // The projection: the recent average payment per unit, at today's share and rate.
  const recent = payments.slice(-13)
  const avgPerUnitUsd = recent.length ? recent.reduce((s, x) => s + x.perUnitUsd, 0) / recent.length : 0
  // Only with a share typed in for this year: nothing is projected on a guess the app made.
  const assumed = cfg.years?.[today.slice(0, 4)]
  const pct = assumed != null ? Number(assumed) : null
  const rateNow = fx(today) || 1
  const weeklyAudPerUnit = pct == null ? 0 : avgPerUnitUsd * pct / 100 / rateNow
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
    const x = byFy.get(pay.fy) || { fy: pay.fy, rocAud: 0, gainAud: 0, gainDiscount: 0, payments: 0, grossAud: 0, unknownUsd: 0, unknown: 0 }
    x.rocAud += pay.rocAud; x.gainAud += pay.gainAud; x.payments += 1; x.grossAud += pay.grossAud
    if (pay.pct == null) { x.unknownUsd += pay.grossUsd; x.unknown += 1 }
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
          if (discountable(b.date, d)) x.gainDiscount += over
          projected.set(fy, x)
        }
      }
    }
  }

  const sum = k => out.reduce((s, p) => s + p[k], 0)
  // US withholding refunded later: how much, when, and which financial years' payments it was on.
  const refundRows = rows.filter(r => r.kind === 'refund' && r.ticker === ticker)
  const refundedPayments = payments.filter(p => p.basis === 'refunded')
  const refunds = {
    usd: Math.round(refundRows.reduce((t, r) => t + r.amount, 0) * 100) / 100,
    count: refundRows.length,
    dates: [...new Set(refundRows.map(r => r.date))].sort(),
    paymentFys: [...new Set(refundedPayments.map(p => p.fy))].sort()
  }
  return {
    ticker,
    parcels: out.sort((a, b) => a.date.localeCompare(b.date)),
    payments,
    consolidations,
    refunds,
    checks: { payments: payments.filter(p => p.unitsMatch != null).length, mismatches: payments.filter(p => p.unitsMatch === false) },
    byFy: [...byFy.values()].sort((a, b) => b.fy.localeCompare(a.fy)),
    projected: [...projected.values()].sort((a, b) => a.fy.localeCompare(b.fy)),
    totals: {
      units: sum('units'), costAud: sum('costAud'), baseAud: sum('base'), rocAud: sum('roc'), gainAud: sum('gainTotal'),
      atNil: out.filter(p => p.base <= 1e-6).length, parcels: out.length
    },
    assumption: { avgPerUnitUsd, pct, rateNow, weeklyAudPerUnit, from: recent[0]?.date || null }
  }
}
