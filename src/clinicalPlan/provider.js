// ─── Data provider ────────────────────────────────────────────────────────────
// The single seam between the UI and where plans come from. Swapping the
// fixture for the live calendars is a change in here only — no component knows
// which it is looking at.

import { buildWeekPlan } from './buildWeekPlan.js'
import { FIXTURE_WEEK } from './fixture.js'

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

// How often an open, visible tab rechecks the calendar. The plan is worked from
// while lists are still being moved around, so it has to follow the calendar
// rather than snapshot it. A minute is frequent enough that an edit made in
// Google shows up before anyone would think to reload, and rare enough to be
// nothing next to the app's other traffic. Hidden tabs do not poll at all.
export const LIVE_POLL_MS = 60 * 1000

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
        parts.push([c.id, c.patient, c.surgeon, c.operation, c.system, c.supply, c.kit,
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
    return { plan, fromCache: false }
  } catch (err) {
    if (cached) {
      return { plan: cached.plan, fromCache: true, cachedAt: cached.cachedAt, error: err.message }
    }
    throw err
  }
}
