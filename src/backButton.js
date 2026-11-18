// ─── The phone's back button walks back through the portal (Brent, 18 Nov 2026)
// "When navigating with the back button in the portal app, it exits the entire
// app and we want to be able to navigate back to the last page."
//
// The portal's navigation is state, not routes (App.jsx holds {tab, sub}), so
// the browser's history held one entry and Android's back — or a browser's —
// left the app. Now every page change is a history entry, and so is anything
// opened on top of a page that the back button should close first: an admin
// section, a kit, a document, a sheet (`useBackLayer`).
//
// Each entry carries the page it belongs to (`tmNav`) and a sequence number
// (`tmSeq`). Going back to an entry: every layer opened after it is closed, and
// the page becomes the entry's page. A layer that was closed some other way
// (its own ✕) takes its entry back off; one that went away while it was not on
// top (a sheet that navigated elsewhere) leaves a dead entry, which is skipped.
//
// From the first page the app opened on, back leaves the app as before — but a
// link that lands deep (an approval email → Admin) gets Cases put underneath,
// so back from there goes to the portal's home rather than out.

import { useEffect, useRef } from 'react'

export const HOME = { tab: 'cases', sub: null }

let seq = 0
let navNow = HOME
let onNav = null
let installed = false
const layers = []          // { seq, close } — oldest first
const navs = new Map()     // seq → page, for the entries this session knows

const hasHistory = () => typeof window !== 'undefined' && !!window.history?.pushState

/** A page as stored: plain values only (history state is structured-cloned). */
function plain(nav) {
  const out = {}
  for (const [k, v] of Object.entries(nav || {})) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v
  }
  return out
}

export const sameNav = (a, b) => {
  const pa = plain(a), pb = plain(b)
  const keys = new Set([...Object.keys(pa), ...Object.keys(pb)])
  for (const k of keys) if ((pa[k] ?? null) !== (pb[k] ?? null)) return false
  return true
}

function write(kind, nav, extra = {}) {
  const state = { ...(window.history.state || {}), tmNav: plain(nav), tmSeq: seq, ...extra }
  if (!extra.tmLayer) delete state.tmLayer
  try { window.history[kind](state, '') } catch { /* a page this browser cannot store */ }
  navs.set(seq, plain(nav))
}

function onPop(e) {
  const s = e.state
  if (!s || typeof s.tmSeq !== 'number') return
  seq = s.tmSeq
  // Close every layer opened after this entry, newest first.
  while (layers.length && layers[layers.length - 1].seq > s.tmSeq) {
    const layer = layers.pop()
    try { layer.close() } catch { /* a closed screen */ }
  }
  // A layer's entry whose layer has already gone: step past it.
  if (s.tmLayer && !layers.some(l => l.seq === s.tmSeq)) {
    window.history.back()
    return
  }
  if (s.tmNav && !sameNav(s.tmNav, navNow)) {
    navNow = s.tmNav
    onNav?.(s.tmNav)
  }
}

/**
 * Called once by App with the page it opened on and how to change page.
 * Returns a function that stops listening.
 */
export function startBackButton(initial, setPage) {
  onNav = setPage
  navNow = plain(initial)
  if (!hasHistory()) return () => {}
  const existing = window.history.state
  if (existing && typeof existing.tmSeq === 'number') {
    // A reload: the entries behind this one are still the portal's.
    seq = existing.tmSeq
    write('replaceState', initial)
  } else if (!sameNav(initial, HOME)) {
    seq = 0
    write('replaceState', HOME)
    seq = 1
    write('pushState', initial)
  } else {
    seq = 0
    write('replaceState', initial)
  }
  if (!installed) {
    window.addEventListener('popstate', onPop)
    installed = true
  }
  return () => {
    window.removeEventListener('popstate', onPop)
    installed = false
    onNav = null
  }
}

/** A new page: one more step for the back button. */
export function pushPage(nav) {
  if (sameNav(nav, navNow)) return
  navNow = plain(nav)
  if (!hasHistory()) return
  seq += 1
  write('pushState', nav)
}

/** The same step, a different page (signing in or out). */
export function replacePage(nav) {
  navNow = plain(nav)
  if (!hasHistory()) return
  write('replaceState', nav)
}

/**
 * The on-screen back arrow to `target` (a tab's hub). When the step behind is
 * that page, it is the same as the phone's back; otherwise this step becomes
 * `target`. Returns true when history will deliver the page.
 */
export function backTo(target) {
  if (!hasHistory()) return false
  const prev = navs.get(seq - 1)
  if (prev && sameNav(prev, target) && !layers.length) {
    window.history.back()
    return true
  }
  replacePage(target)
  return false
}

/**
 * While `open`, the phone's back button calls `onClose` instead of leaving the
 * page. Closing it any other way takes its step back off.
 */
export function useBackLayer(open, onClose) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open || !hasHistory()) return undefined
    seq += 1
    const layer = { seq, close: () => close.current?.() }
    write('pushState', navNow, { tmLayer: true })
    layers.push(layer)
    return () => {
      const i = layers.indexOf(layer)
      if (i < 0) return // closed by the back button already
      layers.splice(i, 1)
      // On top: take its step back off. Not on top (a page was opened from
      // it): its entry is skipped when back reaches it.
      if (window.history.state?.tmSeq === layer.seq) window.history.back()
    }
  }, [open])
}

/** Tests only. */
export function resetBackButton() {
  if (typeof window !== 'undefined') window.removeEventListener('popstate', onPop)
  installed = false
  seq = 0
  navNow = HOME
  onNav = null
  layers.length = 0
  navs.clear()
}
