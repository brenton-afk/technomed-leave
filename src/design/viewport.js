import { useState, useEffect } from 'react'

// ─── One place that decides what a screen is ─────────────────────────────────
// The app was built for a phone held in one hand in a theatre corridor, and that
// is still the case it has to be best at. A desktop is a different machine used
// for different work: booking a week in, reconciling usage, going through the
// admin. Same data, same rules, different shape.
//
// The breakpoint is a width, not a device. A laptop with a browser window
// dragged narrow gets the phone layout, and that is correct — it is the space
// available that decides whether a sidebar fits, not what the machine is.
//
// 1024 because below it a 240px sidebar plus a usable content column starts to
// squeeze, and because it is the width at which an iPad in landscape becomes
// worth treating as a desktop.
export const DESKTOP_MIN = 1024
export const DESKTOP_QUERY = `(min-width: ${DESKTOP_MIN}px)`

/**
 * Whether there is room for the desktop layout.
 *
 * Read from matchMedia rather than from a resize listener: the browser already
 * knows, and asking it means no work on every pixel of a window drag.
 *
 * The first render answers from the same query, so a desktop does not flash the
 * phone layout before settling. Where there is no matchMedia at all — a test
 * environment, a very old browser — the answer is false, and the phone layout
 * is the safe thing to be wrong with.
 */
export function useIsDesktop() {
  const [wide, setWide] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(DESKTOP_QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const query = window.matchMedia(DESKTOP_QUERY)
    const answer = event => setWide(event.matches)
    // addListener is the old spelling, still the only one some Safari builds
    // have. Without it the layout would never respond to a window being resized.
    if (query.addEventListener) query.addEventListener('change', answer)
    else query.addListener(answer)
    setWide(query.matches)
    return () => {
      if (query.removeEventListener) query.removeEventListener('change', answer)
      else query.removeListener(answer)
    }
  }, [])

  return wide
}
