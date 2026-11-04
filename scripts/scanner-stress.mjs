// ─── Scanner stress test: random stainless benches ───────────────────────────
// The bench in src/scanner/scenes.js is six hand-made steel scenes, and a
// detector tuned against six pictures can be tuned to those pictures. This
// makes as many as asked, at random — page position, size and angle; how
// light the steel is and how streaked; seams, ceiling-panel reflections and
// glare in random places — and runs each through the real detector and the
// real tracker at camera pace, with fresh sensor noise every frame.
//
//   node scripts/scanner-stress.mjs            # 60 scenes
//   node scripts/scanner-stress.mjs 200 7      # 200 scenes, seed 7
//   node scripts/scanner-stress.mjs 60 1 path/to/other/documentDetect.js
//
// What matters, in order: wrong outlines photographed automatically (must be
// zero — that is a rescan nobody notices until the distributor does), then
// how often the page is photographed by itself, then how often it is found
// at all (an unsure outline still lets a person tap).

import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import { resolve } from 'path'
import { scene, cornerError } from '../src/scanner/scenes.js'

const require = createRequire(import.meta.url)
const cv = require('../public/vendor/opencv-4.13.0.js')
await new Promise(done => { cv.onRuntimeInitialized = done })
const detectorPath = process.argv[4] ? pathToFileURL(resolve(process.argv[4])).href : '../src/scanner/documentDetect.js'
const { detectDocument } = await import(detectorPath)
const { DocumentTracker } = await import('../src/scanner/documentTracker.js')

const COUNT = Number(process.argv[2]) || 60
let seed = Number(process.argv[3]) || 1
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
const between = (a, b) => a + rand() * (b - a)

const W = 240, H = 180, K = W / 320
const TOLERANCE = 10 // px at 320 wide, as the bench

function randomScene(n) {
  // A page somewhere in the frame, 45–75% of its width, perspective-skewed.
  const pw = between(0.45, 0.72) * W, ph = pw * between(1.05, 1.35) * 0.75
  const cx = between(pw / 2 + 6, W - pw / 2 - 6), cy = between(ph / 2 + 6, H - ph / 2 - 6)
  const angle = between(-0.28, 0.28)
  const skew = () => between(-0.06, 0.06) * pw
  const corner = (dx, dy) => ({
    x: cx + dx * Math.cos(angle) - dy * Math.sin(angle) + skew(),
    y: cy + dx * Math.sin(angle) + dy * Math.cos(angle) + skew() * 0.6
  })
  const quad = [corner(-pw / 2, -ph / 2), corner(pw / 2, -ph / 2), corner(pw / 2, ph / 2), corner(-pw / 2, ph / 2)]
  if (quad.some(p => p.x < 2 || p.y < 2 || p.x > W - 3 || p.y > H - 3)) return randomScene(n)

  const base = between(140, 215)
  const metal = {
    base, streak: between(6, 18), gradient: between(10, 50),
    seams: rand() < 0.3 ? [{ y: between(20, 220), grey: between(80, 130), width: 2 }] : [],
    reflections: rand() < 0.35 ? [(() => {
      const x = between(0, 260), y = between(0, 180), w = between(20, 90), h = between(15, 70)
      return { grey: between(240, 255), quad: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] }
    })()] : [],
    glare: rand() < 0.45 ? [{ x: between(0, 320), y: between(0, 240), r: between(35, 80) }] : []
  }
  const paper = between(Math.max(225, base + 8), 242)
  const o = { name: `random ${n}`, quad, paper, bench: base, noise: 3, metal, width: W, height: H }
  return { ...o, image: scene(o), hard: base > 205 || metal.glare.length > 0 }
}

const toRgba = grey => {
  const out = new Uint8ClampedArray(grey.length * 4)
  for (let i = 0; i < grey.length; i++) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = grey[i]; out[i * 4 + 3] = 255 }
  return out
}
function withNoise(grey, amount, s) {
  const out = new Uint8ClampedArray(grey.length)
  for (let i = 0; i < grey.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    out[i] = grey[i] + ((s / 0x7fffffff) - 0.5) * 2 * amount
  }
  return out
}
const right = (corners, quad) => corners && cornerError({ corners }, quad, W, H) / K <= TOLERANCE

let found = 0, accurate = 0, autoRight = 0, autoWrong = 0, waited = 0, ms = 0
const wrongOnes = []
for (let n = 0; n < COUNT; n++) {
  const s = randomScene(n)
  const t0 = performance.now()
  const single = detectDocument(cv, toRgba(s.image), W, H)
  ms += performance.now() - t0
  if (single) found++
  if (single && right(single.corners, s.quad)) accurate++

  const tracker = new DocumentTracker()
  let fired = null
  for (let f = 0; f < 40 && !fired; f++) {
    const view = tracker.update(detectDocument(cv, toRgba(withNoise(s.image, 6, 7 + f)), W, H), f * 66)
    if (view.readyToCapture) fired = view.corners
  }
  if (!fired) waited++
  else if (right(fired, s.quad)) autoRight++
  else { autoWrong++; wrongOnes.push(n) }
  if (process.env.SHOW && Number(process.env.SHOW) === n) {
    const { writeFileSync } = await import('fs')
    const pgm = Buffer.concat([Buffer.from(`P5 ${W} ${H} 255\n`), Buffer.from(s.image)])
    writeFileSync(process.env.SHOW_TO || `scene-${n}.pgm`, pgm)
    const fmt = cs => cs.map(c => `${Math.round(c.x * (c.x <= 1 ? W : 1))},${Math.round(c.y * (c.y <= 1 ? H : 1))}`).join(' ')
    console.log('  scene', n, JSON.stringify(s.metal), 'paper', Math.round(s.paper))
    console.log('  truth ', fmt(s.quad))
    if (fired) console.log('  fired ', fmt(fired))
    const inspect = []
    const d = detectDocument(cv, toRgba(s.image), W, H, { inspect })
    console.log('  single', d && fmt(d.corners), d && { confident: d.confident, weakestSide: d.weakestSide })
    for (const c of inspect) console.log(`   cand[${c.source || 'c'}] ${fmt(c.corners)} sup ${c.edgeSupport.toFixed(2)} weak ${c.weakestSide.toFixed(2)} fill ${c.filledSide.toFixed(2)}`)
  }
}

console.log(`\n  ${COUNT} random stainless scenes (seed ${process.argv[3] || 1})${process.argv[4] ? ` · ${process.argv[4]}` : ''}`)
console.log(`  found ${found} · within ${TOLERANCE}px ${accurate} · ${(ms / COUNT).toFixed(2)} ms/frame`)
console.log(`  photographed by itself, correctly: ${autoRight} · waited for a tap: ${waited} · WRONG: ${autoWrong}`)
if (wrongOnes.length) console.log(`  wrong: scenes ${wrongOnes.join(', ')}`)
console.log('')
if (autoWrong) process.exit(1)
