import { createRequire } from 'module'
import { benchmark, cornerError } from '../src/scanner/scenes.js'
const require = createRequire(import.meta.url)
const cv = require('../public/vendor/opencv-4.13.0.js')
await new Promise(r => { cv.onRuntimeInitialized = r })
const { detectDocument } = await import('../src/scanner/documentDetect.js')
const W = 240, H = 180
const rgba = g => { const o = new Uint8ClampedArray(g.length * 4); for (let i = 0; i < g.length; i++) { o[i*4]=o[i*4+1]=o[i*4+2]=g[i]; o[i*4+3]=255 } return o }
const noise = (g, a, seed) => { let s = seed; const o = new Uint8ClampedArray(g.length); for (let i = 0; i < g.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; o[i] = g[i] + ((s / 0x7fffffff) - .5) * 2 * a } return o }
for (const s of benchmark(W, H)) {
  const rows = []
  for (let n = 0; n < 8; n++) {
    const inspect = []
    const r = detectDocument(cv, rgba(n ? noise(s.image, 6, n) : s.image), W, H, { inspect })
    if (!r) { rows.push('—'); continue }
    const err = cornerError(r, s.quad, W, H) * 320 / W
    const key = r.corners.map(c => `${Math.round(c.x*W)},${Math.round(c.y*H)}`).join(' ')
    const c = inspect.find(c => c.corners.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ') === key)
    rows.push(`${err <= 10 ? 'ok' : 'BAD'}:${c ? c.weakestSide.toFixed(2) + '/' + c.filledSide.toFixed(2) : '?'}`)
  }
  console.log(s.name.padEnd(34), rows.join(' '))
}
