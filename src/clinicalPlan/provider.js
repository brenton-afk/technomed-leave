// ─── Data provider ────────────────────────────────────────────────────────────
// The single seam between the UI and where plans come from. Swapping the
// fixture for the live calendars is a change in here only — no component knows
// which it is looking at.

import { buildWeekPlan } from './buildWeekPlan.js'
import { FIXTURE_WEEK } from './fixture.js'

const CACHE_PREFIX = 'tm_clinical_plan:'
const PREFS_KEY = 'tm_clinical_prefs'
// Short TTL on top of the scheduled 5:00pm / 4:30pm syncs, so an open tab
// picks up a fresh plan without hammering the calendar.
const TTL_MS = 15 * 60 * 1000

function cacheKey(weekStart) {
  return `${CACHE_PREFIX}${weekStart}`
}

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
