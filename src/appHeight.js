// ─── The installed app's height (Brent, 6 Nov 2026) ─────────────────────────
// "Gap at the bottom still exists." Installed on an iPhone's home screen with
// a black-translucent status bar, the page is drawn from the very top of the
// glass, under the clock — but iOS still sizes the viewport as the screen
// *less* the status bar. 100dvh is that short height, and so is anything
// pinned to the bottom edge, because the edge itself is short: the frame ends
// a status bar's height above the bottom and the page's navy shows below the
// tab bar.
//
// So the installed app measures the glass. In that mode the app owns the
// whole screen, so its height is the screen's height in the current
// orientation; when iOS reports less, by no more than a status bar, the frame
// is given the screen's height instead, as `--tm-app-height`. Everywhere else
// (a browser tab, a desktop, an iOS that has fixed this) the variable is never
// set and the CSS keeps 100dvh.

/** Whether this is the app launched from the home screen. */
export function isInstalled(win = window) {
  return Boolean(win.navigator?.standalone)
    || Boolean(win.matchMedia?.('(display-mode: standalone)').matches)
}

// A status bar with the Dynamic Island is 59pt; nothing larger is a status
// bar, and a larger difference means something else (split view, a keyboard).
const MAX_SHORTFALL = 80

/** The height the frame should be, or null to leave the CSS alone. */
export function appHeight({ installed, innerHeight, screenWidth, screenHeight, portrait }) {
  if (!installed || !innerHeight || !screenHeight) return null
  const glass = portrait ? Math.max(screenWidth, screenHeight) : Math.min(screenWidth, screenHeight)
  const short = glass - innerHeight
  return short > 0 && short <= MAX_SHORTFALL ? glass : null
}

export function watchAppHeight(win = window) {
  const root = win.document.documentElement
  const apply = () => {
    const height = appHeight({
      installed: isInstalled(win),
      innerHeight: win.innerHeight,
      screenWidth: win.screen?.width,
      screenHeight: win.screen?.height,
      portrait: win.innerHeight >= win.innerWidth
    })
    if (height) {
      root.style.setProperty('--tm-app-height', `${height}px`)
      root.classList.add('tm-app-height')
    } else {
      root.style.removeProperty('--tm-app-height')
      root.classList.remove('tm-app-height')
    }
  }
  apply()
  win.addEventListener('resize', apply)
  win.addEventListener('orientationchange', apply)
  return () => {
    win.removeEventListener('resize', apply)
    win.removeEventListener('orientationchange', apply)
  }
}
