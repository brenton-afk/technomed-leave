import { describe, it, expect, beforeAll } from 'vitest'
import { createRequire } from 'module'
import { enhanceDocument, stretchContrast } from './flatten.js'

// "The scan was blurry" — in the PDF the distributor and Dropbox receive.
// Forms are shot on stainless steel under theatre lights: paper grey at one
// end, white at the other, glare in between. Run on the real engine, because
// a mock cannot tell whether the lighting was actually divided out.

let cv
beforeAll(async () => {
  const require = createRequire(import.meta.url)
  cv = require('../../public/vendor/opencv-4.13.0.js')
  if (!cv.Mat) await new Promise(resolve => { cv.onRuntimeInitialized = resolve })
}, 60000)

function shadedPage(W = 400, H = 520) {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const light = 0.5 + 0.45 * (x / W) * (1 - y / H)
      const ink = y % 20 > 8 && y % 20 < 13 && x > 30 && x < W - 30 && (x % 13) < 8
      const blue = ink && Math.floor(y / 20) % 5 === 2
      const v = (ink ? 40 : 245) * light
      const i = (y * W + x) * 4
      data[i] = blue ? v * 0.4 : v
      data[i + 1] = blue ? v * 0.5 : v
      data[i + 2] = blue ? Math.min(255, v * 2.5 + 60) : v
      data[i + 3] = 255
    }
  }
  return { data, width: W, height: H }
}

describe('enhanceDocument', () => {
  it('evens out the lighting: dim and bright paper both come out white, ink stays dark', () => {
    const page = shadedPage()
    const mat = cv.matFromImageData(page)
    const at = (m, x, y) => m.data[(y * page.width + x) * 4]
    const dimBefore = at({ data: page.data }, 10, 510)
    expect(dimBefore).toBeLessThan(140)
    enhanceDocument(cv, mat)
    expect(at(mat, 10, 510)).toBeGreaterThan(235)
    expect(at(mat, 390, 5)).toBeGreaterThan(235)
    // An ink stroke in the dim corner.
    expect(at(mat, 32, 500 + 10)).toBeLessThan(90)
    mat.delete()
  })

  it('keeps blue pen blue', () => {
    const page = shadedPage()
    const mat = cv.matFromImageData(page)
    enhanceDocument(cv, mat)
    // A stroke on a blue row (row 2 of each five), in the bright part of the page.
    const y = 2 * 20 + 10, x = 300 + 1
    const i = (y * page.width + x) * 4
    expect(mat.data[i + 2]).toBeGreaterThan(mat.data[i] + 40)
    mat.delete()
  })

  it('leaves a dark photograph alone rather than blowing out its noise', () => {
    const W = 120, H = 160
    const data = new Uint8ClampedArray(W * H * 4).map((_, i) => (i % 4 === 3 ? 255 : 30 + (i % 7)))
    const mat = cv.matFromImageData({ data, width: W, height: H })
    enhanceDocument(cv, mat)
    expect(mat.data[(80 * W + 60) * 4]).toBeLessThan(120)
    mat.delete()
  })
})

describe('stretchContrast', () => {
  it('never lifts the darkest ink back up into grey', () => {
    // Thin dark strokes are darker than the blurred black point. The old
    // operation took an absolute value, so they went negative and came back
    // grey — fine print washed out on every scan.
    const W = 200, H = 200
    const data = new Uint8ClampedArray(W * H * 4)
    for (let i = 0; i < W * H; i++) {
      const x = i % W
      const v = x % 10 === 0 ? 5 : 180
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v
      data[i * 4 + 3] = 255
    }
    const mat = cv.matFromImageData({ data, width: W, height: H })
    stretchContrast(cv, mat, m => m)
    expect(mat.data[(100 * W + 50) * 4]).toBeLessThanOrEqual(5)
    mat.delete()
  })
})
