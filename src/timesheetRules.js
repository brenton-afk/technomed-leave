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

/** The contract on someone's roster row, or null. */
export function contractFor(email) {
  return STAFF.find(s => s.email.toLowerCase() === String(email || '').toLowerCase())?.contract || null
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
