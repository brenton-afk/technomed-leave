import { getTeamLeader, getDayLeaders } from './_redis.js'
import { turnOf, turnEnds, rosteredLeader, standingCover, holidayLeader, savedStillStands } from '../src/clinicalPlan/teamLeader.js'

// ─── Who leads on a given day ────────────────────────────────────────────────
// One answer, used by everything that asks: the week's chips, who may allocate
// reps, and who the morning's unsent-usage escalation goes to. In order:
//   1. that day, if somebody changed that day (after the 8 Nov roster —
//      see savedStillStands);
//   1b. the Christmas on-call roster (HOLIDAY_LEADS);
//   2. the turn (Friday to Thursday), if somebody set it — stored under the
//      turn's Friday;
//   3. a cover written into the rota (COVERS in teamLeader.js);
//   4. the standing rota.
// A turn's entry used to be stored under the Monday of a Monday-to-Friday
// week. Those keys are not read: the turns no longer line up with them, and
// the rota change on 5 Nov 2026 said who has the turns from then on.

const brief = p => p && { email: p.email, name: p.name, firstName: p.firstName }

/** The turn's leader, without any one-day change: { ...person, source, rostered, turn, ends }. */
export async function turnLeader(date) {
  const turn = turnOf(date)
  if (!turn) return null
  let set = null
  try { set = await getTeamLeader(turn) } catch { set = null }
  if (!savedStillStands(set, turn)) set = null
  const cover = set ? null : standingCover(turn)
  const rostered = rosteredLeader(turn)
  const chosen = set || cover || brief(rostered)
  return chosen && {
    ...chosen,
    source: set || cover ? 'set' : 'roster',
    rostered: rostered && { email: rostered.email, firstName: rostered.firstName },
    turn,
    ends: turnEnds(turn)
  }
}

/** Each date's leader, one-day changes included: { [date]: leader } with `turnLeader` beside it. */
export async function leadersOn(dates) {
  let days = {}
  try { days = await getDayLeaders(dates) } catch { days = {} }
  const turns = new Map()
  const out = {}
  for (const date of dates) {
    const turn = turnOf(date)
    if (!turn) continue
    if (!turns.has(turn)) turns.set(turn, await turnLeader(turn))
    const whole = turns.get(turn)
    const day = savedStillStands(days[date], date) ? days[date] : null
    const holiday = day ? null : holidayLeader(date)
    out[date] = day
      ? { ...day, source: 'day', rostered: whole?.rostered || null, turn, turnLeader: whole }
      : holiday
        ? { ...holiday, source: 'day', rostered: whole?.rostered || null, turn, turnLeader: whole }
        : whole && { ...whole, turnLeader: whole }
  }
  return out
}

/** The email of whoever leads on `date`, or null. */
export async function leaderEmailOn(date) {
  return (await leadersOn([date]))[date]?.email || null
}
