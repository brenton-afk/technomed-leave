// ─── The installed app's bottom edge (Brent, 6 Nov 2026) ─────────────────────
// Installed on an iPhone's home screen with a black-translucent status bar,
// the page is drawn from the very top of the glass, under the clock — but iOS
// sizes the viewport as the screen *less* the status bar, and paints nothing
// of the page below it. Only the canvas colour reaches the last ~59pt.
//
// Two things were tried and both were wrong:
//   · pinning the frame to `bottom: 0` — the bottom edge is the short one;
//   · sizing the frame to the measured screen — the extra height is drawn
//     where nothing is shown, so the tab bar's labels were cut off.
//
// So this stops fighting it. The frame stays the height iOS gives (100dvh),
// the tab bar sits at its foot with every label visible, and when the
// shortfall is detected `<html>` gets `tm-short-viewport`: the canvas turns
// the tab bar's own white, so the strip below reads as part of the bar
// rather than a navy gap, and the bar drops its home-indicator padding — the
// home indicator is already in that strip, below it.
//
// Nothing changes anywhere else: a browser tab, a desktop, an Android phone,
// or an iOS that reports the whole screen never get the class.

/** Whether this is the app launched from the home screen. */
export function isInstalled(win = window) {
  return Boolean(win.navigator?.standalone)
    || Boolean(win.matchMedia?.('(display-mode: standalone)').matches)
}

// A status bar with the Dynamic Island is 59pt; nothing larger is a status
// bar, and a larger difference means something else (split view, a keyboard).
const MAX_SHORTFALL = 80
const NAVY = '#042746'

/** How many points of the glass iOS leaves below the page, or 0. */
export function viewportShortfall({ installed, innerHeight, screenWidth, screenHeight, portrait }) {
  if (!installed || !innerHeight || !screenHeight) return 0
  const glass = portrait ? Math.max(screenWidth, screenHeight) : Math.min(screenWidth, screenHeight)
  const short = glass - innerHeight
  return short > 0 && short <= MAX_SHORTFALL ? short : 0
}

export function watchAppHeight(win = window) {
  const root = win.document.documentElement
  const apply = () => {
    const short = viewportShortfall({
      installed: isInstalled(win),
      innerHeight: win.innerHeight,
      screenWidth: win.screen?.width,
      screenHeight: win.screen?.height,
      portrait: win.innerHeight >= win.innerWidth
    })
    root.classList.toggle('tm-short-viewport', short > 0)
    // index.html gives <html> an inline navy so the first paint is not white
    // before the stylesheet arrives, and an inline colour beats the class. So
    // the canvas is set here too — and put back to that navy if it changes.
    root.style.background = short > 0 ? '#ffffff' : NAVY
  }
  apply()
  win.addEventListener('resize', apply)
  win.addEventListener('orientationchange', apply)
  return () => {
    win.removeEventListener('resize', apply)
    win.removeEventListener('orientationchange', apply)
  }
}
