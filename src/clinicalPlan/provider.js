// ─── Data provider ────────────────────────────────────────────────────────────
// The single seam between the UI and where plans come from. Swapping the
// fixture for the live calendars is a change in here only — no component knows
// which it is looking at.

import { buildWeekPlan } from './buildWeekPlan.js'
import { readBooking, detectHospital } from './parse.js'
import { FIXTURE_WEEK } from './fixture.js'
import { formatListPlace } from './listPlace.js'

// The cache holds a *derived* plan — the notes, the flags, the case lines — not
// the calendar events it came from. So it is only valid for the code that derived
// it, and the build stamp is part of the key.
//
// Without that, changing the derivation changes nothing anyone can see: the
// browser keeps serving the plan the previous build produced, and the app looks
// like the deploy never happened. That is exactly what happened when the colour
// note and the on-call line were taken out of the week's notes.
const BUILD = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'dev'
const CACHE_PREFIX = `tm_clinical_plan:${BUILD}:`
const PREFS_KEY = 'tm_clinical_prefs'
// How long a cached plan may be shown before it is refetched. Short, because
// this is only the first paint: an open tab also polls (see LIVE_POLL_MS), so
// the cache exists to avoid a blank screen rather than to avoid fetching.
const TTL_MS = 60 * 1000

// Re-exported so existing importers keep working. It lives in src/liveRefresh.js
// with the hook that uses it, because the calendar view needs the same number and
// having it here made it look like a property of the plan.
export { LIVE_POLL_MS } from '../liveRefresh.js'

/**
 * A fingerprint of everything the plan actually displays.
 *
 * Polling means most fetches return exactly what is already on screen. Replacing
 * the plan anyway would rebuild the whole page every minute — losing scroll
 * position and flickering — so the fetched plan is only adopted when this
 * changes. Deliberately excludes the sync timestamp, which changes on every
 * fetch by definition and would make every poll look like an edit.
 */
export function planSignature(plan) {
  if (!plan) return ''
  const parts = [plan.title, plan.subtitle, plan.summaryLine, plan.notes,
    (plan.surgeons || []).join(','),
    (plan.keyFlags || []).map(f => `${f.label}:${f.text}`).join('|')]
  for (const day of plan.days || []) {
    parts.push(day.date, day.caseCountLine || '')
    for (const flag of day.flags || []) parts.push(flag.text)
    for (const group of day.casesByHospital || []) {
      parts.push(group.hospital)
      for (const c of group.cases || []) {
        // `rep` and `cancelled` belong here for the same reason as every other
        // field: the plan is only replaced when this string changes, so a fact
        // left out of it can change in Google and never reach the screen. Who
        // attended is added to a booking *after* the case, which is precisely a
        // mid-poll edit.
        // Where we are on the hospital's list belongs here for that same
        // reason, and is the sharpest case of it: recording one is a change to
        // nothing else on the card, so leaving it out meant the running order
        // reached Google and the app then threw the answer away as unchanged.
        parts.push([c.id, c.patient, c.surgeon, c.operation, c.system, c.supply, c.kit,
          c.rep || '', c.unread || '', c.cancelled ? 'off' : '',
          formatListPlace(c.listPlace),
          (c.notes || []).map(n => n.text).join('~')].join('\u0001'))
      }
    }
    for (const item of day.nonSurgeonItems || []) parts.push(item.text)
    for (const item of day.otherRollup || []) parts.push(item.text || String(item))
  }
  return parts.join('\u0002')
}

/** Exported so a test can ask which key this build writes, rather than guess. */
export function cacheKey(weekStart) {
  return `${CACHE_PREFIX}${weekStart}`
}

/**
 * Clears plans left by other builds.
 *
 * Keying by build stops a stale plan being *read*, but without this the old
 * entries stay in localStorage for good, and a week's plan is not small. One
 * sweep on load is enough — there is only ever one build writing.
 */
function forgetOtherBuilds() {
  try {
    const stale = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('tm_clinical_plan:') && !key.startsWith(CACHE_PREFIX)) stale.push(key)
    }
    for (const key of stale) localStorage.removeItem(key)
  } catch {
    // Nothing here is worth failing a page load over.
  }
}

forgetOtherBuilds()

export function readCachedPlan(weekStart) {
  try {
    const raw = localStorage.getItem(cacheKey(weekStart))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.plan) return null
    return { plan: parsed.plan, cachedAt: parsed.cachedAt, stale: Date.now() - parsed.cachedAt > TTL_MS }
  } catch {
    return null
  }
}

function writeCachedPlan(weekStart, plan) {
  try {
    localStorage.setItem(cacheKey(weekStart), JSON.stringify({ plan, cachedAt: Date.now() }))
  } catch {
    // A full quota must never break the view.
  }
}

export function readPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function writePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch { /* ignore */ }
}

/**
 * Fetches the plan for a week.
 *
 * Resolution order: fresh cache → the API → cached-but-stale. A failure never
 * blanks good data (§2.4): it returns the last known plan with `fromCache` and
 * `error` set so the view can show the amber banner over real content.
 *
 * @returns {Promise<{plan: import('./types.js').WeekPlan, fromCache: boolean, cachedAt?: number, error?: string}>}
 */
/**
 * The cases already booked on one day, as hospital and systems.
 *
 * Wanted when a booking is being moved onto a day: a kit already spoken for is
 * a clash whether the second case is new or was dragged there from Tuesday. The
 * week on screen cannot answer it, because the day moved to is often not in it.
 *
 * Deliberately thin — no plan, no grouping, no notes. It answers one question,
 * and it is asked every time somebody touches the date field.
 */
export async function fetchDayCases(date, { token } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return []
  const res = await fetch(
    `/api/calendar/today?action=week&start=${date}&end=${date}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const data = await res.json()
  if (data.error) throw new Error(data.error)

  return (data.events || [])
    .filter(e => e.source !== 'leave')
    .map(e => {
      const read = readBooking(e.summary || '', e.description || '')
      if (!read?.patient) return null
      return {
        id: e.id,
        hospital: detectHospital(e.location, e.description, { caseEvent: true }),
        system: read.system || '',
        kit: read.kit || '',
        cancelled: Boolean(read.cancelled)
      }
    })
    .filter(c => c && !c.cancelled)
}

export async function fetchWeekPlan(window, { token, force = false, useFixture = false } = {}) {
  if (useFixture) {
    return { plan: FIXTURE_WEEK, fromCache: false, fixture: true }
  }

  const cached = readCachedPlan(window.startDate)
  if (!force && cached && !cached.stale) {
    return { plan: cached.plan, fromCache: true, cachedAt: cached.cachedAt }
  }

  try {
    const res = await fetch(
      `/api/calendar/today?action=week&start=${window.startDate}&end=${window.endDate}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    )
    const data = await res.json()
    if (data.error) throw new Error(data.error)

    // Derivation happens client-side from raw events, so the same pure function
    // backs the view, the text copy and the .docx.
    const plan = buildWeekPlan(data.events || [], window, { generatedAt: data.syncedAt })
    writeCachedPlan(window.startDate, plan)
    // One calendar failing must not fail the week — a missing sub-calendar
    // should not hide the bookings. But it must not pass unmentioned either:
    // the leave calendar going unreadable looks exactly like nobody being on
    // leave, and that is a difference worth knowing about before you plan a
    // week around it.
    return { plan, fromCache: false, sourceErrors: data.sourceErrors || [] }
  } catch (err) {
    if (cached) {
      return { plan: cached.plan, fromCache: true, cachedAt: cached.cachedAt, error: err.message }
    }
    throw err
  }
}
