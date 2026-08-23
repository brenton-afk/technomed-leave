// ─── Loading OpenCV ──────────────────────────────────────────────────────────
// Eleven megabytes, on a deadline, and never in the way of the camera.
//
// Loaded with a plain <script src>, and that is a deliberate step *backwards*
// from the version before it. That one fetched the file so it could report a
// percentage: response → chunks → Blob → `.text()` → `eval`. Each of those is
// another copy, and a UTF-16 string of an 11MB file is 22MB before the engine
// compiles anything. On a phone already holding a live camera stream that is
// enough to have the tab killed, and a killed tab cannot open a camera — which
// is how a progress bar turned into "the scanner can't even open the camera".
//
// A script tag hands the file to the browser instead, which streams it, compiles
// it off the main thread and caches the compiled form. No percentage, which is a
// real loss. Worth it.

const SOURCE = '/vendor/opencv-4.13.0.js'
const DEADLINE_MS = 60000

let pending = null

/**
 * @returns {Promise<object>} the initialised cv module
 */
export function loadOpenCv() {
  if (pending) return pending
  if (openCvReady()) {
    pending = Promise.resolve(window.cv)
    return pending
  }
  if (typeof document === 'undefined') return Promise.reject(new Error('needs a browser'))

  pending = new Promise((resolve, reject) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(window.cv)
    }
    const fail = message => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Cleared so a later attempt retries rather than being handed this failure
      // for the rest of the session — walking into better signal should work.
      pending = null
      reject(new Error(message))
    }

    const timer = setTimeout(() => fail('The scanner engine took too long to load'), DEADLINE_MS)

    // Seeded *before* the script runs, because the library begins with
    // `var Module = typeof cv !== "undefined" ? cv : {}` — it adopts whatever is
    // already there. Attaching the handler afterwards is a race with WASM
    // compilation, and losing it means waiting forever for a callback that has
    // already fired.
    window.cv = { onRuntimeInitialized: finish }

    const script = document.createElement('script')
    script.async = true
    script.src = SOURCE
    script.dataset.opencv = 'true'
    script.addEventListener('load', () => {
      // Some builds are ready the moment the script has run; most are not, and
      // for those the seeded handler above is what resolves this.
      if (typeof window.cv?.Mat === 'function') finish()
    })
    script.addEventListener('error', () => fail('Could not load the scanner engine'))
    document.head.appendChild(script)
  })
  return pending
}

/** Whether it is already in memory, so no wait is shown. */
export function openCvReady() {
  return typeof window !== 'undefined' && typeof window.cv?.Mat === 'function'
}

/** For tests: forget the cached attempt. */
export function resetOpenCvForTests() {
  pending = null
  if (typeof window !== 'undefined') delete window.cv
  if (typeof document !== 'undefined') {
    for (const script of document.querySelectorAll('script[data-opencv]')) script.remove()
  }
}
