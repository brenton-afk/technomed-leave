// ─── Document edge detection ──────────────────────────────────────────────────
// Finds the page in front of the camera, on any surface, and holds still.
//
// The previous version thresholded brightness and took the largest bright blob.
// That had two fatal properties: it assumed paper is lighter than whatever it is
// lying on, so a form on a white bench was invisible; and a blob outline shifts
// every frame as light flickers, which is why the frame wandered.
//
// This works the way a real scanner does — on edges, then on lines:
//
//   blur → Sobel gradient → local contrast normalisation
//        → dominant edge orientations → the four strongest lines → intersect
//
// Gradients respond to a contrast boundary regardless of which side is lighter,
// which is what makes light-on-light work. Lines are geometrically stable in a
// way blob outlines are not, which is what stops the wander. A tracker on top
// adds hysteresis, so the frame locks instead of twitching.

const PI = Math.PI

// ─── Preparation ──────────────────────────────────────────────

/** RGBA from a canvas → one luminance byte per pixel. */
export function toGrayscale(rgba, width, height) {
  const gray = new Uint8Array(width * height)
  for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
    // Rec. 601 luma, integer maths — this runs on every frame.
    gray[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8
  }
  return gray
}

/**
 * Separable 3x3 box blur. Sensor noise in low light produces gradients as strong
 * as a real paper edge; one cheap blur removes most of it.
 */
export function blur3(src, width, height) {
  const tmp = new Uint16Array(src.length)
  const out = new Uint8Array(src.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const l = src[row + (x > 0 ? x - 1 : 0)]
      const c = src[row + x]
      const r = src[row + (x < width - 1 ? x + 1 : width - 1)]
      tmp[row + x] = l + c + r
    }
  }
  for (let y = 0; y < height; y++) {
    const up = (y > 0 ? y - 1 : 0) * width
    const mid = y * width
    const down = (y < height - 1 ? y + 1 : height - 1) * width
    for (let x = 0; x < width; x++) {
      out[mid + x] = (tmp[up + x] + tmp[mid + x] + tmp[down + x]) / 9
    }
  }
  return out
}

/**
 * Sobel gradients, with magnitude normalised against the local average.
 *
 * The normalisation is what lets a faint edge in shadow compete with a strong
 * one under a window. Without it a single bright region dominates the frame and
 * a page in the dim half is never found.
 *
 * @returns {{ mag: Float32Array, angle: Float32Array }} angle in [0, PI)
 */
export function gradients(gray, width, height) {
  const mag = new Float32Array(width * height)
  const angle = new Float32Array(width * height)

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const tl = gray[i - width - 1], t = gray[i - width], tr = gray[i - width + 1]
      const l = gray[i - 1], r = gray[i + 1]
      const bl = gray[i + width - 1], b = gray[i + width], br = gray[i + width + 1]

      const gx = (tr + 2 * r + br) - (tl + 2 * l + bl)
      const gy = (bl + 2 * b + br) - (tl + 2 * t + tr)

      mag[i] = Math.sqrt(gx * gx + gy * gy)
      // Folded to [0, PI): an edge and its reverse are the same line, so
      // direction beyond PI carries no extra information.
      let a = Math.atan2(gy, gx)
      if (a < 0) a += PI
      if (a >= PI) a -= PI
      angle[i] = a
    }
  }

  // Local mean magnitude on a coarse grid, then divide through.
  const CELL = 16
  const cols = Math.ceil(width / CELL)
  const rows = Math.ceil(height / CELL)
  const cellSum = new Float32Array(cols * rows)
  const cellCount = new Float32Array(cols * rows)
  let globalMean = 0

  for (let y = 0; y < height; y++) {
    const cy = (y / CELL) | 0
    for (let x = 0; x < width; x++) {
      const value = mag[y * width + x]
      const c = cy * cols + ((x / CELL) | 0)
      cellSum[c] += value
      cellCount[c]++
      globalMean += value
    }
  }
  globalMean /= Math.max(1, width * height)

  for (let y = 0; y < height; y++) {
    const cy = (y / CELL) | 0
    for (let x = 0; x < width; x++) {
      const c = cy * cols + ((x / CELL) | 0)
      const local = cellSum[c] / Math.max(1, cellCount[c])
      // Blended with the global mean so a genuinely flat cell cannot amplify
      // its own noise into a phantom edge.
      const scale = 0.65 * local + 0.35 * globalMean
      mag[y * width + x] /= (scale + 1e-3)
    }
  }

  return { mag, angle }
}

// ─── Dominant orientations ────────────────────────────────────

const ORIENTATION_BINS = 90 // 2 degrees per bin

/**
 * The two dominant edge orientations, roughly perpendicular. A rectangular page
 * produces exactly two, at whatever angle it is held.
 * @returns {[number, number] | null} radians in [0, PI)
 */
export function dominantOrientations(mag, angle, minMagnitude = 1.6) {
  const hist = new Float32Array(ORIENTATION_BINS)
  for (let i = 0; i < mag.length; i++) {
    const m = mag[i]
    if (m < minMagnitude) continue
    const bin = Math.min(ORIENTATION_BINS - 1, (angle[i] / PI * ORIENTATION_BINS) | 0)
    hist[bin] += m
  }

  // Circular smoothing: 179 degrees and 1 degree are the same direction.
  const smooth = new Float32Array(ORIENTATION_BINS)
  for (let b = 0; b < ORIENTATION_BINS; b++) {
    let sum = 0
    for (let k = -2; k <= 2; k++) {
      sum += hist[(b + k + ORIENTATION_BINS) % ORIENTATION_BINS] * (3 - Math.abs(k))
    }
    smooth[b] = sum
  }

  let first = -1, firstValue = 0
  for (let b = 0; b < ORIENTATION_BINS; b++) {
    if (smooth[b] > firstValue) { firstValue = smooth[b]; first = b }
  }
  if (first === -1 || firstValue <= 0) return null

  // The partner sits near 90 degrees away, within tolerance for perspective.
  const quarter = ORIENTATION_BINS / 2
  const tolerance = Math.round(22 / 180 * ORIENTATION_BINS)
  let second = -1, secondValue = 0
  for (let d = -tolerance; d <= tolerance; d++) {
    const b = (first + quarter + d + ORIENTATION_BINS) % ORIENTATION_BINS
    if (smooth[b] > secondValue) { secondValue = smooth[b]; second = b }
  }
  if (second === -1 || secondValue <= 0) return null

  const toRad = b => (b + 0.5) / ORIENTATION_BINS * PI
  return [toRad(first), toRad(second)]
}

// ─── The strongest line pair in one direction ─────────────────

/**
 * Two parallel lines with normal `theta`, found by projecting edge strength onto
 * that normal and taking the two strongest well-separated peaks. Those are the
 * page's opposing edges.
 */
export function strongestLinePair(mag, angle, width, height, theta, opts = {}) {
  const {
    angleTolerance = 20 / 180 * PI,
    minMagnitude = 1.6,
    minSeparationFraction = 0.15
  } = opts

  const nx = Math.cos(theta), ny = Math.sin(theta)
  // Offset keeps every projected distance non-negative for any orientation.
  const offset = (nx < 0 ? -nx * width : 0) + (ny < 0 ? -ny * height : 0)
  const span = Math.abs(nx) * width + Math.abs(ny) * height
  const bins = Math.max(32, Math.ceil(span) + 1)
  const acc = new Float32Array(bins)

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const m = mag[i]
      if (m < minMagnitude) continue
      // Only pixels whose gradient runs along this normal — those are the ones
      // belonging to an edge perpendicular to it.
      let diff = Math.abs(angle[i] - theta)
      if (diff > PI / 2) diff = PI - diff
      if (diff > angleTolerance) continue

      const bin = Math.min(bins - 1, Math.max(0, Math.round(x * nx + y * ny + offset)))
      acc[bin] += m
    }
  }

  const smooth = new Float32Array(bins)
  for (let b = 0; b < bins; b++) {
    let sum = 0
    for (let k = -2; k <= 2; k++) {
      const j = b + k
      if (j >= 0 && j < bins) sum += acc[j] * (3 - Math.abs(k))
    }
    smooth[b] = sum
  }

  let firstBin = -1, firstValue = 0
  for (let b = 0; b < bins; b++) {
    if (smooth[b] > firstValue) { firstValue = smooth[b]; firstBin = b }
  }
  if (firstBin === -1 || firstValue <= 0) return null

  // The second peak must be far enough away to be the opposite edge of a page
  // rather than the far side of one thick line.
  const minSeparation = Math.max(6, Math.round(span * minSeparationFraction))
  let secondBin = -1, secondValue = 0
  for (let b = 0; b < bins; b++) {
    if (Math.abs(b - firstBin) < minSeparation) continue
    if (smooth[b] > secondValue) { secondValue = smooth[b]; secondBin = b }
  }
  if (secondBin === -1 || secondValue <= 0) return null

  const make = (bin, strength) => ({ theta, d: bin - offset, strength })
  const a = make(firstBin, firstValue)
  const b = make(secondBin, secondValue)
  return a.d <= b.d ? [a, b] : [b, a]
}

/** Where two lines meet, or null if they are parallel. */
export function intersect(l1, l2) {
  const n1x = Math.cos(l1.theta), n1y = Math.sin(l1.theta)
  const n2x = Math.cos(l2.theta), n2y = Math.sin(l2.theta)
  const det = n1x * n2y - n1y * n2x
  if (Math.abs(det) < 1e-6) return null
  return {
    x: (l1.d * n2y - l2.d * n1y) / det,
    y: (l2.d * n1x - l1.d * n2x) / det
  }
}

// ─── Assemble and validate ────────────────────────────────────

function polygonArea(corners) {
  let area = 0
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length]
    area += a.x * b.y - b.x * a.y
  }
  return Math.abs(area) / 2
}

function isConvex(corners) {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4], c = corners[(i + 2) % 4]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-6) continue
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

function orderCorners(points) {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  const sorted = points.slice().sort((a, b) =>
    Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  let startIndex = 0, best = Infinity
  for (let i = 0; i < sorted.length; i++) {
    const score = sorted[i].x + sorted[i].y
    if (score < best) { best = score; startIndex = i }
  }
  return [0, 1, 2, 3].map(i => sorted[(startIndex + i) % 4])
}

function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) }

/**
 * Detects the page quad in a grayscale frame.
 *
 * @returns {{corners: Array<{x:number,y:number}>, confidence: number, areaFraction: number} | null}
 *          corners normalised 0..1, ordered TL, TR, BR, BL
 */
export function detectDocumentQuad(gray, width, height, opts = {}) {
  const {
    minAreaFraction = 0.08,
    // Above 1 is allowed: a page held close legitimately overflows the frame.
    maxAreaFraction = 1.7,
    minMagnitude = 1.6,
    outsideMargin = 0.35,
    minSquareness = 0.5
  } = opts

  if (!gray || !width || !height || gray.length < width * height) return null

  const smoothed = blur3(gray, width, height)
  const { mag, angle } = gradients(smoothed, width, height)

  const orientations = dominantOrientations(mag, angle, minMagnitude)
  if (!orientations) return null

  const pairA = strongestLinePair(mag, angle, width, height, orientations[0], { minMagnitude })
  const pairB = strongestLinePair(mag, angle, width, height, orientations[1], { minMagnitude })
  if (!pairA || !pairB) return null

  const raw = [
    intersect(pairA[0], pairB[0]), intersect(pairA[0], pairB[1]),
    intersect(pairA[1], pairB[1]), intersect(pairA[1], pairB[0])
  ]
  if (raw.some(p => p === null)) return null

  // A corner just off screen is normal when a page is held close, so a margin
  // is allowed rather than rejecting the whole detection.
  const marginX = width * outsideMargin, marginY = height * outsideMargin
  if (raw.some(p =>
    p.x < -marginX || p.x > width + marginX ||
    p.y < -marginY || p.y > height + marginY)) return null

  const corners = orderCorners(raw)
  if (!isConvex(corners)) return null

  const areaFraction = polygonArea(corners) / (width * height)
  if (areaFraction < minAreaFraction || areaFraction > maxAreaFraction) return null

  // Opposite sides of a rectangle stay similar even under perspective.
  const top = distance(corners[0], corners[1])
  const right = distance(corners[1], corners[2])
  const bottom = distance(corners[2], corners[3])
  const left = distance(corners[3], corners[0])
  const horizontalRatio = Math.min(top, bottom) / Math.max(top, bottom)
  const verticalRatio = Math.min(left, right) / Math.max(left, right)
  if (horizontalRatio < minSquareness || verticalRatio < minSquareness) return null

  // Line strength carries through, so a crisp page reads as more confident than
  // a quad assembled from weak edges.
  const strength = pairA[0].strength + pairA[1].strength + pairB[0].strength + pairB[1].strength
  const squareness = Math.min(horizontalRatio, verticalRatio)
  const confidence = Math.min(1, squareness * 0.6 + Math.min(1, strength / 30000) * 0.4)

  return {
    corners: corners.map(c => ({ x: c.x / width, y: c.y / height })),
    confidence,
    areaFraction
  }
}

// ─── Holding still ────────────────────────────────────────────

export function maxCornerDistance(a, b) {
  let worst = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    worst = Math.max(worst, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y))
  }
  return worst
}

/**
 * Temporal tracker. Detection alone twitches slightly every frame and drops out
 * for the occasional frame; both read as the frame "searching". This adds
 * hysteresis — a candidate must agree with itself for a few frames before it is
 * shown as locked, a brief dropout holds the last good outline instead of
 * discarding it, and updates are eased rather than snapped.
 */
export class QuadTracker {
  constructor({ lockAfter = 3, holdFrames = 10, jumpThreshold = 0.09, ease = 0.45 } = {}) {
    this.lockAfter = lockAfter
    this.holdFrames = holdFrames
    this.jumpThreshold = jumpThreshold
    this.ease = ease
    this.current = null
    this.hits = 0
    this.misses = 0
  }

  /** @returns {{corners, confidence, locked: boolean} | null} what to draw */
  update(detection) {
    if (!detection) {
      this.misses++
      // Hold the last outline briefly: one dropped frame should not make the
      // frame blink off and on.
      if (this.current && this.misses <= this.holdFrames) return this.view()
      this.current = null
      this.hits = 0
      return null
    }

    this.misses = 0
    if (!this.current) {
      this.current = detection
      this.hits = 1
      return this.view()
    }

    const drift = maxCornerDistance(this.current.corners, detection.corners)
    if (drift > this.jumpThreshold) {
      // A real move — the camera panned, or a different page came into view.
      // Adopt it and start earning the lock again.
      this.current = detection
      this.hits = 1
      return this.view()
    }

    this.hits++
    // Once locked, ease more slowly. That is what makes it feel planted rather
    // than nervous.
    const alpha = this.hits >= this.lockAfter ? this.ease * 0.5 : this.ease
    const previous = this.current.corners
    this.current = {
      ...detection,
      corners: detection.corners.map((c, i) => ({
        x: previous[i].x + (c.x - previous[i].x) * alpha,
        y: previous[i].y + (c.y - previous[i].y) * alpha
      }))
    }
    return this.view()
  }

  view() {
    if (!this.current) return null
    return { ...this.current, locked: this.hits >= this.lockAfter }
  }

  reset() {
    this.current = null
    this.hits = 0
    this.misses = 0
  }
}
