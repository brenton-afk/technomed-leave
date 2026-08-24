import { useEffect } from 'react'

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
