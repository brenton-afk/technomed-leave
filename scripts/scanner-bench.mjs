// ─── Scanner benchmark ────────────────────────────────────────────────────────
// Accuracy and speed of the document detector, over the synthetic bench in
// src/scanner/scenes.js.
//
//   npm run bench:scanner
//
// This lives outside the test suite on purpose. Timing measured inside jsdom
// swings by a factor of five between runs on the same machine, so an assertion
// there is either so loose it catches nothing or so tight it fails at random.
// The suite keeps a generous ceiling to catch an order-of-magnitude regression;
// the real number comes from here.
//
// Accuracy is not machine-dependent, so those figures are exact.

import { detectDocumentQuad } from '../src/scanner/edgeDetect.js'
import { benchmark, cornerError } from '../src/scanner/scenes.js'

const TOLERANCE = 10 // px at 320 wide, about 3% of the frame
const width = Number(process.argv[2]) || 320
const height = Math.round(width * 0.75)

const cases = benchmark(width, height)
const scale = 320 / width
let passed = 0, found = 0, totalError = 0, totalMs = 0

console.log(`\n  ${width}x${height}, ${cases.length} scenes\n`)

for (const scene of cases) {
  // One warm run so the figure is not dominated by first-call compilation.
  detectDocumentQuad(scene.image, width, height)
  const started = process.hrtime.bigint()
  const result = detectDocumentQuad(scene.image, width, height)
  totalMs += Number(process.hrtime.bigint() - started) / 1e6

  if (result) found++
  const error = cornerError(result, scene.quad, width, height) * scale
  const ok = error <= TOLERANCE
  if (ok) { passed++; totalError += error }

  const shown = result ? `${error.toFixed(1)}px`.padStart(8) : '   —    '
  console.log(`  ${ok ? '✓' : '✗'} ${scene.name.padEnd(26)}${shown}` +
    (result ? `  confidence ${result.confidence.toFixed(2)}` : '  not found'))
}

console.log(`\n  ${passed}/${cases.length} within ${TOLERANCE}px · ${found} found · ` +
  `mean error ${passed ? (totalError / passed).toFixed(1) : '—'}px · ` +
  `${(totalMs / cases.length).toFixed(2)} ms/frame\n`)

// A frame budget at 30fps is 33ms, and the camera preview needs most of it.
if (totalMs / cases.length > 12) {
  console.error('  Slower than the frame budget allows.\n')
  process.exit(1)
}
