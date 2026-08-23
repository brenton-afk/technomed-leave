// ─── Does the engine actually report ready? ───────────────────────────────────
//
//   npm run check:engine
//
// The one check that would have caught the bug that broke the scanner twice, and
// the one no mock could: it runs the real 11MB OpenCV build through the real
// handshake in a real DOM.
//
// What went wrong, twice, and why a mock could not see it. The file ends
//
//     if (typeof Module === 'undefined') Module = {};
//     return cv(Module);
//
// so what lands on `window.cv` is a *thenable* whose `.Mat` does not exist yet,
// and which resolves to itself. Waiting for `.Mat` waits for ever. Seeding
// `onRuntimeInitialized` is discarded, because the UMD wrapper overwrites the
// object. And resolving a promise *with* that module makes the Promise machinery
// adopt it — calling `then`, which hands back a thenable, which is adopted again —
// so the promise never settles even though the engine loaded perfectly. Each of
// those presented identically on the phone: "Edge detection loading", for ever.
//
// This is deliberately not a unit test. An emscripten bundle inside vitest's
// module environment fights the harness, and the check that matters most should
// not be the flaky one.

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(join(process.cwd(), 'package.json'))
const { JSDOM } = require('jsdom')

const FILE = join(process.cwd(), 'public/vendor/opencv-4.13.0.js')
if (!existsSync(FILE)) {
  console.error(`\n  Missing ${FILE}\n`)
  process.exit(1)
}

const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>',
  { runScripts: 'outside-only' })

const usable = candidate => typeof candidate?.Mat === 'function'
const started = Date.now()

const ready = new Promise((resolve, reject) => {
  let settled = false
  const succeed = module => {
    if (settled || !usable(module)) return
    settled = true
    clearInterval(poll)
    clearTimeout(deadline)
    if (typeof module.then === 'function') {
      try { delete module.then } catch { module.then = undefined }
    }
    window.cv = module
    resolve(module)
  }
  const poll = setInterval(() => { if (usable(window.cv)) succeed(window.cv) }, 150)
  const deadline = setTimeout(() => {
    clearInterval(poll)
    reject(new Error('never reported ready'))
  }, 120000)

  // Stands in for <script src>, and nothing else.
  window.eval(readFileSync(FILE, 'utf8'))

  const exported = window.cv
  console.log(`\n  after the script : typeof window.cv = ${typeof exported}` +
    `, .then = ${typeof exported?.then}, .Mat = ${typeof exported?.Mat}`)

  if (usable(exported)) { succeed(exported); return }
  if (typeof exported?.then === 'function') {
    exported.then(succeed, () => reject(new Error('the engine failed to start')))
  }
  if (exported && typeof exported === 'object') {
    exported.onRuntimeInitialized = () => succeed(window.cv)
  }
})

try {
  const cv = await ready
  console.log(`  reported ready   : after ${Date.now() - started}ms`)
  console.log(`  then stripped    : ${typeof cv.then}`)

  // Present is not the same as usable.
  const mat = new cv.Mat(3, 3, cv.CV_8UC1)
  const grey = new cv.Mat()
  cv.cvtColor(new cv.Mat(4, 4, cv.CV_8UC4), grey, cv.COLOR_RGBA2GRAY)
  console.log(`  Mat and cvtColor : ${mat.rows}x${mat.cols}, greyscale ${grey.rows}x${grey.cols}`)
  mat.delete(); grey.delete()
  console.log('\n  The engine reports ready and works.\n')
  process.exit(0)
} catch (err) {
  console.error(`\n  FAILED: ${err.message}\n`)
  process.exit(1)
}
