import { describe, it, expect } from 'vitest'
import {
  detectDocumentQuad, toGrayscale, blur3, gradients,
  dominantOrientations, edgeField, candidateLines, groupByDirection, intersect,
  QuadTracker, maxCornerDistance
} from './edgeDetect.js'
import { benchmark, cornerError } from './scenes.js'

// The same size the app runs detection at, and not incidentally: the detector
// measures across a border over bands a few pixels wide, so its calibration is
// in pixels. Testing at another size tests something that never ships.
const W = 320, H = 240
// Scenes below were written for a 240-wide frame.
const K = W / 240

// Synthetic scenes. The important ones are the surfaces the old brightness-blob
// detector could not see: a page no lighter than what it sits on.
function scene({ bg = 45, fg = 210, quad, noise = 0, gradient = 0, seed = 0 } = {}) {
  const g = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = bg + (gradient ? gradient * (x / W) : 0)
      if (quad && inQuad(x, y, quad)) v = fg + (gradient ? gradient * (x / W) : 0)
      // `seed` varies the pattern between frames, which is what real sensor noise
      // does and what the tracker relies on to refuse a spurious outline.
      if (noise) v += ((x * 7919 + y * 104729 + seed * 15485863) % 512 - 256) / 256 * noise
      g[y * W + x] = Math.max(0, Math.min(255, v))
    }
  }
  return g
}

function inQuad(px, py, q) {
  let inside = false
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const xi = q[i].x, yi = q[i].y, xj = q[j].x, yj = q[j].y
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}

const rect = (x0, y0, x1, y1) => [
  { x: x0 * K, y: y0 * K }, { x: x1 * K, y: y0 * K },
  { x: x1 * K, y: y1 * K }, { x: x0 * K, y: y1 * K }
]
const PAGE = rect(40, 25, 205, 155)
const px = c => ({ x: Math.round(c.x * W), y: Math.round(c.y * H) })

function expectNearPage(found, tolerance = 12 * K) {
  expect(found).not.toBeNull()
  const [tl, , br] = found.corners.map(px)
  expect(Math.abs(tl.x - 40 * K)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(tl.y - 25 * K)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(br.x - 205 * K)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(br.y - 155 * K)).toBeLessThanOrEqual(tolerance)
}

describe('finds a page on any surface', () => {
  // Each of these except the first was invisible to the brightness-blob
  // approach, which assumed paper is lighter than the bench.
  it('light page on a dark bench', () => {
    expectNearPage(detectDocumentQuad(scene({ bg: 45, fg: 210, quad: PAGE }), W, H))
  })

  it('light page on a LIGHT bench', () => {
    expectNearPage(detectDocumentQuad(scene({ bg: 225, fg: 196, quad: PAGE }), W, H))
  })

  it('dark page on a light bench', () => {
    expectNearPage(detectDocumentQuad(scene({ bg: 215, fg: 120, quad: PAGE }), W, H))
  })

  it('barely-there contrast — 12 levels', () => {
    expectNearPage(detectDocumentQuad(scene({ bg: 150, fg: 162, quad: PAGE }), W, H))
  })

  it('uneven lighting across the frame', () => {
    // A bright window on one side used to dominate the whole frame; local
    // contrast normalisation is what keeps the dim half competitive.
    expectNearPage(detectDocumentQuad(scene({ bg: 60, fg: 200, quad: PAGE, gradient: 70 }), W, H))
  })

  it('a noisy sensor in low light', () => {
    // Ten percent noise on a sheet with nothing printed on it. Above this a
    // single frame can be wrong — see the lock test below, which is the property
    // that matters in live video. The exact level is not a clean threshold: this
    // pattern is deterministic, so a given amount either happens to line up into
    // a false edge or does not.
    expectNearPage(detectDocumentQuad(scene({ bg: 50, fg: 205, quad: PAGE, noise: 10 }), W, H), 16)
  })

  it('will not lock onto an outline that noise invented', () => {
    // At around ten percent noise on a *blank* sheet — no print to anchor to —
    // the outline is no longer reliable: enough noise pixels line up to put a
    // spurious edge just outside the real one, and since the page border is the
    // outermost real boundary, that spurious edge wins. This is a real limit and
    // it is worse than the blob detector this replaced, which is a trade made
    // knowingly: a blank sheet is not what this scans, and on an actual printed
    // form the same noise is nothing next to the print.
    //
    // What protects the user is that noise does not repeat. A wrong outline moves
    // every frame, so it never earns the lock, and the frame stays open and pale
    // instead of closing confidently around the wrong thing.
    const tracker = new QuadTracker()
    let locked = false
    for (let frame = 0; frame < 12; frame++) {
      const image = scene({ bg: 50, fg: 205, quad: PAGE, noise: 26, seed: frame })
      const view = tracker.update(detectDocumentQuad(image, W, H))
      if (view?.locked) locked = true
    }
    expect(locked).toBe(false)
  })
})

describe('finds a page at any angle', () => {
  it('rotated', () => {
    const quad = [{ x: 60, y: 22 }, { x: 215, y: 66 }, { x: 186, y: 158 }, { x: 32, y: 114 }]
    const found = detectDocumentQuad(scene({ quad }), W, H)
    expect(found).not.toBeNull()
    // The top-left corner tracks the rotation rather than snapping to a box.
    const tl = px(found.corners[0])
    expect(tl.x).toBeGreaterThan(40)
    expect(tl.y).toBeLessThan(45)
  })

  it('under perspective skew', () => {
    const quad = [{ x: 52, y: 38 }, { x: 200, y: 22 }, { x: 214, y: 150 }, { x: 38, y: 132 }]
    const found = detectDocumentQuad(scene({ quad }), W, H)
    expect(found).not.toBeNull()
    expect(found.confidence).toBeGreaterThan(0.3)
  })

  it('returns corners ordered TL, TR, BR, BL', () => {
    const [tl, tr, br, bl] = detectDocumentQuad(scene({ quad: PAGE }), W, H).corners
    expect(tl.x).toBeLessThan(tr.x)
    expect(bl.x).toBeLessThan(br.x)
    expect(tl.y).toBeLessThan(bl.y)
    expect(tr.y).toBeLessThan(br.y)
  })

  it('follows the page as it moves', () => {
    const left = detectDocumentQuad(scene({ quad: rect(20, 30, 110, 150) }), W, H)
    const right = detectDocumentQuad(scene({ quad: rect(130, 30, 220, 150) }), W, H)
    expect(left.corners[0].x).toBeLessThan(right.corners[0].x)
  })
})

describe('declines rather than guessing', () => {
  it('a flat surface with nothing on it', () => {
    expect(detectDocumentQuad(new Uint8Array(W * H).fill(128), W, H)).toBeNull()
  })

  it('pure noise', () => {
    const noise = new Uint8Array(W * H)
    for (let i = 0; i < noise.length; i++) noise[i] = 100 + ((i * 7919) % 60)
    expect(detectDocumentQuad(noise, W, H)).toBeNull()
  })

  it('a single strong edge, such as the edge of a bench', () => {
    const g = new Uint8Array(W * H).fill(60)
    for (let y = 0; y < H; y++) for (let x = 120; x < W; x++) g[y * W + x] = 200
    expect(detectDocumentQuad(g, W, H)).toBeNull()
  })

  it('something far too small to be a page', () => {
    const g = new Uint8Array(W * H).fill(50)
    for (let y = 85; y < 95; y++) for (let x = 115; x < 130; x++) g[y * W + x] = 210
    expect(detectDocumentQuad(g, W, H)).toBeNull()
  })

  it('malformed input, without throwing', () => {
    expect(detectDocumentQuad(null, W, H)).toBeNull()
    expect(detectDocumentQuad(new Uint8Array(0), 0, 0)).toBeNull()
    expect(detectDocumentQuad(new Uint8Array(10), W, H)).toBeNull()
  })
})

describe('fast enough to run at 30fps', () => {
  // Both timing checks here are deliberately loose, and neither is the real
  // measurement. Inside jsdom, on a machine also running the rest of the suite,
  // the same detector measures anywhere from 8ms to 45ms a frame — so a bound
  // tight enough to mean anything fails at random, and a suite that cries wolf
  // gets ignored. `npm run bench:scanner` measures it properly and holds the
  // frame budget; these two catch an order-of-magnitude regression.
  it('does not become catastrophically slow', () => {
    const g = scene({ quad: PAGE })
    detectDocumentQuad(g, W, H) // warm
    const start = performance.now()
    for (let i = 0; i < 60; i++) detectDocumentQuad(g, W, H)
    const perFrame = (performance.now() - start) / 60
    expect(perFrame).toBeLessThan(120)
  })
})

describe('signal stages', () => {
  it('converts RGBA to luminance, weighting green most', () => {
    expect(toGrayscale(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1)[0]).toBeGreaterThan(240)
    const green = toGrayscale(new Uint8ClampedArray([0, 255, 0, 255]), 1, 1)[0]
    const red = toGrayscale(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1)[0]
    expect(green).toBeGreaterThan(red)
  })

  it('blurs without shifting the image', () => {
    const g = scene({ quad: PAGE })
    const blurred = blur3(g, W, H)
    expect(blurred).toHaveLength(g.length)
    // A flat interior stays where it was.
    expect(Math.abs(blurred[100 * W + 120] - g[100 * W + 120])).toBeLessThan(3)
  })

  it('reports gradient direction folded into [0, PI)', () => {
    const { angle, mag } = gradients(blur3(scene({ quad: PAGE }), W, H), W, H)
    for (let i = 0; i < angle.length; i++) {
      expect(angle[i]).toBeGreaterThanOrEqual(0)
      expect(angle[i]).toBeLessThan(Math.PI + 1e-9)
    }
    expect(Math.max(...mag)).toBeGreaterThan(0)
  })

  it('finds two roughly perpendicular dominant orientations', () => {
    const { mag, angle } = gradients(blur3(scene({ quad: PAGE }), W, H), W, H)
    const [a, b] = dominantOrientations(mag, angle)
    let separation = Math.abs(a - b)
    if (separation > Math.PI / 2) separation = Math.PI - separation
    expect(separation).toBeGreaterThan(Math.PI / 2 - 0.45)
  })

  it('finds the page borders as two opposing pairs', () => {
    const grey = blur3(scene({ quad: PAGE }), W, H)
    const { mag, angle, gx, gy } = gradients(grey, W, H)
    const field = edgeField(grey, mag, angle, gx, gy, W, H)
    const [a, b] = dominantOrientations(mag, angle)
    const [familyA, familyB] = groupByDirection(candidateLines(field, W, H), a, b)

    for (const family of [familyA, familyB]) {
      expect(family.length).toBeGreaterThanOrEqual(2)
      // Opposite borders sit apart, and are opposite transitions: into the page
      // and back out of it.
      const spread = family[family.length - 1].along - family[0].along
      expect(spread).toBeGreaterThan(20)
      expect(family.some(l => l.sign > 0) && family.some(l => l.sign < 0)).toBe(true)
    }
  })

  it('gives every border its own angle, since perspective is not parallel', () => {
    // A page tilted towards the camera has converging sides. Assuming one angle
    // per direction cannot express that, and made a steeply held page invisible.
    const steep = [{ x: 88, y: 26 }, { x: 232, y: 30 }, { x: 296, y: 214 }, { x: 24, y: 210 }]
    const grey = blur3(scene({ quad: steep.map(c => ({ x: c.x, y: c.y })) }), W, H)
    const { mag, angle, gx, gy } = gradients(grey, W, H)
    const field = edgeField(grey, mag, angle, gx, gy, W, H)
    const angles = new Set(candidateLines(field, W, H).map(l => Math.round(l.theta * 180 / Math.PI)))
    expect(angles.size).toBeGreaterThan(2)
  })

  it('intersects two lines, and reports parallel ones as no intersection', () => {
    const point = intersect({ theta: 0, d: 10 }, { theta: Math.PI / 2, d: 20 })
    expect(point.x).toBeCloseTo(10, 5)
    expect(point.y).toBeCloseTo(20, 5)
    expect(intersect({ theta: 0, d: 10 }, { theta: 0, d: 40 })).toBeNull()
  })
})

describe('QuadTracker — why the frame stops wandering', () => {
  const quadAt = offset => ({
    confidence: 0.9,
    corners: [
      { x: 0.1 + offset, y: 0.1 }, { x: 0.9 + offset, y: 0.1 },
      { x: 0.9 + offset, y: 0.9 }, { x: 0.1 + offset, y: 0.9 }
    ]
  })

  it('shows a first detection immediately, but not as locked', () => {
    const t = new QuadTracker()
    const view = t.update(quadAt(0))
    expect(view).not.toBeNull()
    expect(view.locked).toBe(false)
  })

  it('locks once the detection agrees with itself', () => {
    const t = new QuadTracker({ lockAfter: 3 })
    t.update(quadAt(0)); t.update(quadAt(0.001))
    expect(t.update(quadAt(0.002)).locked).toBe(true)
  })

  it('holds the last outline through a brief dropout', () => {
    // One dropped frame must not make the frame blink off and on.
    const t = new QuadTracker({ holdFrames: 4 })
    t.update(quadAt(0))
    expect(t.update(null)).not.toBeNull()
    expect(t.update(null)).not.toBeNull()
  })

  it('gives up after a sustained dropout', () => {
    const t = new QuadTracker({ holdFrames: 2 })
    t.update(quadAt(0))
    t.update(null); t.update(null)
    expect(t.update(null)).toBeNull()
  })

  it('eases small corrections instead of snapping', () => {
    const t = new QuadTracker({ ease: 0.5, lockAfter: 99 })
    t.update(quadAt(0))
    const view = t.update(quadAt(0.02))
    expect(view.corners[0].x).toBeGreaterThan(0.1)
    expect(view.corners[0].x).toBeLessThan(0.12)
  })

  it('adopts a real move outright and re-earns the lock', () => {
    const t = new QuadTracker({ lockAfter: 3, jumpThreshold: 0.05 })
    t.update(quadAt(0)); t.update(quadAt(0)); t.update(quadAt(0))
    expect(t.view().locked).toBe(true)
    const moved = t.update(quadAt(0.4))     // camera panned
    expect(moved.locked).toBe(false)
    expect(moved.corners[0].x).toBeCloseTo(0.5, 2)
  })

  it('settles on a still page instead of drifting', () => {
    const t = new QuadTracker()
    for (let i = 0; i < 30; i++) {
      // Jitter of a pixel or two, as real detection does.
      t.update(quadAt(((i * 37) % 5 - 2) * 0.001))
    }
    const view = t.view()
    expect(view.locked).toBe(true)
    expect(Math.abs(view.corners[0].x - 0.1)).toBeLessThan(0.01)
  })

  it('measures corner drift for the jump test', () => {
    expect(maxCornerDistance(quadAt(0).corners, quadAt(0).corners)).toBe(0)
    expect(maxCornerDistance(quadAt(0).corners, quadAt(0.2).corners)).toBeCloseTo(0.2, 5)
  })
})

describe('a form, not a blank rectangle', () => {
  // The detector this replaced scored perfectly on blank rectangles and then
  // failed on a real usage form, because a form is covered in printed text and
  // table rules whose edges are stronger and straighter than the page border.
  // Every scene here is a form with content on a surface, at an angle, with
  // noise. See scanner/scenes.js.
  const cases = benchmark(W, H)
  const found = c => detectDocumentQuad(c.image, W, H)

  // The everyday situations. These have to work.
  const mustFind = [
    'square on, dark bench', 'square on, mid bench', 'square on, LIGHT bench',
    'dark form, light bench', 'tilted, light bench', 'rotated 20 deg',
    'low light, noisy', 'vignette + light bench', 'fills the frame',
    'small in frame', 'print to the edge'
  ]

  it.each(mustFind)('frames the page: %s', name => {
    const c = cases.find(x => x.name === name)
    const error = cornerError(found(c), c.quad, W, H)
    expect(error).toBeLessThanOrEqual(10)
  })

  it('is accurate, not merely close', () => {
    const errors = mustFind.map(name => {
      const c = cases.find(x => x.name === name)
      return cornerError(found(c), c.quad, W, H)
    })
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length
    expect(mean).toBeLessThan(4)
  })

  it('declines when a form is barely distinguishable from the bench', () => {
    // Eleven grey levels between paper and bench. Saying nothing is the right
    // answer here — a frame drawn on a guess is worse than no frame.
    const c = cases.find(x => x.name === 'near-identical bench')
    expect(found(c)).toBeNull()
  })

  it('never crops into the form, even when it gets the page wrong', () => {
    // The failures that remain all frame too widely rather than too tightly: a
    // page on a contrasting mat frames the mat. That direction is recoverable —
    // the whole form is still in the shot — and cropping into a form is not.
    for (const c of cases) {
      const r = found(c)
      if (!r) continue
      const inside = c.quad.map(t =>
        r.corners.some(d => Math.hypot(d.x * W - t.x, d.y * H - t.y) <= 16))
      // Either the corners match the page, or the quad encloses it.
      if (inside.every(Boolean)) continue
      const xs = r.corners.map(d => d.x * W), ys = r.corners.map(d => d.y * H)
      const slack = 6
      for (const t of c.quad) {
        expect(t.x, c.name).toBeGreaterThanOrEqual(Math.min(...xs) - slack)
        expect(t.x, c.name).toBeLessThanOrEqual(Math.max(...xs) + slack)
        expect(t.y, c.name).toBeGreaterThanOrEqual(Math.min(...ys) - slack)
        expect(t.y, c.name).toBeLessThanOrEqual(Math.max(...ys) + slack)
      }
    }
  })

  it('does not become catastrophically slow on a real form', () => {
    const c = cases.find(x => x.name === 'square on, LIGHT bench')
    detectDocumentQuad(c.image, W, H) // warm
    const start = performance.now()
    for (let i = 0; i < 15; i++) detectDocumentQuad(c.image, W, H)
    const each = (performance.now() - start) / 15
    expect(each).toBeLessThan(120)
  })
})
