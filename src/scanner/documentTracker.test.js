import { describe, it, expect } from 'vitest'
import { DocumentTracker, maxCornerShift } from './documentTracker.js'

// The dancing frame was the complaint, and it was never mainly an accuracy
// problem: detection is per-frame and independent, so its answer moves a little
// every time even when nothing has. These are the three mechanisms that stop it,
// tested separately because they fix three different things.

const quad = (inset = 0.1, jitter = 0) => {
  const j = (i) => jitter * ((i % 2) ? 1 : -1)
  return [
    { x: inset + j(0), y: inset + j(1) },
    { x: 1 - inset + j(1), y: inset + j(0) },
    { x: 1 - inset + j(0), y: 1 - inset + j(1) },
    { x: inset + j(1), y: 1 - inset + j(0) }
  ]
}

const detection = (corners, extra = {}) =>
  ({ corners, areaFraction: 0.7, contrast: 0.8, ...extra })

/** Feeds n frames 100ms apart, returning the last view. */
function feed(tracker, frames, startAt = 1000, step = 100) {
  let view
  frames.forEach((frame, i) => { view = tracker.update(frame, startAt + i * step) })
  return view
}

describe('averaging out the wobble', () => {
  it('draws an outline from the first frame, rather than waiting', () => {
    // Waiting for a full history would read as a failure to detect.
    const tracker = new DocumentTracker()
    const view = tracker.update(detection(quad()), 1000)
    expect(view.corners).not.toBeNull()
    expect(view.opacity).toBe(1)
    // But it is not settled yet, so it cannot trigger a capture.
    expect(view.readyToCapture).toBe(false)
  })

  it('smooths a noisy detection towards the truth', () => {
    const tracker = new DocumentTracker()
    const truth = quad(0.1)
    // Alternating error either side of the real position.
    const frames = Array.from({ length: 8 }, (_, i) =>
      detection(quad(0.1, i % 2 ? 0.02 : -0.02)))
    const view = feed(tracker, frames)
    expect(maxCornerShift(view.corners, truth)).toBeLessThan(0.01)
  })
})

describe('not redrawing at all below a threshold', () => {
  it('leaves the outline exactly where it is under tiny movement', () => {
    const tracker = new DocumentTracker()
    const settled = feed(tracker, Array.from({ length: 8 }, () => detection(quad(0.1))))
    const before = settled.corners

    // A page that has "moved" by a fifth of a percent of the frame.
    const after = feed(tracker, [detection(quad(0.102))], 2000)
    // The same array object, not merely equal numbers: nothing was recomputed.
    expect(after.corners).toBe(before)
  })

  it('does move for a real movement', () => {
    const tracker = new DocumentTracker()
    feed(tracker, Array.from({ length: 8 }, () => detection(quad(0.1))))
    const before = tracker.displayed
    // Ten percent of the frame: the page has been picked up and moved.
    const after = feed(tracker, Array.from({ length: 8 }, () => detection(quad(0.2))), 2000)
    expect(after.corners).not.toBe(before)
    expect(maxCornerShift(after.corners, before)).toBeGreaterThan(0.03)
  })

  it('accumulates a slow drift instead of ignoring it forever', () => {
    // Each step is under the threshold, but they add up, and the outline has to
    // follow. A threshold applied to the *drawn* position rather than to each
    // step is what makes that work.
    const tracker = new DocumentTracker()
    feed(tracker, Array.from({ length: 8 }, () => detection(quad(0.1))))
    const before = tracker.displayed
    let at = 2000
    for (let step = 1; step <= 20; step++) {
      tracker.update(detection(quad(0.1 + step * 0.005)), at)
      at += 100
    }
    expect(maxCornerShift(tracker.displayed, before)).toBeGreaterThan(0.03)
  })
})

describe('fading rather than blinking', () => {
  it('holds the outline through a dropped frame', () => {
    const tracker = new DocumentTracker()
    feed(tracker, Array.from({ length: 8 }, () => detection(quad(0.1))))
    const view = tracker.update(null, 1800) // 100ms after the last detection
    expect(view.corners).not.toBeNull()
    expect(view.opacity).toBeLessThan(1)
    expect(view.opacity).toBeGreaterThan(0.5)
  })

  it('fades out over the hold window rather than vanishing', () => {
    const tracker = new DocumentTracker()
    feed(tracker, Array.from({ length: 8 }, () => detection(quad(0.1))))
    const half = tracker.update(null, 1700 + 250)
    expect(half.opacity).toBeCloseTo(0.5, 1)
    expect(half.corners).not.toBeNull()
  })

  it('gives up once the page has really gone', () => {
    const tracker = new DocumentTracker()
    feed(tracker, Array.from({ length: 8 }, () => detection(quad(0.1))))
    const gone = tracker.update(null, 3000)
    expect(gone.corners).toBeNull()
    expect(gone.opacity).toBe(0)
  })

  it('tracks a new page afresh rather than sliding across from the old one', () => {
    const tracker = new DocumentTracker()
    feed(tracker, Array.from({ length: 8 }, () => detection(quad(0.1))))
    tracker.update(null, 3000)          // gone
    const fresh = tracker.update(detection(quad(0.3)), 3100)
    expect(maxCornerShift(fresh.corners, quad(0.3))).toBeLessThan(0.001)
  })

  it('will not capture while fading, since the edges are no longer visible', () => {
    const tracker = new DocumentTracker()
    feed(tracker, Array.from({ length: 12 }, () => detection(quad(0.1))), 1000, 100)
    const fading = tracker.update(null, 2300)
    expect(fading.readyToCapture).toBe(false)
    expect(fading.countdown).toBe(0)
  })
})

describe('deciding when to capture on its own', () => {
  const still = () => Array.from({ length: 8 }, () => detection(quad(0.1)))

  it('waits the full hold before firing', () => {
    const tracker = new DocumentTracker()
    // Eight frames at 100ms is 700ms of history — not yet 800ms of stillness.
    const early = feed(tracker, still())
    expect(early.readyToCapture).toBe(false)
    expect(early.countdown).toBeGreaterThan(0)
    expect(early.countdown).toBeLessThan(1)

    const later = tracker.update(detection(quad(0.1)), 1800)
    expect(later.readyToCapture).toBe(true)
    expect(later.countdown).toBe(1)
  })

  it('shows how far through the wait it is, so the countdown means something', () => {
    const tracker = new DocumentTracker()
    feed(tracker, still())
    const quarter = tracker.update(detection(quad(0.1)), 1000 + 200)
    expect(quarter.countdown).toBeCloseTo(0.25, 1)
  })

  it('restarts the wait when the page moves', () => {
    const tracker = new DocumentTracker()
    feed(tracker, still())
    tracker.update(detection(quad(0.1)), 1800)
    const moved = tracker.update(detection(quad(0.2)), 1900)
    expect(moved.readyToCapture).toBe(false)
    expect(moved.stillFor).toBe(0)
    expect(moved.reason).toBe('moving')
  })

  it('will not fire on a page too far away to read once cropped', () => {
    const tracker = new DocumentTracker()
    const small = Array.from({ length: 12 }, () => detection(quad(0.1), { fill: 0.3 }))
    const view = feed(tracker, small)
    expect(view.readyToCapture).toBe(false)
    expect(view.reason).toBe('small')
    expect(view.hint).toBe('Move closer')
    // The outline is still drawn — it is guidance, not a refusal.
    expect(view.corners).not.toBeNull()
  })

  it('fires for a portrait page filling a landscape frame', () => {
    // The bug this exists for. A portrait A4 page inside a 16:9 landscape camera
    // frame covers at most 39.8% of it however close the phone is held, so a
    // threshold of "60% of the frame" could not be met at any distance: the
    // scanner advised "Move closer" indefinitely and never fired. Judged against
    // what is *achievable*, a page filling the frame's height is ready.
    const tracker = new DocumentTracker()
    const nearlyFull = Array.from({ length: 12 },
      () => detection(quad(0.1), { areaFraction: 0.37, fill: 0.93 }))
    const view = feed(tracker, nearlyFull, 1000, 100)
    expect(view.reason).toBe('ready')
    expect(view.readyToCapture).toBe(true)
  })

  it('tolerates the movement of a hand holding a phone', () => {
    // Nobody holds a phone still to within 1.5% of the frame, which is what the
    // stillness test used to demand, so the wait never completed.
    const tracker = new DocumentTracker()
    let at = 1000
    let view
    for (let i = 0; i < 20; i++) {
      // A page wandering by about 1% of the frame, as a held phone does.
      const wobble = 0.005 * Math.sin(i)
      view = tracker.update(detection(quad(0.1 + wobble), { fill: 0.9 }), at)
      at += 100
    }
    expect(view.readyToCapture).toBe(true)
  })

  it('will not fire in light too poor to read the form', () => {
    const tracker = new DocumentTracker()
    const dim = Array.from({ length: 12 }, () => detection(quad(0.1), { contrast: 0.1 }))
    const view = feed(tracker, dim)
    expect(view.readyToCapture).toBe(false)
    expect(view.reason).toBe('dark')
    expect(view.hint).toBe('More light needed')
  })

  it('says what to do about it in every case', () => {
    const tracker = new DocumentTracker()
    expect(tracker.update(null, 1000).hint).toBe('Point at the form')
    for (const [extra, hint] of [
      [{ areaFraction: 0.2 }, 'Move closer'],
      [{ contrast: 0.05 }, 'More light needed']
    ]) {
      const t = new DocumentTracker()
      expect(feed(t, Array.from({ length: 12 }, () => detection(quad(0.1), extra))).hint).toBe(hint)
    }
  })
})
