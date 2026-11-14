import { STAFF } from './staffConfig.js'

// ─── Hours over the contract become TOIL ─────────────────────────────────────
// "Can you allow staff to just enter the hours they worked? For Erin she is
// contracted 24 hours per week. For Aimee, Ben and Mat they are full time at
// 76 hours so anything over this should automatically accrue as TOIL unless
// they enter it as Overtime (double time)." — Brent, 2 Nov 2026
//
// So there is no per-day limit at all: a 9-hour day is a 9-hour day, and an
// 8-hour day is Erin's normal one. What is checked is the fortnight, and only
// for the people on a full-time contract with overflow to TOIL.
//
// Shared by the screen and the server so the split a person sees before they
// submit is the split that goes to Xero. The server applies it again on
// submit; it is idempotent, because once moved the ordinary hours are at the
// limit and there is nothing more to move.

const staffRow = email => STAFF.find(s => s.email.toLowerCase() === String(email || '').toLowerCase())

/**
 * The contract on someone's roster row, or null. Anyone who earns TOIL and has
 * no written contract gets one from their work pattern (Brent, 14 Nov 2026:
 * staff hours are variable — the fortnight is checked, not the day): Toni's
 * 5.5 × 3 days is a 33-hour fortnight.
 */
export function contractFor(email) {
  const row = staffRow(email)
  if (!row) return null
  if (row.contract) return row.contract
  if (!row.earnsToil) return null
  const hours = patternFortnight(row.workPattern)
  return hours ? { fortnightHours: hours, overflowToToil: true } : null
}

function patternFortnight(pattern) {
  if (pattern?.kind === 'fixed') return round2(2 * (pattern.days || []).reduce((s, h) => s + Number(h || 0), 0))
  if (pattern?.kind === 'flexible') return round2(2 * Number(pattern.weeklyHours || 0))
  return 0
}

/** The hours someone is expected on a day, from their pattern; 7.6 a weekday otherwise. */
export function expectedOnDay(email, date) {
  const pattern = staffRow(email)?.workPattern
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
  if (pattern?.kind === 'fixed') return Number(pattern.days?.[dow] || 0)
  const weekday = dow < 5
  if (pattern?.kind === 'flexible') return weekday ? round2(Number(pattern.weeklyHours || 0) / 5) : 0
  return weekday ? 7.6 : 0
}

/**
 * The fortnight against the contract (Brent, 14 Nov 2026: "submit hours and
 * then the portal automatically ask them if they are under hours, if they
 * would like to take TOIL, or if they are over hours if they would like to
 * add TOIL"). Ordinary hours worked + leave + TOIL taken, against the
 * contract. Pure.
 *
 * @returns {{kind: 'none'|'ok'|'under'|'over', hours: number, limit: number, counted: number}}
 */
export function fortnightBalance({ entries, categories, contract, leaveHours = 0, toilTaken = 0 }) {
  if (!contract?.fortnightHours) return { kind: 'none', hours: 0, limit: 0, counted: 0 }
  const ordinary = (categories || []).filter(c => c.kind === 'ordinary').map(c => c.key)
  const worked = ordinary.reduce((sum, key) =>
    sum + Object.values(entries?.[key] || {}).reduce((s, v) => s + Number(v || 0), 0), 0)
  const counted = round2(worked + Number(leaveHours || 0) + Number(toilTaken || 0))
  const diff = round2(counted - contract.fortnightHours)
  if (Math.abs(diff) < 0.01) return { kind: 'ok', hours: 0, limit: contract.fortnightHours, counted }
  return { kind: diff > 0 ? 'over' : 'under', hours: Math.abs(diff), limit: contract.fortnightHours, counted }
}

/**
 * Where TOIL taken goes to cover a shortfall: onto the days furthest short of
 * the person's usual day (ordinary + leave + TOIL already there), earliest
 * first; anything left on the last working day. Xero holds TOIL taken as leave
 * on dates, so it needs days. Pure. Returns { [date]: hours } to add.
 */
export function spreadShortfall({ hours, email, days = [], entries = {}, categories = [], leaveByDay = {}, taken = {} }) {
  let left = round2(Number(hours || 0))
  const out = {}
  if (left <= 0) return out
  const ordinary = (categories || []).filter(c => c.kind === 'ordinary').map(c => c.key)
  const onDay = d => ordinary.reduce((s, k) => s + Number(entries?.[k]?.[d] || 0), 0)
    + Number(leaveByDay?.[d] || 0) + Number(taken?.[d] || 0)
  const working = days.filter(d => expectedOnDay(email, d) > 0)
  for (const d of working) {
    if (left <= 0) break
    const gap = round2(expectedOnDay(email, d) - onDay(d))
    if (gap <= 0) continue
    const put = round2(Math.min(gap, left))
    out[d] = round2((out[d] || 0) + put)
    left = round2(left - put)
  }
  if (left > 0 && working.length) {
    const last = working[working.length - 1]
    out[last] = round2((out[last] || 0) + left)
  }
  return out
}

const round2 = n => Math.round(n * 100) / 100

/**
 * The entries with ordinary hours above the limit moved to TOIL.
 *
 * The limit is the contract less approved leave in the period: a fortnight
 * with a day of annual leave is a 68.4-hour fortnight of work, and the leave
 * is paid as leave.
 *
 * Moved from the end of the fortnight backwards — the hours over 76 are, by
 * any reading, the last ones worked — and onto the same days, since Xero
 * holds a timesheet as hours per day.
 *
 * @returns {{ entries, excess: number, moved: Array<{day, hours}>, toilKey: string|null, limit: number }}
 */
export function toilOverflow({ entries, categories, days, contract, leaveHours = 0 }) {
  const none = { entries, excess: 0, moved: [], toilKey: null, limit: null }
  if (!contract?.overflowToToil || !contract.fortnightHours) return none

  const ordinary = (categories || []).filter(c => c.kind === 'ordinary').map(c => c.key)
  const toil = (categories || []).find(c => c.key === 'toil_accrued')
    || (categories || []).find(c => c.kind === 'toil')
  const limit = round2(Math.max(0, contract.fortnightHours - Number(leaveHours || 0)))
  const worked = round2(ordinary.reduce((sum, key) =>
    sum + Object.values(entries?.[key] || {}).reduce((s, v) => s + Number(v || 0), 0), 0))
  const excess = round2(worked - limit)
  if (excess <= 0) return { ...none, limit }
  // No TOIL pay item on this person's timesheet: nowhere to put it. Said, not
  // guessed — the screen tells them, and the hours go as entered.
  if (!toil) return { ...none, excess, limit }

  const next = Object.fromEntries(Object.entries(entries || {}).map(([k, v]) => [k, { ...v }]))
  let left = excess
  const moved = []
  for (const day of [...days].reverse()) {
    if (left <= 0) break
    let fromDay = 0
    for (const key of [...ordinary].reverse()) {
      const have = Number(next[key]?.[day] || 0)
      if (!have || left <= 0) continue
      const take = round2(Math.min(have, left))
      const remaining = round2(have - take)
      if (remaining > 0) next[key][day] = remaining
      else delete next[key][day]
      left = round2(left - take)
      fromDay = round2(fromDay + take)
    }
    if (fromDay > 0) {
      next[toil.key] = { ...(next[toil.key] || {}), [day]: round2(Number(next[toil.key]?.[day] || 0) + fromDay) }
      moved.push({ day, hours: fromDay })
    }
  }
  for (const key of Object.keys(next)) if (!Object.keys(next[key]).length) delete next[key]
  return { entries: next, excess, moved: moved.reverse(), toilKey: toil.key, limit }
}
