// ─── Loading OpenCV ──────────────────────────────────────────────────────────
// Eleven megabytes, on a deadline, and never in the way of the camera.
//
// Loaded with a plain <script src>. A previous version fetched it so it could
// report a percentage — response → chunks → Blob → `.text()` → `eval`, each arrow
// another copy, and a UTF-16 string of an 11MB file is 22MB before anything
// compiles. On a phone already holding a camera stream that was enough to have
// the tab killed, and a killed tab cannot open a camera. A script tag lets the
// browser stream it, compile it off the main thread and cache the compiled form.
//
// ── How this build says it is ready ──
//
// This is where it went wrong twice, so it is worth writing down. The file ends:
//
//     if (typeof Module === 'undefined') Module = {};
//     return cv(Module);
//
// `cv` is a factory, and what it returns — and what therefore lands on
// `window.cv` — is a *thenable*. `window.cv.Mat` is undefined until that thenable
// resolves, and it resolves to the very same object with its classes attached.
//
// So waiting for `window.cv.Mat` waits forever, and seeding
// `window.cv.onRuntimeInitialized` before the script runs is discarded, because
// `root.cv = factory()` overwrites the seeded object. Both were tried. Both
// presented as "Edge detection loading" until the deadline.
//
// Every handshake is therefore attempted, and a poll runs underneath all of them,
// because being wrong about this again costs the whole feature and a poll costs
// one comparison every 150ms.

const SOURCE = '/vendor/opencv-4.13.0.js'
const DEADLINE_MS = 90000
const POLL_MS = 150

let pending = null

/** The module is usable when its classes exist. Nothing else is a reliable signal. */
function usable(candidate) {
  return typeof candidate?.Mat === 'function'
}

export function loadOpenCv() {
  if (pending) return pending
  if (openCvReady()) {
    pending = Promise.resolve(window.cv)
    return pending
  }
  if (typeof document === 'undefined') return Promise.reject(new Error('needs a browser'))

  pending = new Promise((resolve, reject) => {
    let settled = false

    const succeed = module => {
      if (settled || !usable(module)) return
      settled = true
      clearTimeout(deadline)
      clearInterval(poll)

      // `then` has to go before this module is resolved with, and this is not a
      // tidy-up — it is the difference between working and hanging.
      //
      // Resolving a promise with a thenable makes the Promise machinery adopt it:
      // it calls `then` and waits for *that* to settle. This module's `then`
      // hands back the module itself, which is a thenable, which is adopted
      // again. The outer promise never settles, and the scanner reports "Edge
      // detection loading" for ever having in fact loaded perfectly.
      if (typeof module.then === 'function') {
        try { delete module.then } catch { module.then = undefined }
      }

      // Left on the global as the module rather than the thenable, so a second
      // call and `openCvReady` both see something usable.
      window.cv = module
      resolve(module)
    }

    const fail = message => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      clearInterval(poll)
      // Cleared so a later attempt retries rather than being handed this failure
      // for the rest of the session — walking into better signal should work.
      pending = null
      reject(new Error(message))
    }

    const deadline = setTimeout(() => fail('The scanner engine took too long to load'), DEADLINE_MS)
    // Underneath every handshake below. Cheap, and it does not care which one
    // this build happens to use.
    const poll = setInterval(() => { if (usable(window.cv)) succeed(window.cv) }, POLL_MS)

    const script = document.createElement('script')
    script.async = true
    script.src = SOURCE
    script.dataset.opencv = 'true'

    script.addEventListener('load', () => {
      const exported = window.cv

      // 1. Already built — some builds finish while the script runs.
      if (usable(exported)) { succeed(exported); return }

      // 2. A thenable, which is what this build gives. It resolves to itself with
      //    the classes attached.
      if (typeof exported?.then === 'function') {
        exported.then(succeed, () => fail('The scanner engine failed to start'))
      }

      // 3. The older emscripten callback, in case a future build reverts to it.
      if (exported && typeof exported === 'object') {
        exported.onRuntimeInitialized = () => succeed(window.cv)
      }
      // Otherwise the poll above is what finishes this.
    })

    script.addEventListener('error', () => fail('Could not load the scanner engine'))
    document.head.appendChild(script)
  })
  return pending
}

/** Whether it is already in memory, so no wait is shown. */
export function openCvReady() {
  return typeof window !== 'undefined' && usable(window.cv)
}

/** For tests: forget the cached attempt. */
export function resetOpenCvForTests() {
  pending = null
  if (typeof window !== 'undefined') delete window.cv
  if (typeof document !== 'undefined') {
    for (const script of document.querySelectorAll('script[data-opencv]')) script.remove()
  }
}
