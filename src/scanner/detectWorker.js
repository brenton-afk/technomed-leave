// ─── Talking to the detection worker ─────────────────────────────────────────
// One worker for the session, like the camera stream: starting the engine
// costs a second or two, and a three-page form should not pay it three times.
//
// One frame in flight at a time. A frame that arrives while the worker is
// busy is simply not sent — the next one will be newer anyway, and a queue
// would only make the outline describe the past.
//
// Anything going wrong — no Worker support, the script failing to load, the
// engine never starting — leaves the caller detecting on the main thread as
// it always has. The worker is an improvement, never a dependency.

let worker = null
let state = 'idle' // idle | loading | ready | failed
let inFlight = null
let nextId = 1
let spare = null
const listeners = new Set()

function setState(next) {
  state = next
  for (const listen of listeners) listen(next)
}

export function detectWorkerState() {
  return state
}

/** Calls back whenever the worker's state changes. Returns an unsubscribe. */
export function onDetectWorkerState(listen) {
  listeners.add(listen)
  return () => listeners.delete(listen)
}

export function startDetectWorker({ deadlineMs = 60000 } = {}) {
  if (worker || state === 'failed') return state
  if (typeof Worker === 'undefined') { setState('failed'); return state }
  try {
    worker = new Worker(new URL('./detect.worker.js', import.meta.url))
  } catch {
    worker = null
    setState('failed')
    return state
  }
  setState('loading')
  const deadline = setTimeout(() => { if (state === 'loading') fail() }, deadlineMs)
  worker.onmessage = event => {
    const message = event.data || {}
    if (message.type === 'ready') { clearTimeout(deadline); setState('ready'); return }
    if (message.type === 'failed') { clearTimeout(deadline); fail(); return }
    if (message.type === 'result' && inFlight && inFlight.id === message.id) {
      spare = message.buffer || null
      const { resolve } = inFlight
      inFlight = null
      resolve({ found: message.found || null, ms: message.ms })
    }
  }
  worker.onerror = () => { clearTimeout(deadline); fail() }
  return state
}

function fail() {
  try { worker?.terminate() } catch { /* gone */ }
  worker = null
  if (inFlight) { inFlight.resolve({ found: null, ms: 0 }); inFlight = null }
  setState('failed')
}

export function detectWorkerBusy() {
  return Boolean(inFlight)
}

/**
 * Sends one frame's pixels. Resolves with { found, ms }, or null if the
 * worker is not ready or already busy (the caller simply skips this frame).
 *
 * @param {CanvasRenderingContext2D} context the detection canvas, already drawn
 * @param {number} width
 * @param {number} height
 */
export function detectInWorker(context, width, height) {
  if (state !== 'ready' || !worker || inFlight) return null
  const bytes = width * height * 4
  let buffer = spare && spare.byteLength === bytes ? spare : new ArrayBuffer(bytes)
  spare = null
  const pixels = context.getImageData(0, 0, width, height).data
  new Uint8ClampedArray(buffer).set(pixels)
  const id = nextId++
  return new Promise(resolve => {
    inFlight = { id, resolve }
    worker.postMessage({ type: 'frame', id, width, height, buffer }, [buffer])
  })
}

/** For tests. */
export function resetDetectWorkerForTests() {
  try { worker?.terminate() } catch { /* gone */ }
  worker = null
  state = 'idle'
  inFlight = null
  spare = null
  listeners.clear()
}
