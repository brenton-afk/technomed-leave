import { describe, it, expect, beforeAll } from 'vitest'
import { createRequire } from 'module'
import { detectDocument } from './documentDetect.js'

// "You still need to be better." — Brent, 3 Nov 2026, with a screenshot: white
// paper on a wooden table, his own shadow across the bottom of the frame, and
// the outline running from the page's top-right to the corner of the picture.
// Rebuilt here on the real engine: the page traced together with the shadow's
// edge made a bigger quad than the page, with one side across bare wood, and
// "biggest" picked it. Within 2px now; it was 77px out.

let cv
beforeAll(async () => {
  const require = createRequire(import.meta.url)
  cv = require('../../public/vendor/opencv-4.13.0.js')
  if (!cv.Mat) await new Promise(resolve => { cv.onRuntimeInitialized = resolve })
}, 60000)

const W = 240, H = 318
const PAGE = [[0.185, 0.19], [0.718, 0.156], [0.842, 0.77], [0.25, 0.82]].map(([x, y]) => [x * W, y * H])

function inside(pts, x, y) {
  let c = false
  for (let i = 0, j = 3; i < 4; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c
  }
  return c
}

function table({ shadow }) {
  const d = new Uint8ClampedArray(W * H * 4)
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const grain = 18 * Math.sin(x * 0.11 + Math.sin(y * 0.03) * 3) + 8 * Math.sin(x * 0.7)
      let r = 120 + grain, g = 82 + grain * 0.7, b = 50 + grain * 0.4
      const onPage = inside(PAGE, x, y)
      if (onPage) {
        r = g = b = 228
        const stroke = Math.abs(Math.sin(x * 0.2) * 20 + 0.45 * H - y) < 1.2
          || (Math.abs(x - 0.6 * W) < 1 && y > 0.5 * H && y < 0.72 * H)
        if (stroke) r = g = b = 40
      }
      let f = 0.9 + 0.2 * x / W
      const inShadow = y > 0.74 * H && (x - 0.45 * W) ** 2 / (0.45 * W) ** 2 + (y - H) ** 2 / (0.3 * H) ** 2 < 1
      if (shadow && inShadow && !onPage) f *= 0.45
      const n = (rnd() - 0.5) * 8
      const i = (y * W + x) * 4
      d[i] = r * f + n; d[i + 1] = g * f + n; d[i + 2] = b * f + n; d[i + 3] = 255
    }
  }
  return d
}

const worstCorner = found => Math.max(...found.corners.map((c, i) =>
  Math.hypot(c.x * W - PAGE[i][0], c.y * H - PAGE[i][1])))

describe('white paper on a wooden table', () => {
  it('is found with no shadow', () => {
    const found = detectDocument(cv, table({ shadow: false }), W, H)
    expect(worstCorner(found)).toBeLessThan(4)
  })

  it('is still the page, not the page and the shadow, with a body shadow across the bottom', () => {
    const found = detectDocument(cv, table({ shadow: true }), W, H)
    expect(found).toBeTruthy()
    expect(worstCorner(found)).toBeLessThan(4)
  })
})
