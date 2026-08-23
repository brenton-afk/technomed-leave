// ─── Loading OpenCV ──────────────────────────────────────────────────────────
// The build is served from this origin rather than a CDN. docs.opencv.org is
// documentation hosting, not infrastructure with an availability promise, and a
// scanner that stops working because someone else's docs site is down is not a
// scanner. It also means the file is subject to our own cache headers.
//
// Eleven megabytes, once. The browser caches it by URL, and the promise below
// caches it within the session, so opening the scanner a second time costs
// nothing. First use on hospital wifi is a real wait, which is why the caller
// gets a state to show rather than a frozen screen.

// The version is in the filename so the file can be cached for a year and never
// fetched twice. An upgrade becomes a different URL rather than a cache to bust.
const SOURCE = '/vendor/opencv-4.13.0.js'

let pending = null

/** @returns {Promise<object>} the initialised cv module */
export function loadOpenCv() {
  if (pending) return pending
  if (typeof window !== 'undefined' && window.cv?.Mat) {
    pending = Promise.resolve(window.cv)
    return pending
  }

  pending = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('OpenCV needs a browser'))
      return
    }

    const existing = document.querySelector(`script[data-opencv]`)
    const script = existing || document.createElement('script')

    const ready = () => {
      const cv = window.cv
      if (!cv) { reject(new Error('OpenCV loaded but did not register')); return }
      // The WASM build finishes asynchronously after the script itself runs, so
      // the module exists before it is usable. Waiting on the wrong one of those
      // is the classic way to get "cv.Mat is not a constructor".
      if (cv.Mat) { resolve(cv); return }
      cv.onRuntimeInitialized = () => resolve(cv)
    }

    script.addEventListener('load', ready)
    script.addEventListener('error', () => {
      // Cleared so a later attempt can retry rather than being handed this
      // failure forever.
      pending = null
      reject(new Error('Could not load the scanner engine'))
    })

    if (!existing) {
      script.dataset.opencv = 'true'
      script.async = true
      script.src = SOURCE
      document.head.appendChild(script)
    } else if (window.cv) {
      ready()
    }
  })
  return pending
}

/** Whether it is already in memory, so the caller knows not to show a wait. */
export function openCvReady() {
  return typeof window !== 'undefined' && Boolean(window.cv?.Mat)
}

/** For tests: forget the cached attempt. */
export function resetOpenCvForTests() {
  pending = null
}
