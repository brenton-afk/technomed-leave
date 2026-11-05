// ─── Sending a TM loan kit out in time (Brent, 5 Nov 2026) ───────────────────
// "When there are two Dakota cases on a day (24/11/26) … we need to build in a
// reminder to get the Dakota TM loan kit sent to Calvary no later than the
// Friday 20/11/26 (at least 48 hours in advance). The portal correctly
// suggested Dakota TM loan for the second case. But there's no prompt for the
// dispatch … It could also be a task out in the portal for Friday."
//
// Worked out from the bookings every time the week is built, never written to
// the calendar by itself: a case that moves or is cancelled takes its dispatch
// with it. One tap turns it into a real task (prefilled Move a kit), and once
// that task exists the suggestion steps aside.

import { suggestSupplyOnDay, inventoryFor, siteCode } from './inventory.js'
import { parseDateStr, toDateStr, addCivilDays, weekdayName } from './week.js'

const PLACES = { CLV: 'Calvary', RHH: 'RHH' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shift = (date, n) => toDateStr(addCivilDays(parseDateStr(date), n))
const isWeekend = date => ['Saturday', 'Sunday'].includes(weekdayName(date))
const shortDay = date => { const d = parseDateStr(date); return `${weekdayName(date).slice(0, 3)} ${d.day} ${MONTHS[d.month - 1]}` }

/** At least 48 hours ahead, on a working day: two days before, back to a weekday. */
export function dispatchDay(caseDate) {
  let day = shift(caseDate, -2)
  while (isWeekend(day)) day = shift(day, -1)
  return day
}

/**
 * Every TM loan kit that has to go out for these cases, with the day it must go.
 *
 * `cases`: { id, date, start, hospital, surgeon, patient, cancelled, supplies:
 * [{ system, supply }] }. The supply is as written on the booking, or — where
 * nothing (or Consignment) is written — what the portal would suggest for that
 * day, counting each hospital's consignment sets in list order exactly as the
 * week's cards do (withDaySupplies), so the card and the dispatch agree.
 */
export function tmLoanDispatches(cases = []) {
  const byDay = new Map()
  for (const c of cases) {
    if (!c || c.cancelled || !c.date || !c.supplies?.length) continue
    // The week plan carries the hospital's full name ("CALVARY LENAH VALLEY"),
    // the inbox its code; both come to the same site.
    const key = `${c.date}|${siteCode(c.hospital) || c.hospital || ''}`
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key).push(c)
  }
  const out = []
  for (const list of byDay.values()) {
    const taken = new Map()
    for (const c of list.slice().sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')))) {
      for (const entry of c.supplies) {
        const item = inventoryFor(entry.system)
        if (!item || entry.navigation) continue
        let supply = entry.supply
        if (!supply || supply === 'Consignment') {
          const nth = (taken.get(item) || 0) + 1
          taken.set(item, nth)
          supply = supply || suggestSupplyOnDay(entry.system, c.hospital, nth)
        }
        const place = PLACES[siteCode(c.hospital)]
        if (supply !== 'TM Loan' || !place) continue
        out.push({
          id: `dispatch:${c.id}:${item.system}`,
          date: dispatchDay(c.date),
          caseDate: c.date,
          caseId: c.id,
          system: item.system,
          to: place,
          surgeon: c.surgeon || '',
          forCase: [c.surgeon, place, shortDay(c.date)].filter(Boolean).join(' · ')
        })
      }
    }
  }
  return out
}

/** Whether a real task already covers this dispatch: moving that kit to that hospital, before the case. */
export function alreadyTasked(dispatch, tasks = []) {
  const kit = inventoryFor(dispatch.system)
  return tasks.some(t => t && t.kind === 'move'
    && inventoryFor(t.thing) === kit
    && String(t.to || '').toLowerCase() === dispatch.to.toLowerCase()
    && (!t.date || (t.date <= dispatch.caseDate && t.date >= shift(dispatch.caseDate, -10))))
}

/** As a row on the day, for the week view. */
export function dispatchTask(dispatch) {
  return {
    id: dispatch.id,
    suggested: true,
    kind: 'move',
    what: `Send the ${dispatch.system} TM loan kit to ${dispatch.to}`,
    thing: dispatch.system,
    from: 'TM Office',
    to: dispatch.to,
    forCase: dispatch.forCase,
    caseId: dispatch.caseId,
    caseDate: dispatch.caseDate,
    date: dispatch.date,
    note: `For ${dispatch.forCase} — at least 48 hours ahead`
  }
}
