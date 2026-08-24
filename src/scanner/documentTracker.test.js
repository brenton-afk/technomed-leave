import { describe, it, expect } from 'vitest'
import { DocumentTracker, maxCornerShift } from './documentTracker.js'

// The dancing frame was the complaint, and it was never mainly an accuracy
// problem: detection is per-frame and independent, so its answer moves a little
// every time even when nothing has.
//
// The first attempt at this — an eight-frame weighted mean, a freeze below 3%,
// and a fade — came back as "still sluggish and sloppy, deviates all over the
// place". So the two things being complained about are measured here as numbers
// rather than described: see "as numbers" at the foot of the file.

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
    // Waiting until the estimate had settled would read as a failure to detect.
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
    const frames = Array.from({ length: 20 }, (_, i) =>
      detection(quad(0.1, i % 2 ? 0.02 : -0.02)))
    const view = feed(tracker, frames)
    expect(maxCornerShift(view.corners, truth)).toBeLessThan(0.01)
  })
})

describe('moving as much as the page did, and no more', () => {
  // There is no freeze threshold any more. Holding the outline still until the
  // estimate had moved 3% and then moving it all at once turned smooth drift into
  // visible steps — a worse artefact than the jitter it hid. The gain does this
  // job instead: tiny movements are damped almost to nothing, large ones are
  // followed at once.
  it('barely moves for a movement too small to be real', () => {
    const tracker = new DocumentTracker()
    const settled = feed(tracker, Array.from({ length: 8 }, () => detection(quad(0.1))))
    const before = settled.corners

    // A page that has "moved" by a fifth of a percent of the frame.
    const after = feed(tracker, [detection(quad(0.102))], 2000)
    // Not frozen — but a fraction of a pixel on a 400px-wide preview.
    expect(maxCornerShift(after.corners, before)).toBeLessThan(0.001)
  })

  it('does move for a real movement', () => {
    const tracker = new DocumentTracker()
    feed(tracker, Array.from({ length: 8 }, () => detection(quad(0.1))))
    const before = tracker.estimate
    // Ten percent of the frame: the page has been picked up and moved.
    const after = feed(tracker, Array.from({ length: 8 }, () => detection(quad(0.2))), 2000)
    expect(maxCornerShift(after.corners, before)).toBeGreaterThan(0.03)
  })

  it('accumulates a slow drift instead of ignoring it forever', () => {
    const tracker = new DocumentTracker()
    feed(tracker, Array.from({ length: 8 }, () => detection(quad(0.1))))
    const before = tracker.estimate
    let at = 2000
    for (let step = 1; step <= 20; step++) {
      tracker.update(detection(quad(0.1 + step * 0.005)), at)
      at += 100
    }
    expect(maxCornerShift(tracker.estimate, before)).toBeGreaterThan(0.03)
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
    // Eight frames at 100ms is 700ms — not yet 800ms of stillness.
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
    // Three frames, because one frame claiming the page is somewhere else is
    // indistinguishable from a bad detection and is treated as one. A page that
    // has really moved keeps saying so.
    let moved
    for (let i = 0; i < 3; i++) moved = tracker.update(detection(quad(0.2)), 1900 + i * 100)
    expect(moved.readyToCapture).toBe(false)
    expect(moved.stillFor).toBe(0)
    expect(moved.reason).toBe('moving')
  })

  it('will not fire on a page too far away to read once cropped', () => {
    const tracker = new DocumentTracker()
    const small = Array.from({ length: 12 }, () => detection(quad(0.1), { fill: 0.15 }))
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

// ─── As numbers ──────────────────────────────────────────────────────────────
// "Sluggish and sloppy, deviates all over the place" is three measurable things,
// and describing them in prose is how the first attempt shipped believing it had
// fixed them. Each of these fails if the tracker regresses to the old behaviour.

/** A page held by hand: still, with the detector's noise on top. */
function noisyStill(frames, amplitude = 0.02) {
  // Alternating, which is what detector noise looks like — and the case the
  // first design handled worst, because a reversal is a large shift.
  return Array.from({ length: frames }, (_, i) =>
    detection(quad(0.1, i % 2 ? amplitude : -amplitude)))
}

describe('a page held still', () => {
  it('barely wobbles, however much the detector does', () => {
    const tracker = new DocumentTracker()
    const truth = quad(0.1)
    let worst = 0
    noisyStill(60).forEach((frame, i) => {
      const view = tracker.update(frame, 1000 + i * 100)
      // Steady state only. Measuring from the start folds in the convergence
      // from the first frame — which is worth its own test below, but is not
      // what wobble means, and conflating them says a *lower* gain wobbles more.
      if (i >= 45) worst = Math.max(worst, maxCornerShift(view.corners, truth))
    })
    // The detector is moving ±2% of frame width every frame: on a 400px preview,
    // ±8px of raw jitter. This is what reaches the screen.
    //
    // Measured against the design it replaced, on this same sequence: the
    // eight-frame weighted mean let 0.94% through, this lets 0.21% — under a
    // pixel. The threshold is loose enough not to be a tuning trap.
    expect(worst).toBeLessThan(0.004)
  })

  it('settles quickly enough not to look like a wrong answer', () => {
    // The first detection is taken whole, so the outline starts wherever the
    // detector's noise put it and has to walk in. Slowly enough and that walk is
    // itself visible as the frame creeping.
    const tracker = new DocumentTracker()
    const truth = quad(0.1)
    let view
    noisyStill(12).forEach((frame, i) => { view = tracker.update(frame, 1000 + i * 100) })
    expect(maxCornerShift(view.corners, truth)).toBeLessThan(0.006)
  })

  it('reports itself still, so the shutter can fire', () => {
    const tracker = new DocumentTracker()
    let view
    noisyStill(40).forEach((frame, i) => { view = tracker.update(frame, 1000 + i * 100) })
    // A tracker that passed the noise through would restart the stillness clock
    // on every frame and auto-capture would never fire — which is the fault
    // reported before this: "it doesn't auto scan though the box is ticked".
    expect(view.reason).toBe('ready')
    expect(view.readyToCapture).toBe(true)
  })
})

describe('a page being moved', () => {
  /** Corners marching steadily across the frame, as when aiming the phone. */
  const panning = (frames, step = 0.02) =>
    Array.from({ length: frames }, (_, i) => detection(
      quad(0.1).map(c => ({ x: c.x + i * step, y: c.y }))))

  it('keeps up, rather than trailing half a second behind', () => {
    const tracker = new DocumentTracker()
    const frames = panning(20)
    let view
    frames.forEach((frame, i) => { view = tracker.update(frame, 1000 + i * 100) })

    // How far the drawn outline is behind where the page actually is.
    const lag = maxCornerShift(view.corners, frames[frames.length - 1].corners)
    // Measured on this sequence: the eight-frame weighted mean sat 4.67% of
    // frame width behind — about 19px on a 400px preview, and plainly visible.
    // This is 1.64%, well under one step of 2%.
    expect(lag).toBeLessThan(0.02)
  })

  it('follows a page being brought closer', () => {
    // The corners travel in four opposing directions, which is why the sense of
    // direction is kept per corner: averaged across them it would cancel, and
    // zooming in would have been damped as though it were noise.
    const tracker = new DocumentTracker()
    let view
    for (let i = 0; i < 15; i++) {
      view = tracker.update(detection(quad(0.28 - i * 0.012)), 1000 + i * 100)
    }
    const truth = quad(0.28 - 14 * 0.012)
    expect(maxCornerShift(view.corners, truth)).toBeLessThan(0.02)
  })
})

describe('a detection that is simply wrong', () => {
  const settle = tracker => {
    for (let i = 0; i < 12; i++) tracker.update(detection(quad(0.1)), 1000 + i * 100)
    return tracker.estimate
  }

  it('is ignored rather than blended in', () => {
    const tracker = new DocumentTracker()
    const before = settle(tracker)

    // One frame latching onto the block under a form's header rule.
    const view = tracker.update(detection(quad(0.35)), 3000)

    // Measured: the old mean took this at 8/36 and dragged the outline 7.86% of
    // frame width — 31px — then needed eight more frames to crawl back. That is
    // what "deviates all over the place" was.
    expect(maxCornerShift(view.corners, before)).toBe(0)
  })

  it('does not delay the page it was hiding', () => {
    const tracker = new DocumentTracker()
    const before = settle(tracker)
    tracker.update(detection(quad(0.35)), 3000)
    // Good detections resume; the estimate never went anywhere.
    const view = tracker.update(detection(quad(0.1)), 3100)
    expect(maxCornerShift(view.corners, before)).toBeLessThan(0.002)
  })

  it('is believed once it keeps saying the same thing', () => {
    // The phone really has been pointed at a different page. Holding out for ever
    // would be worse than being dragged about.
    const tracker = new DocumentTracker()
    settle(tracker)
    let view
    for (let i = 0; i < 3; i++) view = tracker.update(detection(quad(0.35)), 3000 + i * 100)
    expect(maxCornerShift(view.corners, quad(0.35))).toBe(0)
  })

  it('is not believed on two showings, because it usually gets two', () => {
    // Measured: a detector's wrong answer on a given scene is generally the same
    // wrong answer, so it lands twice in a row often enough to matter. Believing
    // it at two took the worst jump on the bench from 0.10% to 8.34%.
    const tracker = new DocumentTracker()
    const before = settle(tracker)
    tracker.update(detection(quad(0.35)), 3000)
    const view = tracker.update(detection(quad(0.35)), 3100)
    expect(maxCornerShift(view.corners, before)).toBe(0)
  })

  it('needs the repeat to agree with itself, not merely to be far away', () => {
    // Two different wrong answers in a row are two mistakes, not a new page.
    const tracker = new DocumentTracker()
    const before = settle(tracker)
    tracker.update(detection(quad(0.35)), 3000)
    const view = tracker.update(detection(quad(0.5)), 3100)
    expect(maxCornerShift(view.corners, before)).toBe(0)
  })

  it('does not make the shutter wait for something it has decided to ignore', () => {
    // This used to hold the shutter, and that was incoherent: the detection is
    // rejected as noise for the purpose of drawing the outline and then trusted
    // enough to restart the stillness clock. It also has a cost — a camera
    // producing an outlier more often than once every stillForMs could never
    // auto-capture at all, however still the page was being held.
    const tracker = new DocumentTracker()
    for (let i = 0; i < 20; i++) tracker.update(detection(quad(0.1)), 1000 + i * 100)
    const view = tracker.update(detection(quad(0.35)), 3000)
    expect(view.readyToCapture).toBe(true)
    // And the outline has not budged, which is the point of rejecting it.
    expect(maxCornerShift(view.corners, quad(0.1))).toBeLessThan(0.002)
  })
})

describe('capturing on its own, with a camera that is not perfect', () => {
  // "The auto scan function has switched off." Two separate reasons it could not
  // fire, and the fix for one of them was the previous commit's own doing.

  it('fires at the distance a form is actually held', () => {
    // The gate was 0.6, which the *table* used to clear because it filled the
    // frame. A page does not: held at a working distance in a portrait frame it
    // covers about 28%, and there `fill` is close to the raw area. So fixing the
    // detector to prefer the page turned auto-capture off.
    const tracker = new DocumentTracker()
    let view
    for (let i = 0; i < 20; i++) {
      view = tracker.update(detection(quad(0.1), { fill: 0.28 }), 1000 + i * 66)
    }
    expect(view.reason).toBe('ready')
    expect(view.readyToCapture).toBe(true)
  })

  it('fires despite an outlier every few frames', () => {
    // A real camera throws one of these regularly. While a rejected outlier
    // restarted the stillness clock, one arriving more often than every 800ms
    // meant the shutter could never fire — and the tighter jump gate made
    // rejections more frequent, not less.
    const tracker = new DocumentTracker()
    let fired = false
    for (let i = 0; i < 40; i++) {
      const frame = i % 4 === 3
        ? detection(quad(0.35), { fill: 0.28 })   // nonsense, and rejected
        : detection(quad(0.1), { fill: 0.28 })
      const view = tracker.update(frame, 1000 + i * 66)
      if (view.readyToCapture) fired = true
    }
    expect(fired).toBe(true)
  })

  it('still refuses in light too poor to read the form', () => {
    // The other gates are untouched. Lowering the distance requirement is not a
    // reason to photograph something illegible.
    const tracker = new DocumentTracker()
    let view
    for (let i = 0; i < 20; i++) {
      view = tracker.update(detection(quad(0.1), { fill: 0.5, contrast: 0.1 }), 1000 + i * 66)
    }
    expect(view.reason).toBe('dark')
    expect(view.readyToCapture).toBe(false)
  })

  it('still refuses while the outline is fading', () => {
    const tracker = new DocumentTracker()
    for (let i = 0; i < 20; i++) tracker.update(detection(quad(0.1), { fill: 0.5 }), 1000 + i * 66)
    const view = tracker.update(null, 2400)
    expect(view.readyToCapture).toBe(false)
  })
})
