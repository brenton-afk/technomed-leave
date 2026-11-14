import { STAFF, workPatternFor } from './staffConfig.js'

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

/** The hours this person usually works on a day — Toni's 5.5 Mon/Wed/Thu, else 7.6 on a weekday. */
function usualDay(email, date, standardDay) {
  const pattern = workPatternFor(email)
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
  if (pattern?.kind === 'fixed') return Number(pattern.days?.[dow] || 0)
  return weekday(date) ? standardDay : 0
}

/** One portal application's hours, day by day. */
function portalDays(a, email, standardDay) {
  if (Array.isArray(a.hours) && a.hours.length) {
    return a.hours.filter(h => Number(h?.hours) > 0).map(h => ({ date: h.date, hours: Number(h.hours) }))
  }
  return daysBetween(a.startDate, a.endDate).map(date => ({ date, hours: usualDay(email, date, standardDay) }))
    .filter(d => d.hours > 0)
}

/** A Xero application's hours, day by day: Xero holds them per pay period, so
 * they are spread over the days the person works in its range. */
function xeroDays(x, email, standardDay) {
  const span = daysBetween(x.start, x.end)
  const working = span.filter(d => usualDay(email, d, standardDay) > 0)
  const over = working.length ? working : span.filter(weekday)
  if (!over.length || !(Number(x.hours) > 0)) return []
  const each = Math.round((Number(x.hours) / over.length) * 100) / 100
  return over.map(date => ({ date, hours: each }))
}

/**
 * The leave on each day of a fortnight, by type: one row per type.
 *
 * @param {object} input
 * @param {object} input.leave       { approved, pending } from the leave store
 * @param {Array}  [input.xero]      this person's Xero leave applications over
 *                                   the period: { id, title, typeName, start, end, hours }
 * @param {boolean} [input.xeroRead] whether Xero answered (else portal only)
 * @param {string} input.email
 * @param {string[]} input.days      the fortnight
 *
 * **Xero's hours win** (Brent, 12 Nov 2026: Toni's Monday showed 15.2h of
 * personal leave from old portal requests over the 5.5h actually in Xero).
 * When Xero could be read, its applications are the leave — with the hours
 * Xero holds, so a change made in Xero shows, and an application with no
 * hours counts for nothing. A portal application shows only where it never
 * reached Xero (flagged "not in Xero"); one that was sent and is no longer in
 * Xero, or that Xero now holds differently, is Xero's to say. Only when Xero
 * cannot be read do the portal's own records stand in, with a note.
 * TOIL taken on a timesheet is that timesheet's own row, not a leave row.
 */
export function leaveForPeriod({ leave = {}, xero = [], xeroRead = true, email, days = [], standardDay = STANDARD_DAY } = {}) {
  const inPeriod = new Set(days)
  const rows = new Map()
  const notes = []
  const add = (map, type, date, hours, flag) => {
    if (!inPeriod.has(date) || !(hours > 0)) return
    const row = map.get(type) || { type, label: LEAVE_LABEL[type] || 'Leave', byDay: {}, total: 0, inXero: true, notInXero: [] }
    row.byDay[date] = round2((row.byDay[date] || 0) + hours)
    row.total = round2(row.total + hours)
    if (flag === false) { row.inXero = false; if (!row.notInXero.includes(date)) row.notInXero.push(date) }
    map.set(type, row)
  }
  const typeOf = a => (LEAVE_LABEL[a.leaveType] ? a.leaveType : 'OTHER')

  const mine = (leave.approved || []).filter(a => same(a.email, email) && a.source !== 'timesheet')
  if (xeroRead) {
    for (const x of xero || []) {
      if (!x || x.source === 'timesheet') continue
      const spread = xeroDays(x, email, standardDay)
      if (!spread.length) {
        if (daysBetween(x.start, x.end).some(d => inPeriod.has(d))) {
          notes.push(`Xero has a leave application with no hours (${x.typeName || x.title || 'leave'}, ${x.start}${x.end !== x.start ? ` to ${x.end}` : ''}) — not counted.`)
        }
        continue
      }
      const type = typeFromTitle(`${x.typeName || ''} ${x.title || ''}`)
      for (const { date, hours } of spread) add(rows, type, date, hours, true)
    }
    const inXero = new Set((xero || []).map(x => x?.id).filter(Boolean))
    const xeroDates = new Set([...rows.values()].flatMap(r => Object.keys(r.byDay)))
    // Xero's leave of no known type takes the type of the portal request for
    // the same day, so it reads "Personal leave", not plain "Leave".
    const other = rows.get('OTHER')
    if (other) {
      for (const a of mine) {
        const t = typeOf(a)
        if (t === 'OTHER') continue
        for (const { date } of portalDays(a, email, standardDay)) {
          const h = other.byDay[date]
          if (!h) continue
          delete other.byDay[date]
          other.total = round2(other.total - h)
          const row = rows.get(t) || { type: t, label: LEAVE_LABEL[t], byDay: {}, total: 0, inXero: true, notInXero: [] }
          row.byDay[date] = round2((row.byDay[date] || 0) + h)
          row.total = round2(row.total + h)
          rows.set(t, row)
        }
      }
      if (!Object.keys(other.byDay).length) rows.delete('OTHER')
    }
    for (const a of mine) {
      const sent = a.xero?.ok === true && a.xero?.id
      if (sent) {
        // Xero's own copy, above, is the one that counts — or it was removed there.
        if (!inXero.has(a.xero.id) && portalDays(a, email, standardDay).some(d => inPeriod.has(d.date))) {
          notes.push(`A portal ${LEAVE_LABEL[typeOf(a)].toLowerCase()} application (${a.startDate}${a.endDate !== a.startDate ? ` to ${a.endDate}` : ''}) is no longer in Xero — not counted.`)
        }
        continue
      }
      // Never on a day Xero already holds leave (14 Nov 2026: Toni's Monday
      // showed 5.5h twice — Xero's own, and a portal request never sent).
      for (const { date, hours } of portalDays(a, email, standardDay)) {
        if (xeroDates.has(date)) continue
        add(rows, typeOf(a), date, hours, false)
      }
    }
  } else {
    for (const a of mine) {
      for (const { date, hours } of portalDays(a, email, standardDay)) add(rows, typeOf(a), date, hours, a.xero ? a.xero.ok !== false : true)
    }
  }

  const pendingRows = new Map()
  for (const a of (leave.pending || []).filter(a => same(a.email, email))) {
    for (const { date, hours } of portalDays(a, email, standardDay)) add(pendingRows, typeOf(a), date, hours)
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
    byDay,
    notes,
    source: xeroRead ? 'xero' : 'portal'
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
