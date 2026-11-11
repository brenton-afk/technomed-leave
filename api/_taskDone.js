import { getGoogleToken, CALENDAR_SCOPE_READONLY, getCalendarId, updateCalendarEvent } from './_googleCalendar.js'
import { isTask, readTask, doneLine, taskKey } from '../src/clinicalPlan/tasks.js'

export { taskKey }
import { similarity } from './_worklistMatch.js'
import { getWorklist, updateWorklistItem, redis, redisSetBody } from './_redis.js'
import { STAFF } from '../src/staffConfig.js'

// ─── A task is done once, everywhere it is written ───────────────────────────
// "I have completed that task and it shows as completed on the Monday, however
// still lists it as an item to complete for Tuesday. The portal needs to
// recognise that it's a double up… If we are going to have tasks listed on
// the portal, the staff need to be able to say when they have done them. This
// should then feedback to the task/project list and keep it up to date."
//   — Brent, 2 Nov 2026
//
// Two links, both made only on a near-certain match:
//
//   · Copies of the same calendar task on other days — the same words, for the
//     same person. Toni had entered the Dropbox task twice, two minutes apart,
//     on consecutive days. Exact words only: "Get Athlet back from RHH" on
//     Monday and again on Thursday can be two trips.
//   · The project list item it came from. The same words, or very nearly
//     (0.8 of the meaningful words) and the same person. Looser than the
//     calendar copies because the two were typed separately, stricter than
//     the 0.55 the meeting review uses to *flag* repeats — that one asks a
//     person; this one acts.

/** Other calendar entries that are this same task. */
export function twinTasks(events, eventId, task) {
  const key = taskKey(task)
  return (events || []).filter(e => e.id !== eventId && isTask(e.summary)
    && taskKey(readTask(e.summary, e.description)) === key)
}

/** Whether a roster first name (or nobody) and a project assignee are one person. */
function samePerson(who, assignee) {
  if (!who || !assignee || assignee === 'Unassigned') return true
  const staff = STAFF.find(s => s.name === assignee)
  const names = [staff?.firstName, staff?.name, ...(staff?.aka || []), assignee.split(' ')[0]]
    .filter(Boolean).map(n => n.toLowerCase())
  return names.includes(String(who).toLowerCase())
}

const flat = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Open project items that are this task. */
export function matchingWorklistItems(items, task) {
  return (items || []).filter(item => item.status !== 'done'
    && samePerson(task.who, item.assignee)
    && (flat(item.task) === flat(task.what) || similarity(item.task, task.what) >= 0.8))
}

/** Calendar tasks that are this project item. */
export function matchingCalendarTasks(events, item) {
  return (events || []).filter(e => {
    if (!isTask(e.summary)) return false
    const task = readTask(e.summary, e.description)
    return !task.done && samePerson(task.who, item.assignee)
      && (flat(task.what) === flat(item.task) || similarity(task.what, item.task) >= 0.8)
  })
}

function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Task entries on the bookings calendar around a date, found by their words. */
export async function taskEventsNear(date, words) {
  const token = await getGoogleToken(CALENDAR_SCOPE_READONLY)
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(getCalendarId())}/events`
    + `?timeMin=${encodeURIComponent(`${shiftDate(date, -30)}T00:00:00+10:00`)}`
    + `&timeMax=${encodeURIComponent(`${shiftDate(date, 60)}T23:59:59+10:00`)}`
    + `&singleEvents=true&maxResults=250&q=${encodeURIComponent(String(words).slice(0, 100))}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Could not search the calendar (${res.status})`)
  return (await res.json()).items || []
}

/** The description with the done line set or taken off. */
export function withDone(description, done, who, when) {
  const without = String(description || '').replace(/^\s*Done by [^\n]*$/gmi, '').replace(/\n{3,}/g, '\n\n').trimEnd()
  return done ? `${without}\n\n${doneLine(who, when)}`.trim() : without
}

export const DONE_COLOUR = '8'

/**
 * After one task is ticked: the same state on its copies, and the project
 * list brought into line. Best effort — the tick itself has already been
 * saved, and a calendar search failing must not undo it.
 */
export async function settleTask({ event, done, who, when, taskColour }) {
  const task = readTask(event.summary, event.description)
  const date = String(event.start?.date || event.start?.dateTime || '').slice(0, 10) || when
  const result = { copies: [], projectItems: [] }

  try {
    const events = await taskEventsNear(date, task.what)
    for (const twin of twinTasks(events, event.id, task)) {
      if (readTask(twin.summary, twin.description).done === done) continue
      await updateCalendarEvent(twin.id, {
        description: withDone(twin.description, done, who, when),
        colorId: done ? DONE_COLOUR : taskColour
      })
      result.copies.push(String(twin.start?.date || twin.start?.dateTime || '').slice(0, 10))
    }
  } catch (err) {
    result.copiesError = err.message
  }

  try {
    const key = `taskdone:worklist:${event.id}`
    if (done) {
      const { items } = await getWorklist()
      const matches = matchingWorklistItems(items, task)
      for (const item of matches) {
        await updateWorklistItem(item.id, { status: 'done', doneBy: who, doneVia: 'calendar', doneAt: new Date().toISOString() })
        result.projectItems.push(item.task)
      }
      if (matches.length) {
        await redisSetBody(key, JSON.stringify(matches.map(m => ({ id: m.id, status: m.status }))))
      }
    } else {
      // Undone: put back exactly what this tick closed, and nothing else.
      const raw = await redis('get', key)
      for (const { id, status } of raw ? JSON.parse(raw) : []) {
        const item = await updateWorklistItem(id, { status: status || 'open', doneBy: null, doneVia: null, doneAt: null }).catch(() => null)
        if (item) result.projectItems.push(item.task)
      }
      if (raw) await redis('del', key)
    }
  } catch (err) {
    result.projectError = err.message
  }
  return result
}

/** A project item ticked off: its calendar copies follow. */
export async function settleWorklistItem(item, who, when) {
  const events = await taskEventsNear(when, item.task)
  const ticked = []
  for (const e of matchingCalendarTasks(events, item)) {
    await updateCalendarEvent(e.id, { description: withDone(e.description, true, who, when), colorId: DONE_COLOUR })
    ticked.push(String(e.start?.date || '').slice(0, 10))
  }
  return ticked
}
