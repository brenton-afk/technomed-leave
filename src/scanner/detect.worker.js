// ─── Page detection, off the main thread ──────────────────────────────────────
// "The google drive scanner is ultra fast … really really slick." — Brent,
// 3 Nov 2026, with screenshots.
//
// Detection is four Canny passes and a contour search per frame: about 12ms
// on a laptop for a portrait phone frame, and two or three times that on a
// phone. It used to run on the main thread, which is also the thread that
// animates the outline and repaints the viewfinder — so every detection froze
// the outline for a frame or two, and the overlay stuttered however good the
// tracking underneath it was. Here it runs beside the page instead, and the
// main thread only ever draws.
//
// A classic worker, because the engine is a UMD script and only importScripts
// can load one. The handshake is the same as opencvLoader.js and for the same
// reasons: what lands on `cv` is a thenable that resolves to itself, and
// resolving a promise with it adopts it for ever, so `then` is removed first.

import { detectDocument } from './documentDetect.js'

const SOURCE = '/vendor/opencv-4.13.0.js'
let cv = null

function usable(m) {
  return typeof m?.Mat === 'function'
}

function ready(m) {
  if (cv || !usable(m)) return
  if (typeof m.then === 'function') {
    try { delete m.then } catch { m.then = undefined }
  }
  cv = m
  self.postMessage({ type: 'ready' })
}

function load() {
  try {
    self.importScripts(SOURCE)
  } catch {
    self.postMessage({ type: 'failed' })
    return
  }
  const exported = self.cv
  if (usable(exported)) { ready(exported); return }
  if (typeof exported?.then === 'function') exported.then(ready, () => {})
  if (exported && typeof exported === 'object') exported.onRuntimeInitialized = () => ready(self.cv)
  const poll = setInterval(() => {
    if (cv) clearInterval(poll)
    else if (usable(self.cv)) { clearInterval(poll); ready(self.cv) }
  }, 150)
}

self.onmessage = event => {
  const message = event.data || {}
  if (message.type !== 'frame') return
  let found = null
  const started = performance.now()
  if (cv) {
    try {
      found = detectDocument(cv, new Uint8ClampedArray(message.buffer), message.width, message.height)
    } catch {
      found = null
    }
  }
  // The pixels go back with the answer, so the next frame reuses the buffer
  // rather than allocating a fresh one thirty times a second.
  self.postMessage({
    type: 'result', id: message.id, found, notReady: !cv,
    ms: performance.now() - started, buffer: message.buffer
  }, [message.buffer])
}

load()
