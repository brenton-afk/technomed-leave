import { STAFF } from './staffConfig.js'

// ─── Leave and TOIL taken, on the timesheet (Brent, 12 Nov 2026) ──────────────
// "We would like annual leave days and hours to appear on the timesheet at the
// time the timesheet is submitted … for Erin to see the leave hours in the
// portal timesheet when she approves … staff need the option to TAKE TOIL in
// their timesheet … without needing to prospectively submit a TOIL
// application."
//
// Xero keeps the two apart: a timesheet holds worked hours (earnings rates)
// and leave reaches a pay run only as a leave application. So:
//
//   · Leave is SHOWN on the timesheet — from approved portal leave and from
//     leave entered straight into Xero — and never sent in the timesheet.
//   · TOIL taken is typed on the timesheet (toil_taken), kept apart from the
//     pay items, and becomes a Xero TOIL leave application when the timesheet
//     is approved. More than the balance is refused.
//
// Pure, shared by the screen and api/timesheet/agent.js.

export const TOIL_TAKEN = 'toil_taken'
export const STANDARD_DAY = 7.6

const round2 = n => Math.round((Number(n) || 0) * 100) / 100
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase()

/** Ben, Aimee, Mat and Toni — the people who earn TOIL. */
export function earnsToil(email) {
  return Boolean(STAFF.find(s => same(s.email, email))?.earnsToil)
}

export const LEAVE_LABEL = { ANNUAL_LEAVE: 'Annual leave', SICK: 'Personal leave', TOIL: 'TOIL leave', OTHER: 'Leave' }
export const LEAVE_ORDER = ['ANNUAL_LEAVE', 'SICK', 'TOIL', 'OTHER']

/** A Xero leave application's title as one of our types. */
export function typeFromTitle(title) {
  const t = String(title || '')
  if (/annual/i.test(t)) return 'ANNUAL_LEAVE'
  if (/personal|sick|carer/i.test(t)) return 'SICK'
  if (/toil|lieu/i.test(t)) return 'TOIL'
  return 'OTHER'
}

const weekday = d => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w !== 0 && w !== 6 }
function daysBetween(start, end) {
  const out = []
  const at = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  if (Number.isNaN(at.getTime()) || Number.isNaN(last.getTime())) return out
  for (; at <= last; at.setUTCDate(at.getUTCDate() + 1)) out.push(at.toISOString().slice(0, 10))
  return out
}

/** One portal application's hours, day by day. */
function portalDays(a, standardDay) {
  if (Array.isArray(a.hours) && a.hours.length) {
    return a.hours.filter(h => Number(h?.hours) > 0).map(h => ({ date: h.date, hours: Number(h.hours) }))
  }
  return daysBetween(a.startDate, a.endDate).filter(weekday).map(date => ({ date, hours: standardDay }))
}

/**
 * The leave on each day of a fortnight, by type: one row per type.
 *
 * @param {object} input
 * @param {object} input.leave       { approved, pending } from the leave store
 * @param {Array}  [input.xero]      this person's Xero leave applications over
 *                                   the period: { id, title, start, end, hours }
 * @param {string} input.email
 * @param {string[]} input.days      the fortnight
 * @returns {{ rows: Array<{type, label, byDay, total, inXero: boolean, notInXero: string[]}>,
 *             pending: Array<{type, label, byDay, total}>, total: number, byDay: object }}
 *
 * Xero's own applications count only where no portal application already
 * accounts for them (matched by the id the portal kept at approval), so leave
 * approved in the portal is not shown twice. Leave the portal approved that
 * Xero refused is shown and flagged — that is the case Erin has to fix by hand.
 * TOIL taken on a timesheet is not a leave row here: it is that timesheet's own
 * TOIL taken row.
 */
export function leaveForPeriod({ leave = {}, xero = [], email, days = [], standardDay = STANDARD_DAY } = {}) {
  const inPeriod = new Set(days)
  const rows = new Map()
  const add = (map, type, date, hours, flag) => {
    if (!inPeriod.has(date) || !(hours > 0)) return
    const row = map.get(type) || { type, label: LEAVE_LABEL[type] || 'Leave', byDay: {}, total: 0, inXero: true, notInXero: [] }
    row.byDay[date] = round2((row.byDay[date] || 0) + hours)
    row.total = round2(row.total + hours)
    if (flag === false) { row.inXero = false; if (!row.notInXero.includes(date)) row.notInXero.push(date) }
    map.set(type, row)
  }

  const mine = (leave.approved || []).filter(a => same(a.email, email) && a.source !== 'timesheet')
  const known = new Set(mine.map(a => a.xero?.id).filter(Boolean))
  for (const a of mine) {
    const type = LEAVE_LABEL[a.leaveType] ? a.leaveType : 'OTHER'
    const sent = a.xero ? a.xero.ok !== false : true
    for (const { date, hours } of portalDays(a, standardDay)) add(rows, type, date, hours, sent)
  }

  for (const x of xero || []) {
    if (!x || known.has(x.id) || x.source === 'timesheet') continue
    const type = typeFromTitle(x.title)
    const span = daysBetween(x.start, x.end).filter(weekday)
    if (!span.length) continue
    // Xero holds hours per pay period, not per day: spread evenly over the
    // weekdays it covers, else a standard day each.
    const each = Number(x.hours) > 0 ? Number(x.hours) / span.length : standardDay
    for (const date of span) add(rows, type, date, round2(each), true)
  }

  const pendingRows = new Map()
  for (const a of (leave.pending || []).filter(a => same(a.email, email))) {
    const type = LEAVE_LABEL[a.leaveType] ? a.leaveType : 'OTHER'
    for (const { date, hours } of portalDays(a, standardDay)) add(pendingRows, type, date, hours)
  }

  const order = r => LEAVE_ORDER.indexOf(r.type)
  const list = [...rows.values()].sort((a, b) => order(a) - order(b))
  const byDay = {}
  for (const r of list) for (const [d, h] of Object.entries(r.byDay)) byDay[d] = round2((byDay[d] || 0) + h)
  return {
    rows: list,
    pending: [...pendingRows.values()].sort((a, b) => order(a) - order(b))
      .map(({ type, label, byDay: b, total }) => ({ type, label, byDay: b, total })),
    total: round2(list.reduce((s, r) => s + r.total, 0)),
    byDay
  }
}

/** The TOIL taken row, cleaned: days of the period only, hours over 0 and at most 24. */
export function cleanToilTaken(raw, days = []) {
  const inPeriod = new Set(days)
  const out = {}
  for (const [day, value] of Object.entries(raw || {})) {
    const n = round2(value)
    if (!inPeriod.has(day) || !(n > 0)) continue
    out[day] = Math.min(n, 24)
  }
  return out
}

export const totalOf = byDay => round2(Object.values(byDay || {}).reduce((s, v) => s + Number(v || 0), 0))

/**
 * Whether this much TOIL can be taken. Blocked over the balance (Brent, 12 Nov
 * 2026: "block it"), less TOIL already taken on timesheets waiting for
 * approval — those hours are spoken for.
 */
export function toilTakenCheck({ taken = 0, balance = null, alreadyClaimed = 0 }) {
  const want = round2(taken)
  if (!(want > 0)) return { ok: true, available: balance === null ? null : round2(balance - alreadyClaimed) }
  if (balance === null || balance === undefined || !Number.isFinite(Number(balance))) {
    return { ok: false, available: null, error: 'Your TOIL balance could not be checked, so TOIL cannot be taken on this timesheet yet. Try again shortly.' }
  }
  const available = round2(Number(balance) - Number(alreadyClaimed || 0))
  if (want > available + 0.001) {
    return { ok: false, available,
      error: `You have ${Math.max(0, available)}h of TOIL available${alreadyClaimed ? ` (after ${round2(alreadyClaimed)}h on a timesheet awaiting approval)` : ''} — this timesheet takes ${want}h.` }
  }
  return { ok: true, available }
}

/** Runs of consecutive days, for one leave application per run. */
export function runsOf(byDay) {
  const dates = Object.keys(byDay || {}).filter(d => Number(byDay[d]) > 0).sort()
  const runs = []
  for (const d of dates) {
    const last = runs[runs.length - 1]
    const prev = last?.[last.length - 1]
    const next = prev ? new Date(`${prev.date}T00:00:00Z`) : null
    if (next) next.setUTCDate(next.getUTCDate() + 1)
    if (next && next.toISOString().slice(0, 10) === d) last.push({ date: d, hours: Number(byDay[d]) })
    else runs.push([{ date: d, hours: Number(byDay[d]) }])
  }
  return runs
}

/** The days still ahead (today included), which go on the leave calendar. */
export function futureDays(byDay, today) {
  return Object.fromEntries(Object.entries(byDay || {}).filter(([d, h]) => d >= today && Number(h) > 0))
}
