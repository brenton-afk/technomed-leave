import { useEffect, useState, useRef } from 'react'
import { todayStr } from './clinicalPlan/week.js'

// ─── Following the calendar rather than snapshotting it ──────────────────────
// Several people move bookings around in Google during the day — a list gets
// reordered, a case is cancelled — and this app is read while that is happening.
// A screen that fetched once on mount shows yesterday's plan for as long as it is
// left open, and there is nothing on it to say so.
//
// This was already true of the week plan and *not* of the calendar view, which
// fetched once and never again. That is how the app came to be showing a case
// that had been cancelled for the following day. Both use this now, so the two
// cannot drift apart again.

// How often an open, visible screen rechecks the calendar. Frequent enough that
// an edit made in Google appears before anyone would think to reload, rare enough
// to be nothing next to the app's other traffic. A hidden tab does not poll at
// all — there is nobody reading it, and a phone in a pocket should not be waking
// the radio every minute.
export const LIVE_POLL_MS = 60 * 1000

/**
 * Calls `refresh` on a timer while the page is visible, and immediately whenever
 * it becomes visible or regains focus.
 *
 * The visibility and focus handlers are the important half. A tab that has been
 * in the background is the most likely to be out of date, and waiting up to a
 * full interval before rechecking is exactly when someone picks the phone up to
 * look at it.
 *
 * @param {() => void} refresh  called only when the page is visible
 * @param {Array} deps          as useEffect; `refresh` should be a useCallback
 */
export function useLiveRefresh(refresh, deps = []) {
  useEffect(() => {
    const whenVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const timer = setInterval(whenVisible, LIVE_POLL_MS)
    document.addEventListener('visibilitychange', whenVisible)
    window.addEventListener('focus', whenVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', whenVisible)
      window.removeEventListener('focus', whenVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

// ─── A clock that ticks ──────────────────────────────────────────────────────
// "The auto refresh to the current day is also not working. The app needs to
// constantly refresh back to today's date."
//
// The week screen worked out today once, when it mounted, and then never
// again. That is fine for a page somebody opens and closes, and wrong for one
// that lives on a phone in a pocket and on a screen in the office: left open
// overnight, it was still showing yesterday in the morning, with the date
// highlighted and nothing to say it was stale. Nobody reloads an app that has
// not told them it is out of date.
//
// Checked on the same signals as the plan itself, so the data and the date it
// is filed under can never disagree. Not on its own timer — a second timer
// drifting against the first is how you get the plan for Tuesday under
// Monday's heading for sixty seconds.

/**
 * Today's date, kept current while the page is open.
 *
 * Re-renders only when the date actually changes — which is once a day, at
 * midnight, and never during the hours anybody is using this.
 *
 * @param {() => string} readToday  injectable for tests; defaults to todayStr
 */
export function useToday(readToday = todayStr) {
  const [day, setDay] = useState(readToday)

  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return
      // Same value means no re-render, so this costs nothing on the 59 ticks
      // out of 60 where it is still the same day.
      setDay(current => (readToday() === current ? current : readToday()))
    }
    const timer = setInterval(check, LIVE_POLL_MS)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [readToday])

  return day
}

/**
 * How long away counts as having left.
 *
 * Coming back to the app should put you back on today — that is the whole
 * ask. But "back" fires on every focus, including the one you get when a
 * photo picker closes or a notification is dismissed, and resetting somebody's
 * week out from under them while they are part-way through adding a booking
 * for next Thursday is worse than the staleness it prevents.
 *
 * Half an hour is past the point where somebody is still mid-task and well
 * short of the gap between picking the phone up at home and at work.
 */
export const AWAY_LONG_ENOUGH_MS = 30 * 60 * 1000

/**
 * Calls `comeBack` when the page is returned to after a real absence.
 *
 * Separate from useToday because they answer different questions — one is
 * "has the date changed", the other "have you been gone" — and a screen
 * wants both: the date change for the small hours, this for the morning.
 *
 * @param {() => void} comeBack
 * @param {() => number} clock  injectable for tests
 */
export function useReturn(comeBack, clock = () => Date.now()) {
  const leftAt = useRef(null)

  useEffect(() => {
    const changed = () => {
      if (document.visibilityState === 'hidden') {
        leftAt.current = clock()
        return
      }
      const since = leftAt.current
      leftAt.current = null
      if (since !== null && clock() - since >= AWAY_LONG_ENOUGH_MS) comeBack()
    }
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [comeBack, clock])
}
