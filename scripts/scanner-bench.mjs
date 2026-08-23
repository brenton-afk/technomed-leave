// ─── Scanner benchmark ────────────────────────────────────────────────────────
// Accuracy and speed of the OpenCV document detector, over the synthetic bench in
// src/scanner/scenes.js.
//
//   npm run bench:scanner            # the resolution the app uses
//   npm run bench:scanner -- 640     # any other, to see the trade
//
// Outside the test suite because it needs the 11MB OpenCV build, which is a slow
// thing to load into every test run.
//
// Read the numbers with care. These scenes are piecewise-flat renders with hard
// steps; a camera frame is smooth, blurred and photographically noisy, and Canny
// responds differently to the two. This bench caught real bugs — a page border
// traced as an open ribbon, an outline snapping to a form's header rule — but the
// detector it replaced scored *better* here and was unusable on an actual phone.
// So: useful for catching regressions, not a substitute for holding a form under
// a camera.

import { createRequire } from 'module'
import { benchmark, cornerError } from '../src/scanner/scenes.js'

const require = createRequire(import.meta.url)
const cv = require('../public/vendor/opencv-4.13.0.js')
await new Promise(resolve => { cv.onRuntimeInitialized = resolve })
const { detectDocument } = await import('../src/scanner/documentDetect.js')

/** The scenes are greyscale; the detector takes RGBA, as a frame would be. */
function toRgba(grey) {
  const out = new Uint8ClampedArray(grey.length * 4)
  for (let i = 0; i < grey.length; i++) {
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = grey[i]
    out[i * 4 + 3] = 255
  }
  return out
}

const TOLERANCE = 10 // px at 320 wide, about 3% of the frame
const width = Number(process.argv[2]) || 240
const height = Math.round(width * 0.75)

const cases = benchmark(width, height)
const scale = 320 / width
let passed = 0, found = 0, totalError = 0, totalMs = 0

console.log(`\n  ${width}x${height}, ${cases.length} scenes\n`)

for (const scene of cases) {
  const rgba = toRgba(scene.image)
  // One warm run so the figure is not dominated by first-call compilation.
  detectDocument(cv, rgba, width, height)
  const started = process.hrtime.bigint()
  const result = detectDocument(cv, rgba, width, height)
  totalMs += Number(process.hrtime.bigint() - started) / 1e6

  if (result) found++
  const error = cornerError(result, scene.quad, width, height) * scale
  const ok = error <= TOLERANCE
  if (ok) { passed++; totalError += error }

  const shown = result ? `${error.toFixed(1)}px`.padStart(8) : '   —    '
  console.log(`  ${ok ? '✓' : '✗'} ${scene.name.padEnd(26)}${shown}` +
    (result
      ? `  area ${result.areaFraction.toFixed(2)}  fill ${result.fill.toFixed(2)}` +
        `  contrast ${result.contrast.toFixed(2)}${result.fill >= 0.6 ? '  auto' : ''}`
      : '  not found'))
}

console.log(`\n  ${passed}/${cases.length} within ${TOLERANCE}px · ${found} found · ` +
  `mean error ${passed ? (totalError / passed).toFixed(1) : '—'}px · ` +
  `${(totalMs / cases.length).toFixed(2)} ms/frame\n`)

// Detection runs on every third frame, so it has three frames' budget. This is a
// backstop against an order-of-magnitude regression, not a tight bound.
if (totalMs / cases.length > 12) {
  console.error('  Slower than the frame budget allows.\n')
  process.exit(1)
}
