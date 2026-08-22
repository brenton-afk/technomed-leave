import { describe, it, expect } from 'vitest'
import {
  unitSquareToQuad, rectifiedSize, warpToRect, expandQuad, worthRectifying
} from './rectify.js'
import { scene, formContent } from './scenes.js'

const W = 640, H = 480
// No canvas in Node, so ImageData is just its three fields.
const makeImageData = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })
const rgbaFromGrey = (grey, w, h) => {
  const out = makeImageData(w, h)
  for (let i = 0; i < grey.length; i++) {
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = grey[i]
    out.data[i * 4 + 3] = 255
  }
  return out
}

const rect = (x0, y0, x1, y1) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }
]

describe('the mapping', () => {
  it('sends the unit square to the quad, corner for corner', () => {
    const quad = [{ x: 10, y: 20 }, { x: 210, y: 40 }, { x: 190, y: 300 }, { x: 30, y: 280 }]
    const m = unitSquareToQuad(quad)
    const at = (u, v) => {
      const w = m.g * u + m.h * v + 1
      return { x: (m.a * u + m.b * v + m.c) / w, y: (m.d * u + m.e * v + m.f) / w }
    }
    const corners = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)]
    for (let i = 0; i < 4; i++) {
      expect(corners[i].x).toBeCloseTo(quad[i].x, 4)
      expect(corners[i].y).toBeCloseTo(quad[i].y, 4)
    }
  })

  it('handles a rectangle, where the general form would divide by zero', () => {
    const m = unitSquareToQuad(rect(0, 0, 100, 50))
    expect(m).not.toBeNull()
    expect(m.g).toBe(0)
    expect(m.h).toBe(0)
  })

  it('declines a degenerate quad rather than returning nonsense', () => {
    const collapsed = [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }]
    expect(unitSquareToQuad(collapsed)).toBeNull()
  })
})

describe('output size', () => {
  it('takes the longer of each pair of opposite sides', () => {
    // Under perspective the near edge is longer. Using the shorter one would
    // squeeze the page down to match the far edge and throw away the detail
    // where the photograph is sharpest.
    const wedge = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 200 }, { x: -50, y: 200 }]
    expect(rectifiedSize(wedge, 1e9).width).toBe(200)
  })

  it('caps the long edge', () => {
    const size = rectifiedSize(rect(0, 0, 4000, 2000), 1568)
    expect(Math.max(size.width, size.height)).toBe(1568)
    expect(size.width / size.height).toBeCloseTo(2, 1)
  })

  it('refuses something with no area', () => {
    expect(rectifiedSize(rect(0, 0, 0, 0), 1568)).toBeNull()
  })
})

describe('flattening a page', () => {
  // A page held at an angle, filling much of the frame.
  const skewed = [{ x: 118, y: 52 }, { x: 556, y: 96 }, { x: 604, y: 424 }, { x: 66, y: 388 }]

  it('recovers the form from a skewed photograph of it', () => {
    const paper = 236
    const grey = scene({ width: W, height: H, quad: skewed, paper, bench: 70 })
    const size = rectifiedSize(skewed, 900)
    const out = warpToRect(rgbaFromGrey(grey, W, H), skewed, size, makeImageData)
    expect(out).not.toBeNull()

    // Sample away from the edges, where a pixel of misregistration is expected,
    // and check the flattened page carries the same content as the original.
    let compared = 0, matched = 0
    for (let v = 0.06; v < 0.95; v += 0.035) {
      for (let u = 0.06; u < 0.95; u += 0.035) {
        const expected = formContent(u, v, paper)
        const x = Math.round(u * size.width), y = Math.round(v * size.height)
        const got = out.data[(y * size.width + x) * 4]
        compared++
        // Ink or paper, rather than an exact level: bilinear sampling of a hard
        // edge lands between the two, which is correct and not a mismatch.
        if ((expected > 150) === (got > 150)) matched++
      }
    }
    expect(compared).toBeGreaterThan(400)
    expect(matched / compared).toBeGreaterThan(0.93)
  })

  it('comes out square, so the form is upright rather than skewed', () => {
    // The page's own straight lines should end up axis aligned. The form has
    // full-width horizontal rules, so a row that crosses one should be dark all
    // the way across if the warp worked, and only partly dark if it did not.
    const grey = scene({ width: W, height: H, quad: skewed, paper: 236, bench: 70 })
    const size = rectifiedSize(skewed, 900)
    const out = warpToRect(rgbaFromGrey(grey, W, H), skewed, size, makeImageData)

    let bestRow = 0, darkest = 0
    for (let y = 0; y < size.height; y++) {
      let dark = 0
      for (let x = Math.round(size.width * 0.2); x < size.width * 0.8; x++) {
        if (out.data[(y * size.width + x) * 4] < 120) dark++
      }
      if (dark > darkest) { darkest = dark; bestRow = y }
    }
    const acrossMiddle = Math.round(size.width * 0.6)
    expect(darkest / acrossMiddle).toBeGreaterThan(0.9)
    expect(bestRow).toBeGreaterThan(0)
  })

  it('fills anything outside the photograph with white, not black', () => {
    // A quad reaching past the frame is normal when a page is held close. Black
    // would read as content to whatever looks at the picture next.
    const overhanging = rect(-60, -40, W + 60, H + 40)
    const grey = scene({ width: W, height: H, quad: rect(10, 10, W - 10, H - 10), paper: 236, bench: 70 })
    const size = rectifiedSize(overhanging, 400)
    const out = warpToRect(rgbaFromGrey(grey, W, H), overhanging, size, makeImageData)
    expect(out.data[0]).toBe(255)
    expect(out.data[3]).toBe(255)
  })
})

describe('deciding whether to flatten at all', () => {
  it('accepts a plausible page', () => {
    expect(worthRectifying(rect(40, 30, 280, 210), 320, 240)).toBe(true)
  })

  it('refuses a sliver, so the whole photograph is kept instead', () => {
    expect(worthRectifying(rect(40, 30, 280, 44), 320, 240)).toBe(false)
    expect(worthRectifying(rect(40, 30, 70, 210), 320, 240)).toBe(false)
  })

  it('refuses a fragment too small to be the page', () => {
    expect(worthRectifying(rect(100, 100, 140, 140), 320, 240)).toBe(false)
  })

  it('refuses malformed corners rather than throwing', () => {
    expect(worthRectifying(null, 320, 240)).toBe(false)
    expect(worthRectifying([{ x: 0, y: 0 }], 320, 240)).toBe(false)
    expect(worthRectifying(
      [{ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], 320, 240)).toBe(false)
  })
})

describe('the outward nudge', () => {
  it('grows the quad about its centre', () => {
    const grown = expandQuad(rect(100, 100, 200, 200), 0.1)
    expect(grown[0].x).toBeCloseTo(95, 5)
    expect(grown[0].y).toBeCloseTo(95, 5)
    expect(grown[2].x).toBeCloseTo(205, 5)
  })

  it('leaves a quad alone when asked for nothing', () => {
    const same = expandQuad(rect(10, 20, 30, 40), 0)
    expect(same).toEqual(rect(10, 20, 30, 40))
  })
})
