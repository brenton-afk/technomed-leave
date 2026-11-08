import { useState, useEffect, useCallback } from 'react'

// ─── Noticing that the app itself has moved on ───────────────────────────────
// The plan refreshes every minute. The app never did.
//
// This is a portal people leave open — on the laptop in the office all day, on a
// phone in a pocket between hospitals. A tab opened on Monday keeps running
// Monday's build until somebody happens to reload, and nothing on screen
// suggests otherwise: the bookings keep updating, so it looks live. A change
// shipped at four o'clock was invisible to the team leader at half past, and the
// only clue was that a button they had been told about was not there.
//
// There is no service worker to hang an update event off, so this asks the
// simplest question there is: is the app file the server is handing out still
// the one this page is running? The built file is content-hashed, so the name
// changing *is* the deploy.
//
// It used to only offer, never reload. That let a desktop tab nobody tapped
// keep running old code for days, and the phone and the desktop disagreed
// about who was leading next week (Brent, 8 Nov 2026: "There cannot be
// discrepancies between the two versions of the portal"). So now, once a newer
// build is known: a page out of view reloads the moment it is looked at again,
// before anyone reads anything off it; a page in view shows the bar and reloads
// itself a minute later — never while somebody is typing (`applyWhenSafe`).

const BUNDLE = /assets\/(index-[A-Za-z0-9_-]+\.js)/

/** The app file this page is running, from the script tag that loaded it. */
export function runningBundle(doc = document) {
  for (const script of doc.querySelectorAll('script[src]')) {
    const match = BUNDLE.exec(script.getAttribute('src') || '')
    if (match) return match[1]
  }
  // In dev there is no hashed bundle, and nothing to compare.
  return null
}

/** The app file the server is handing out now. */
export async function servedBundle(fetcher = fetch) {
  const res = await fetcher('/', { cache: 'no-store' })
  if (!res.ok) throw new Error('Could not check for an update')
  return (BUNDLE.exec(await res.text()) || [])[1] || null
}

/**
 * Whether a newer build is waiting.
 *
 * Both names have to be readable for this to say yes. A missing one means dev,
 * or an index.html that could not be fetched, and a reload prompt nobody can
 * satisfy is worse than none — it would sit there through every offline moment
 * in a hospital basement.
 */
export async function hasNewBuild(fetcher) {
  const running = runningBundle()
  if (!running) return false
  const served = await servedBundle(fetcher)
  return Boolean(served) && served !== running
}

/** How often to look. Rare: a deploy is a thing that happens a few times a day. */
const EVERY = 5 * 60 * 1000

/**
 * True once a newer build is available, and then it stays true.
 *
 * Checked only while the tab is visible, and again the moment it becomes
 * visible — which is the useful one. Picking the phone up outside a theatre is
 * exactly when somebody needs the version that has the afternoon's list order
 * in it.
 */
export function useNewBuild() {
  const [ready, setReady] = useState(false)

  const check = useCallback(async () => {
    if (document.visibilityState !== 'visible') return
    try {
      if (await hasNewBuild()) setReady(true)
    } catch {
      // Offline, or the check itself failed. Not worth saying anything about:
      // the app still works and the question will be asked again shortly.
    }
  }, [])

  useEffect(() => {
    if (ready) return undefined
    check()
    const timer = setInterval(check, EVERY)
    document.addEventListener('visibilitychange', check)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check) }
  }, [check, ready])

  return ready
}

export const AUTO_RELOAD_AFTER_MS = 60 * 1000

/** Somebody is mid-entry: a text field, a text area or an editable block has focus. */
export function busyTyping(doc = document) {
  const el = doc.activeElement
  if (!el) return false
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  return el.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'submit', 'range'].includes(String(el.type).toLowerCase())
}

/**
 * Applies a newer build without losing anybody's typing: on returning to the
 * page at once, otherwise after `after` ms, put off 15 s at a time while a
 * field has focus. Returns a stop function.
 */
export function applyWhenSafe({ reload = () => window.location.reload(), after = AUTO_RELOAD_AFTER_MS, doc = document } = {}) {
  let timer = null
  const attempt = () => {
    if (busyTyping(doc)) { timer = setTimeout(attempt, 15000); return }
    reload()
  }
  const onVisible = () => { if (doc.visibilityState === 'visible' && !busyTyping(doc)) reload() }
  if (doc.visibilityState === 'visible') timer = setTimeout(attempt, after)
  doc.addEventListener('visibilitychange', onVisible)
  return () => { clearTimeout(timer); doc.removeEventListener('visibilitychange', onVisible) }
}
