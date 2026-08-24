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
const { DocumentTracker, maxCornerShift } = await import('../src/scanner/documentTracker.js')

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
// Read off the tracker rather than repeated, so the 'auto' column cannot come to
// mean something different from what the app actually does.
const AUTO_FILL = new DocumentTracker().minFill
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
        `  contrast ${result.contrast.toFixed(2)}${result.fill >= AUTO_FILL ? '  auto' : ''}`
      : '  not found'))
}

console.log(`\n  ${passed}/${cases.length} within ${TOLERANCE}px · ${found} found · ` +
  `mean error ${passed ? (totalError / passed).toFixed(1) : '—'}px · ` +
  `${(totalMs / cases.length).toFixed(2)} ms/frame\n`)

// ─── Steadiness ───────────────────────────────────────────────────────────────
// The complaint was never only accuracy: "the green dynamic frame is still a bit
// sluggish and sloppy, deviates all over the place". Single-frame error cannot
// see any of that — a detector can be accurate on average and still draw an
// outline that will not sit still.
//
// So this runs the real detector over the same scene frame after frame with fresh
// sensor noise on each, and measures how far the *drawn* outline moves between
// consecutive frames. On a genuinely still scene that number should be nearly
// zero; whatever it is, is what the eye sees as dancing.
//
// This is the measurement that found the real fault: the detector was stopping at
// the first Canny threshold that found anything, so on a scene with two candidates
// it returned whichever rung happened to fire first and the outline alternated
// between the two. Single-frame error could not see it, because both answers were
// individually plausible.

function withNoise(grey, amount, seed) {
  // Deterministic, so two runs of the bench are comparable.
  let state = seed
  const out = new Uint8ClampedArray(grey.length)
  for (let i = 0; i < grey.length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    out[i] = grey[i] + ((state / 0x7fffffff) - 0.5) * 2 * amount
  }
  return out
}

const FRAMES = 24

function steadiness(scene) {
  const tracker = new DocumentTracker()
  let worstStep = 0, drawn = null, detections = 0

  for (let n = 0; n < FRAMES; n++) {
    const rgba = toRgba(withNoise(scene.image, 6, n + 1))
    const found = detectDocument(cv, rgba, width, height)
    if (found) detections++
    const view = tracker.update(found, n * 100)
    if (view.corners && drawn && n > 4) {
      worstStep = Math.max(worstStep, maxCornerShift(drawn, view.corners))
    }
    drawn = view.corners
  }
  return { worstStep, detections }
}

// The scenes the detector finds reliably — steadiness on a scene it cannot see at
// all is not a meaningful number.
const steady = cases.filter(scene =>
  cornerError(detectDocument(cv, toRgba(scene.image), width, height),
    scene.quad, width, height) * scale <= TOLERANCE)

console.log(`  Steadiness over ${FRAMES} noisy frames — worst single-frame jump of`)
console.log('  the drawn outline, as a percentage of frame width\n')

let worst = 0
for (const scene of steady) {
  const { worstStep } = steadiness(scene)
  worst = Math.max(worst, worstStep)
  console.log(`  ${scene.name.padEnd(26)}${(worstStep * 100).toFixed(2).padStart(7)}%`)
}

console.log(`\n  worst single-frame jump ${(worst * 100).toFixed(2)}% of frame width\n`)

// Detection runs on every second frame, so it has two frames' budget. This is a
// backstop against an order-of-magnitude regression, not a tight bound.
if (totalMs / cases.length > 8) {
  console.error('  Slower than the frame budget allows.\n')
  process.exit(1)
}

// A drawn outline that jumps more than this between frames is visible dancing:
// 2% of frame width is 8px on a 400px preview.
if (worst > 0.02) {
  console.error(`  The outline is not holding still (${(worst * 100).toFixed(2)}%).\n`)
  process.exit(1)
}
