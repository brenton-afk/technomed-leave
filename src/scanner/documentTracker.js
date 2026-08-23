// ─── Holding the frame still ──────────────────────────────────────────────────
// Detection is per-frame and independent, so its answer moves a little every
// time even when nothing in front of the camera has. Drawn straight to the
// screen that reads as the frame dancing, which is the single thing that made
// the old scanner feel broken — it was never mainly an accuracy problem.
//
// Three separate mechanisms, because they fix three different things:
//
//   averaging   removes the frame-to-frame wobble in the detector's answer
//   a threshold stops the drawn outline moving at all until the average has
//               moved enough to be worth redrawing, which kills the last of the
//               micro-jitter that averaging leaves behind
//   a fade      stops the outline blinking out on a single dropped frame
//
// Nothing here needs a camera or a canvas, so all of it is testable directly.

/** The furthest any one corner has moved, in frame widths. */
export function maxCornerShift(a, b) {
  if (!a || !b) return Infinity
  let worst = 0
  for (let i = 0; i < 4; i++) {
    worst = Math.max(worst, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y))
  }
  return worst
}

function averageCorners(history) {
  // Linear weights, so the newest frame counts for as much as the oldest few
  // together. Heavier weighting tracks a moving page faster; lighter is steadier
  // on a still one. This is the balance that stops the outline lagging visibly
  // behind the page while the phone is being lined up.
  let totalWeight = 0
  const sum = [0, 1, 2, 3].map(() => ({ x: 0, y: 0 }))
  history.forEach((corners, index) => {
    const weight = index + 1
    totalWeight += weight
    for (let i = 0; i < 4; i++) {
      sum[i].x += corners[i].x * weight
      sum[i].y += corners[i].y * weight
    }
  })
  return sum.map(c => ({ x: c.x / totalWeight, y: c.y / totalWeight }))
}

/**
 * Why the scanner is not about to capture, in the words the overlay uses.
 * Ordered by what the person should do about it first.
 */
export const HOLD_REASONS = {
  searching: 'Point at the form',
  small: 'Move closer',
  dark: 'More light needed',
  moving: 'Hold still',
  ready: 'Hold still'
}

export class DocumentTracker {
  constructor(options = {}) {
    const {
      // Eight frames at ten detections a second is about three quarters of a
      // second of history: long enough to average out the wobble, short enough
      // that the outline still follows a page being moved into position.
      historyLength = 8,
      // Below this the drawn outline is left exactly where it is. Three percent
      // of the frame is under two millimetres on a phone held at reading
      // distance — invisible as a correction, and the whole of the jitter.
      redrawThreshold = 0.03,
      // A dropped frame is normal; a page that has left the picture is not. Long
      // enough to ride out the former, short enough that the latter does not
      // leave a stale outline sitting on screen.
      holdMs = 500,
      // How still counts as still, and for how long.
      stillTolerance = 0.015,
      stillForMs = 800,
      // A page smaller than this is too far away to read once cropped.
      minCaptureArea = 0.6,
      minContrast = 0.3
    } = options

    this.historyLength = historyLength
    this.redrawThreshold = redrawThreshold
    this.holdMs = holdMs
    this.stillTolerance = stillTolerance
    this.stillForMs = stillForMs
    this.minCaptureArea = minCaptureArea
    this.minContrast = minContrast
    this.reset()
  }

  reset() {
    this.history = []
    this.displayed = null
    this.lastSmoothed = null
    this.lastSeenAt = null
    this.stillSince = null
    this.latest = null
  }

  /**
   * @param {{corners, areaFraction, contrast}|null} detection
   * @param {number} now  milliseconds, monotonic
   * @returns {{corners, opacity, locked, stillFor, countdown, readyToCapture, reason}}
   */
  update(detection, now) {
    if (!detection) {
      const since = this.lastSeenAt == null ? Infinity : now - this.lastSeenAt
      if (since > this.holdMs) {
        // Gone. Everything resets, so a page reappearing is tracked afresh
        // rather than eased across the screen from where the last one was.
        this.reset()
        return this.view(null, 0, now)
      }
      // Fading, and no longer a candidate for capture: an outline nobody can
      // currently see the edges of must not trigger a photograph.
      this.stillSince = null
      return this.view(this.displayed, 1 - since / this.holdMs, now)
    }

    this.latest = detection
    this.lastSeenAt = now
    this.history.push(detection.corners)
    if (this.history.length > this.historyLength) this.history.shift()

    const smoothed = averageCorners(this.history)

    // Stillness is judged on the average, not on the drawn outline. The drawn one
    // is deliberately frozen below the redraw threshold, so it would report
    // perfect stillness for a page that is in fact drifting.
    if (!this.lastSmoothed || maxCornerShift(this.lastSmoothed, smoothed) > this.stillTolerance) {
      this.stillSince = now
    }
    this.lastSmoothed = smoothed

    if (!this.displayed || maxCornerShift(this.displayed, smoothed) > this.redrawThreshold) {
      this.displayed = smoothed
    }
    return this.view(this.displayed, 1, now)
  }

  view(corners, opacity, now) {
    const stillFor = this.stillSince == null ? 0 : now - this.stillSince
    // A full history means the average is trustworthy. Before that the outline is
    // still drawn — waiting would look like a failure to detect — but it is not
    // called locked and cannot trigger a capture.
    const settled = Boolean(corners) && this.history.length >= this.historyLength
    const area = this.latest?.areaFraction ?? 0
    const contrast = this.latest?.contrast ?? 0

    let reason = 'searching'
    if (corners) {
      if (area < this.minCaptureArea) reason = 'small'
      else if (contrast < this.minContrast) reason = 'dark'
      else reason = settled && stillFor > 0 ? 'ready' : 'moving'
    }

    const eligible = reason === 'ready' && settled && opacity === 1
    return {
      corners,
      opacity,
      locked: settled && stillFor >= this.stillForMs * 0.25,
      stillFor,
      // 0 to 1 across the wait, for the overlay to show what is about to happen.
      countdown: eligible ? Math.min(1, stillFor / this.stillForMs) : 0,
      readyToCapture: eligible && stillFor >= this.stillForMs,
      reason,
      hint: HOLD_REASONS[reason],
      areaFraction: area,
      contrast
    }
  }
}
