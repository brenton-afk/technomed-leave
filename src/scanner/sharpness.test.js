import { describe, it, expect } from 'vitest'
import { laplacianVariance, boxOf } from './sharpness.js'

// "The scan was blurry." The burst keeps the sharpest frame, so the measure
// has to rank a crisp page above the same page shaken or out of focus.

function page(width, height, blur = 0) {
  // Text-like: thin dark strokes on white.
  const grey = new Float32Array(width * height).fill(240)
  for (let y = 10; y < height - 10; y += 6) {
    for (let x = 10; x < width - 10; x++) if ((x * 7 + y) % 11 < 6) grey[y * width + x] = 30
  }
  let g = grey
  for (let pass = 0; pass < blur; pass++) {
    const out = new Float32Array(g.length)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let s = 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += g[(y + dy) * width + x + dx]
        out[y * width + x] = s / 9
      }
    }
    g = out
  }
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < g.length; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g[i]; rgba[i * 4 + 3] = 255 }
  return rgba
}

describe('laplacianVariance', () => {
  it('ranks a crisp page above the same page blurred, and blur more strongly below', () => {
    const crisp = laplacianVariance(page(160, 120, 0), 160, 120)
    const soft = laplacianVariance(page(160, 120, 1), 160, 120)
    const mush = laplacianVariance(page(160, 120, 3), 160, 120)
    expect(crisp).toBeGreaterThan(soft * 2)
    expect(soft).toBeGreaterThan(mush)
  })

  it('is zero for a blank frame', () => {
    const blank = new Uint8ClampedArray(80 * 60 * 4).fill(200)
    expect(laplacianVariance(blank, 80, 60)).toBe(0)
  })
})

describe('boxOf', () => {
  it('is the page, inset so the measure stays on the paper', () => {
    const box = boxOf([{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.2 }, { x: 0.9, y: 0.8 }, { x: 0.1, y: 0.8 }])
    expect(box.x0).toBeCloseTo(0.18); expect(box.x1).toBeCloseTo(0.82)
    expect(box.y0).toBeCloseTo(0.26); expect(box.y1).toBeCloseTo(0.74)
  })
})
