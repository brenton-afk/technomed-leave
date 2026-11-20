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
// A layer closed by its ✕ does not go back at once (Brent, 20 Nov 2026: Move
// in a kit "nothing happens"). In a real browser `history.back()` is queued,
// and a `pushState` made before it runs — the next overlay opening in the same
// tap — does not cancel it: the back lands on the step before and pops the new
// overlay's entry, which closes it. So the step-off waits a turn
// (`stepOff`): anything pushed before it runs takes the closed layer's entry
// over instead (`takeOver`, a replaceState), and anything pushed while a back
// is on its way waits for it to arrive (`afterBack`). jsdom cancels the queued
// back on pushState and cannot show this; `npm run check:back` runs it in
// Chromium.
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

let pending = null         // { seq, timer } — a ✕'d layer's step, not yet taken off
let inFlight = null        // a timer while our own back() is on its way
const queued = []          // pushes waiting for that back to arrive

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

/** Our own back(): pushes made before it arrives wait for it (`afterBack`). */
function goBack() {
  clearTimeout(inFlight)
  // A back that never arrives (a browser that drops it) must not hold pushes
  // for ever.
  inFlight = setTimeout(arrived, 500)
  window.history.back()
}

function arrived() {
  clearTimeout(inFlight)
  inFlight = null
  while (queued.length && !inFlight) queued.shift()()
}

/** Run `push` now, or once our own back has arrived. */
function afterBack(push) {
  if (inFlight) queued.push(push)
  else push()
}

/**
 * A ✕'d layer's step still on top and not yet taken off: the push about to be
 * made replaces it rather than adding a step after it. Returns true if so,
 * with `seq` set to that step.
 */
function takeOver() {
  if (!pending || window.history.state?.tmSeq !== pending.seq) return false
  clearTimeout(pending.timer)
  seq = pending.seq
  pending = null
  return true
}

/** Take a ✕'d layer's step off — a turn later, unless a push takes it over. */
function stepOff(layerSeq) {
  if (pending) clearTimeout(pending.timer)
  const p = { seq: layerSeq }
  p.timer = setTimeout(() => {
    if (pending === p) pending = null
    if (window.history.state?.tmSeq === layerSeq) goBack()
  }, 0)
  pending = p
}

function onPop(e) {
  const ours = !!inFlight
  if (ours) { clearTimeout(inFlight); inFlight = null }
  // The person pressed back before a ✕'d layer's step came off: that back took it.
  if (pending) { clearTimeout(pending.timer); pending = null }
  const s = e.state
  if (!s || typeof s.tmSeq !== 'number') return arrived()
  seq = s.tmSeq
  // Close every layer opened after this entry, newest first.
  while (layers.length && layers[layers.length - 1].seq > s.tmSeq) {
    const layer = layers.pop()
    try { layer.close() } catch { /* a closed screen */ }
  }
  // A layer's entry whose layer has already gone: step past it.
  if (s.tmLayer && !layers.some(l => l.seq === s.tmSeq)) {
    goBack()
    return
  }
  // A page opened while our back was on its way is where the person is going;
  // the step that back landed on is not.
  if (s.tmNav && !(ours && queued.some(q => q.page)) && !sameNav(s.tmNav, navNow)) {
    navNow = s.tmNav
    onNav?.(s.tmNav)
  }
  arrived()
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
  const page = plain(nav)
  const push = () => {
    if (takeOver()) write('replaceState', page)
    else { seq += 1; write('pushState', page) }
  }
  push.page = true
  afterBack(push)
}

/** The same step, a different page (signing in or out). */
export function replacePage(nav) {
  navNow = plain(nav)
  if (!hasHistory()) return
  const page = plain(nav)
  const replace = () => { takeOver(); write('replaceState', page) }
  replace.page = true
  afterBack(replace)
}

/**
 * The on-screen back arrow to `target` (a tab's hub). When the step behind is
 * that page, it is the same as the phone's back; otherwise this step becomes
 * `target`. Returns true when history will deliver the page.
 */
export function backTo(target) {
  if (!hasHistory()) return false
  const prev = navs.get(seq - 1)
  if (prev && sameNav(prev, target) && !layers.length && !pending && !inFlight) {
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
    const layer = { seq: null, gone: false, close: () => close.current?.() }
    afterBack(() => {
      if (layer.gone) return // closed before its step could be added
      if (takeOver()) write('replaceState', navNow, { tmLayer: true })
      else { seq += 1; write('pushState', navNow, { tmLayer: true }) }
      layer.seq = seq
      layers.push(layer)
    })
    return () => {
      layer.gone = true
      const i = layers.indexOf(layer)
      if (i < 0) return // closed by the back button already, or never added
      layers.splice(i, 1)
      // On top: take its step back off (a turn later — see stepOff). Not on
      // top (a page was opened from it): its entry is skipped when back
      // reaches it.
      if (window.history.state?.tmSeq === layer.seq) stepOff(layer.seq)
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
  if (pending) clearTimeout(pending.timer)
  pending = null
  clearTimeout(inFlight)
  inFlight = null
  queued.length = 0
}
