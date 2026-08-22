import { describe, it, expect } from 'vitest'
import {
  detectDocumentQuad, otsuThreshold, largestBrightBlob, extremeCorners,
  smoothQuad, toGrayscale
} from './edgeDetect.js'

const W = 160, H = 120

// A synthetic scene: a light page on a dark bench.
function scene({ bg = 40, fg = 210, quad, noise = 0 } = {}) {
  const gray = new Uint8Array(W * H).fill(bg)
  if (quad) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (pointInQuad(x, y, quad)) gray[y * W + x] = fg
      }
    }
  }
  if (noise) {
    // Deterministic pseudo-noise, so the test cannot flake.
    for (let i = 0; i < gray.length; i++) {
      const n = ((i * 2654435761) % 512 - 256) / 256 * noise
      gray[i] = Math.max(0, Math.min(255, gray[i] + n))
    }
  }
  return gray
}

function rect(x0, y0, x1, y1) {
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
}

function pointInQuad(px, py, quad) {
  let inside = false
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const xi = quad[i].x, yi = quad[i].y, xj = quad[j].x, yj = quad[j].y
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}

const px = (corner) => ({ x: Math.round(corner.x * W), y: Math.round(corner.y * H) })

describe('otsuThreshold', () => {
  it('splits a two-tone image between its tones', () => {
    const gray = scene({ bg: 30, fg: 220, quad: rect(20, 20, 140, 100) })
    const t = otsuThreshold(gray)
    // "> t" is the page, so landing on the background value is a correct split.
    expect(t).toBeGreaterThanOrEqual(30)
    expect(t).toBeLessThan(220)
  })

  it('adapts to a dim scene rather than using a fixed cut-off', () => {
    const dim = scene({ bg: 20, fg: 90, quad: rect(20, 20, 140, 100) })
    const bright = scene({ bg: 150, fg: 250, quad: rect(20, 20, 140, 100) })
    expect(otsuThreshold(dim)).toBeLessThan(otsuThreshold(bright))
  })
})

describe('largestBrightBlob', () => {
  it('picks the biggest bright region and ignores smaller ones', () => {
    const gray = scene({ quad: rect(10, 10, 120, 100) })
    // A small bright sticker elsewhere.
    for (let y = 105; y < 115; y++) for (let x = 140; x < 155; x++) gray[y * W + x] = 230

    const blob = largestBrightBlob(gray, W, H, otsuThreshold(gray))
    expect(blob).not.toBeNull()
    const corners = extremeCorners(blob.label, blob.id, W, H, blob.size)
    // The sticker is outside the page, so it must not stretch the corners.
    expect(Math.max(...corners.map(c => c.x))).toBeLessThan(130)
  })

  it('returns null when nothing is above the threshold', () => {
    const flat = new Uint8Array(W * H).fill(10)
    expect(largestBrightBlob(flat, W, H, 250)).toBeNull()
  })
})

describe('detectDocumentQuad', () => {
  it('finds an axis-aligned page and reports its corners', () => {
    const gray = scene({ quad: rect(20, 15, 140, 105) })
    const found = detectDocumentQuad(gray, W, H)
    expect(found).not.toBeNull()

    const [tl, tr, br, bl] = found.corners.map(px)
    expect(tl.x).toBeCloseTo(20, -1); expect(tl.y).toBeCloseTo(15, -1)
    expect(br.x).toBeCloseTo(139, -1); expect(br.y).toBeCloseTo(104, -1)
    expect(tr.x).toBeGreaterThan(tl.x)
    expect(bl.y).toBeGreaterThan(tl.y)
  })

  it('returns corners in TL, TR, BR, BL order', () => {
    const found = detectDocumentQuad(scene({ quad: rect(30, 20, 130, 100) }), W, H)
    const [tl, tr, br, bl] = found.corners
    expect(tl.x).toBeLessThan(tr.x)
    expect(br.x).toBeGreaterThan(bl.x)
    expect(tl.y).toBeLessThan(bl.y)
    expect(tr.y).toBeLessThan(br.y)
  })

  it('tracks a rotated page, which a bounding box could not', () => {
    // A diamond — every corner sits mid-edge of its bounding box.
    const quad = [{ x: 80, y: 12 }, { x: 148, y: 60 }, { x: 80, y: 108 }, { x: 12, y: 60 }]
    const found = detectDocumentQuad(scene({ quad }), W, H)
    expect(found).not.toBeNull()
    const corners = found.corners.map(px)
    // The topmost corner is near the horizontal centre, not at a box corner.
    const top = corners.reduce((a, c) => (c.y < a.y ? c : a))
    expect(top.x).toBeGreaterThan(55)
    expect(top.x).toBeLessThan(105)
  })

  it('follows the page as it moves across the frame', () => {
    const left = detectDocumentQuad(scene({ quad: rect(10, 20, 70, 100) }), W, H)
    const right = detectDocumentQuad(scene({ quad: rect(85, 20, 145, 100) }), W, H)
    expect(left.corners[0].x).toBeLessThan(right.corners[0].x)
    // Same page size, so a similar area either side.
    expect(Math.abs(left.areaFraction - right.areaFraction)).toBeLessThan(0.05)
  })

  it('survives sensor noise', () => {
    const found = detectDocumentQuad(scene({ quad: rect(20, 15, 140, 105), noise: 22 }), W, H)
    expect(found).not.toBeNull()
    expect(px(found.corners[0]).x).toBeCloseTo(20, -1)
  })

  // ── Cases where it must decline rather than guess ──────────────────────────

  it('declines a flat surface with no contrast', () => {
    expect(detectDocumentQuad(new Uint8Array(W * H).fill(128), W, H)).toBeNull()
    expect(detectDocumentQuad(scene({ bg: 120, fg: 132, quad: rect(20, 20, 140, 100) }), W, H)).toBeNull()
  })

  it('declines something too small to be a page', () => {
    expect(detectDocumentQuad(scene({ quad: rect(70, 55, 90, 70) }), W, H)).toBeNull()
  })

  it('declines a frame that is entirely bright', () => {
    expect(detectDocumentQuad(scene({ quad: rect(0, 0, W, H) }), W, H)).toBeNull()
  })

  it('declines an irregular shape that is not paper', () => {
    // A cross fills its own quad poorly, so the fill check rejects it.
    const gray = new Uint8Array(W * H).fill(40)
    for (let y = 50; y < 70; y++) for (let x = 15; x < 145; x++) gray[y * W + x] = 210
    for (let y = 15; y < 105; y++) for (let x = 70; x < 90; x++) gray[y * W + x] = 210
    expect(detectDocumentQuad(gray, W, H)).toBeNull()
  })

  it('declines a wedge, which cannot be a rectangle seen at an angle', () => {
    const wedge = [{ x: 20, y: 20 }, { x: 140, y: 20 }, { x: 90, y: 100 }, { x: 85, y: 100 }]
    expect(detectDocumentQuad(scene({ quad: wedge }), W, H)).toBeNull()
  })

  it('handles an empty or malformed frame without throwing', () => {
    expect(detectDocumentQuad(null, W, H)).toBeNull()
    expect(detectDocumentQuad(new Uint8Array(0), 0, 0)).toBeNull()
  })

  it('reports higher confidence for a clean rectangle than a skewed one', () => {
    const clean = detectDocumentQuad(scene({ quad: rect(20, 15, 140, 105) }), W, H)
    const skewed = detectDocumentQuad(scene({
      quad: [{ x: 25, y: 20 }, { x: 138, y: 34 }, { x: 130, y: 100 }, { x: 18, y: 84 }]
    }), W, H)
    expect(clean.confidence).toBeGreaterThan(0)
    if (skewed) expect(clean.confidence).toBeGreaterThanOrEqual(skewed.confidence)
  })
})

describe('smoothQuad', () => {
  it('eases toward the new position instead of snapping', () => {
    const a = { corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }
    const b = { corners: [{ x: 0.2, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }
    const smoothed = smoothQuad(a, b, 0.5)
    expect(smoothed.corners[0].x).toBeCloseTo(0.1, 5)
  })

  it('adopts the first detection outright', () => {
    const b = { corners: [{ x: 0.2, y: 0.2 }] }
    expect(smoothQuad(null, b)).toBe(b)
  })

  it('drops the frame when detection is lost', () => {
    expect(smoothQuad({ corners: [] }, null)).toBeNull()
  })

  it('converges on a still page', () => {
    const target = { corners: [{ x: 0.5, y: 0.5 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }
    let current = { corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }
    for (let i = 0; i < 40; i++) current = smoothQuad(current, target, 0.35)
    expect(current.corners[0].x).toBeCloseTo(0.5, 3)
  })
})

describe('toGrayscale', () => {
  it('converts RGBA to one luminance byte per pixel', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])
    const gray = toGrayscale(rgba, 2, 1)
    expect(gray).toHaveLength(2)
    expect(gray[0]).toBeGreaterThan(240)
    expect(gray[1]).toBe(0)
  })

  it('weights green most, per Rec. 601', () => {
    const green = toGrayscale(new Uint8ClampedArray([0, 255, 0, 255]), 1, 1)[0]
    const red = toGrayscale(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1)[0]
    const blue = toGrayscale(new Uint8ClampedArray([0, 0, 255, 255]), 1, 1)[0]
    expect(green).toBeGreaterThan(red)
    expect(red).toBeGreaterThan(blue)
  })
})
