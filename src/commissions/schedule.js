// ─── When commissions are paid (Brent, 15 Nov 2026) ───────────────────────────
// "Commissions paid on the 1st September are for all sales in July" — two
// months on, so the sales month is closed and every distributor has invoiced.
// Paid on the 1st, or the next business day when the 1st is a weekend or a
// public holiday; worked out a few business days before. Pure; dates are
// YYYY-MM-DD, months YYYY-MM.
import { isDayOff } from '../publicHolidays.js'

const add = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/** "2026-09" → "2026-11" (two months on). */
export function monthPlus(month, n) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}

/** The day a sales month's commission is paid. */
export function paymentDateFor(salesMonth) {
  let d = `${monthPlus(salesMonth, 2)}-01`
  while (isDayOff(d)) d = add(d, 1)
  return d
}

/** How many business days before payment it is worked out. */
export const LEAD_BUSINESS_DAYS = 3

/** The day the portal works it out: three business days before payment. */
export function calcDateFor(salesMonth) {
  let d = paymentDateFor(salesMonth)
  let left = LEAD_BUSINESS_DAYS
  while (left > 0) { d = add(d, -1); if (!isDayOff(d)) left-- }
  return d
}

/** The sales month whose payment is next on or after `today`. */
export function nextSalesMonth(today) {
  let month = monthPlus(String(today).slice(0, 7), -2)
  while (paymentDateFor(month) < today) month = monthPlus(month, 1)
  return month
}

export const monthName = month => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
