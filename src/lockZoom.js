// ─── Coming back to the app at the size it is meant to be ────────────────────
// "The screen aspect is still getting zoomed in from time to time and hard to
// get it to zoom back out. Sometimes it is zoomed in slightly and we therefore
// can't see some of the peripheral menu/options."
//
// Two fingers on a scrolling list is a pinch. It happens by accident several
// times a day on a phone held one-handed in a corridor, and in an installed
// web app iOS remembers the zoom — across a refresh, across a relaunch, across
// the night. A page zoomed to 1.1 is not obviously zoomed; it just quietly
// loses the right-hand edge of the screen, which is where the controls are.
// Getting back is a careful two-finger spread that nobody manages first go.
//
// The usual fix is to ban pinch-zoom outright — maximum-scale=1 and
// user-scalable=no — and this app deliberately does not, for a good reason
// recorded in index.html: it is used to read handwritten forms and scanned
// usage sheets, and taking magnification away from the one screen that needs
// it most is a worse trade than the bug.
//
// So the zoom stays available and stops being permanent. Pinch into a scan all
// you like; the moment the app is left and come back to, it is 1:1 again.
//
// ── How a reset is actually done ──
//
// There is no API for "set the zoom". What works on iOS is to make the page
// briefly unzoomable, which forces the engine back to scale 1, and then put
// the viewport back as it was so pinch still works afterwards. Ugly, and the
// only thing that does it.

const LOCKED = 'width=device-width, initial-scale=1, maximum-scale=1, '
  + 'user-scalable=no, viewport-fit=cover'

/** How far from 1 counts as zoomed. Below this is rounding, not a pinch. */
const SLACK = 0.02

/** The current page scale, or 1 where the browser will not say. */
export function currentScale(view = globalThis.visualViewport) {
  const scale = Number(view?.scale)
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

export function isZoomed(view = globalThis.visualViewport) {
  return Math.abs(currentScale(view) - 1) > SLACK
}

/**
 * Puts the page back to 1:1, then restores the viewport it had.
 *
 * Returns whether it did anything, so a caller can tell "was not zoomed" from
 * "could not find the viewport tag" — the second is a bug and the first is
 * the ordinary case.
 */
export function resetZoom(doc = globalThis.document) {
  const meta = doc?.querySelector?.('meta[name="viewport"]')
  if (!meta) return false

  const original = meta.getAttribute('content')
  meta.setAttribute('content', LOCKED)
  // Back on the next frame. Restoring synchronously is too fast for the engine
  // to have acted on the lock, and the page stays zoomed — which is the whole
  // bug, reproduced by the thing meant to fix it.
  const restore = () => meta.setAttribute('content', original)
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore)
  else setTimeout(restore, 0)
  return true
}

/**
 * Watches for the app being returned to, and straightens it out.
 *
 * Three moments, because a phone gets back to an app three ways and iOS fires
 * a different event for each:
 *
 *   · the tab or app becoming visible again — the common one, picking the
 *     phone up outside a theatre
 *   · pageshow, which also covers being restored from the back/forward cache,
 *     where visibilitychange does not fire at all
 *   · an orientation change, which is where a stuck zoom is most obvious
 *
 * Never while the app is in use. Resetting the zoom under somebody who has
 * just pinched into a scan to read a lot number would be its own bug.
 *
 * @returns {() => void} stop watching
 */
export function watchZoom(target = globalThis) {
  if (!target?.addEventListener) return () => {}

  const straighten = () => {
    if (target.document?.visibilityState === 'hidden') return
    if (!isZoomed(target.visualViewport)) return
    resetZoom(target.document)
  }

  const onVisible = () => {
    if (target.document?.visibilityState === 'visible') straighten()
  }

  target.document?.addEventListener?.('visibilitychange', onVisible)
  target.addEventListener('pageshow', straighten)
  target.addEventListener('orientationchange', straighten)

  return () => {
    target.document?.removeEventListener?.('visibilitychange', onVisible)
    target.removeEventListener('pageshow', straighten)
    target.removeEventListener('orientationchange', straighten)
  }
}
