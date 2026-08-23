// ─── Loading OpenCV ──────────────────────────────────────────────────────────
// Eleven megabytes, fetched with progress and on a deadline, and never in the
// way of the camera.
//
// The first version of this put a full-screen "Starting the scanner…" over the
// preview and waited for a plain <script> tag. On a hospital connection that is
// most of a minute with nothing moving on screen and no way to take a photograph,
// which is indistinguishable from broken — and it was reported as broken.
//
// So three things changed. The download reports progress, because a number that
// moves is the difference between waiting and being stuck. It has a deadline,
// because a stalled download must not leave the scanner disabled forever. And the
// caller is expected to run without it: the outline is an assistance, the shutter
// is the feature.

const SOURCE = '/vendor/opencv-4.13.0.js'
const DEADLINE_MS = 45000

let pending = null

/** Fetched rather than script-tagged, so the bytes can be counted as they land. */
async function download(onProgress, signal) {
  const response = await fetch(SOURCE, { signal, cache: 'force-cache' })
  if (!response.ok) throw new Error(`engine ${response.status}`)

  const total = Number(response.headers.get('content-length')) || 0
  // No stream and no length still works — it just cannot report a fraction.
  if (!response.body?.getReader) return response.text()

  const reader = response.body.getReader()
  const chunks = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total) onProgress(Math.min(0.99, received / total))
  }
  return new Blob(chunks).text()
}

/**
 * Runs the library and waits for its WASM runtime.
 *
 * `window.cv` exists as soon as the script has run, but its classes do not exist
 * until the WASM finishes compiling — so resolving on the script alone gives a
 * module whose `cv.Mat` is not a constructor. The handler has to be attached
 * before the module is evaluated, which is why `cv` is pre-seeded here rather
 * than read afterwards.
 */
function run(source) {
  return new Promise((resolve, reject) => {
    let settled = false
    const seed = {
      onRuntimeInitialized() {
        if (settled) return
        settled = true
        resolve(window.cv)
      }
    }
    window.cv = seed

    try {
      // Indirect eval, so it runs in global scope as a script tag would and the
      // UMD wrapper finds `window`.
      // eslint-disable-next-line no-eval
      ;(0, eval)(source)
    } catch (err) {
      reject(err)
      return
    }

    // Some builds finish synchronously, in which case the handler above has
    // already fired; others replace the module object wholesale.
    if (!settled && window.cv?.Mat) {
      settled = true
      resolve(window.cv)
    } else if (!settled && window.cv && window.cv !== seed) {
      window.cv.onRuntimeInitialized = () => {
        if (settled) return
        settled = true
        resolve(window.cv)
      }
    }
  })
}

/**
 * @param {(fraction: number) => void} [onProgress] 0..1 as the file arrives
 * @returns {Promise<object>} the initialised cv module
 */
export function loadOpenCv(onProgress = () => {}) {
  if (pending) return pending
  if (openCvReady()) {
    pending = Promise.resolve(window.cv)
    return pending
  }
  if (typeof window === 'undefined') return Promise.reject(new Error('needs a browser'))

  const controller = typeof AbortController === 'function' ? new AbortController() : null
  pending = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller?.abort()
      // Cleared, so a later attempt can try again rather than being handed this
      // failure for the rest of the session.
      pending = null
      reject(new Error('The scanner engine took too long to load'))
    }, DEADLINE_MS)

    download(onProgress, controller?.signal)
      .then(source => { onProgress(1); return run(source) })
      .then(cv => { clearTimeout(timer); resolve(cv) })
      .catch(err => {
        clearTimeout(timer)
        pending = null
        reject(err)
      })
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
}
