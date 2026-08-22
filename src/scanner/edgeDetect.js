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
  // The signed components are kept as well as the folded angle. Sign is what
  // separates a page border from printed text: see signedLinePair.
  const gxs = new Float32Array(width * height)
  const gys = new Float32Array(width * height)

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const tl = gray[i - width - 1], t = gray[i - width], tr = gray[i - width + 1]
      const l = gray[i - 1], r = gray[i + 1]
      const bl = gray[i + width - 1], b = gray[i + width], br = gray[i + width + 1]

      const gx = (tr + 2 * r + br) - (tl + 2 * l + bl)
      const gy = (bl + 2 * b + br) - (tl + 2 * t + tr)

      mag[i] = Math.sqrt(gx * gx + gy * gy)
      gxs[i] = gx
      gys[i] = gy
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

  return { mag, angle, gx: gxs, gy: gys }
}

// ─── The edge field ───────────────────────────────────────────

/**
 * Every pixel that sits on an edge, with the *coarse* brightness step across it.
 *
 * The coarse step is the idea the whole detector rests on. A page border has one
 * surface on one side and a different one on the other, at any scale you care to
 * measure. A table rule or a pen stroke has the same paper a few pixels out on
 * both sides, so measured at that scale it reads as zero and drops out of the
 * problem entirely — rather than merely being outvoted, which is what went wrong
 * before: on a light bench the border is a 30-level step while the form's own
 * rules are 190-level ones, and no amount of weighting rescues that.
 *
 * What is compared either side is not the mean brightness but the *brightest*
 * part of each side, and that detail is what makes the whole thing work on a real
 * form. Ink is subtractive: print darkens paper and never brightens it, so the
 * upper envelope of a strip of paper is the paper itself however much is written
 * on it. Comparing means fails because the two scales collide — a form's margin
 * is about 6px at this resolution and its rows of print are about the same, so a
 * band wide enough to average out the print also reaches past the margin, and the
 * "paper" side of the top border measures darker than the bench. The sign of the
 * step then comes out inverted, and the search confidently locks onto the first
 * table rule instead. The upper envelope has no such conflict: paper reads as
 * paper next to the border and between the letters alike, so a rule or a row of
 * print gives a step of zero while a page border gives its true one.
 *
 * The step is taken along each pixel's own gradient direction, so it is computed
 * once per frame and can then be projected onto any candidate line angle for
 * almost nothing. That is what makes the swept search below affordable.
 *
 * Pixels come out grouped by edge direction, so a search at one angle touches
 * only the pixels that could possibly belong to it.
 */
export function edgeField(gray, mag, angle, gx, gy, width, height, opts = {}) {
  const {
    minMagnitude = 1.4, near = 2, far = 10,
    // Above the frame's noise, not a fixed number of grey levels.
    minStep = Math.max(2.5, 1.8 * noiseFloor(gray, width, height))
  } = opts

  const capacity = width * height
  const xs = new Int16Array(capacity)
  const ys = new Int16Array(capacity)
  const thetas = new Float32Array(capacity)
  const steps = new Float32Array(capacity)
  const nxs = new Float32Array(capacity)
  const nys = new Float32Array(capacity)
  const bins = new Int16Array(capacity)
  const histogram = new Int32Array(ORIENTATION_BINS)
  let count = 0

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      if (mag[i] < minMagnitude) continue

      const rawX = gx[i], rawY = gy[i]
      const length = Math.hypot(rawX, rawY)
      if (length < 1e-6) continue
      const nx = rawX / length, ny = rawY / length

      // Brightest and second brightest either side. The second is used rather
      // than the first so a single hot pixel of sensor noise cannot speak for a
      // whole surface.
      let aheadTop = -1, aheadNext = -1, behindTop = -1, behindNext = -1, taps = 0
      for (let d = near; d <= far; d++) {
        const ax = Math.round(x + nx * d), ay = Math.round(y + ny * d)
        const bx = Math.round(x - nx * d), by = Math.round(y - ny * d)
        if (ax < 0 || ay < 0 || bx < 0 || by < 0) continue
        if (ax >= width || ay >= height || bx >= width || by >= height) continue
        const a = gray[ay * width + ax]
        if (a > aheadTop) { aheadNext = aheadTop; aheadTop = a } else if (a > aheadNext) aheadNext = a
        const b = gray[by * width + bx]
        if (b > behindTop) { behindNext = behindTop; behindTop = b } else if (b > behindNext) behindNext = b
        taps++
      }
      if (taps < 4) continue
      const step = aheadNext - behindNext
      if (step > -minStep && step < minStep) continue

      const bin = Math.min(ORIENTATION_BINS - 1, (angle[i] / PI * ORIENTATION_BINS) | 0)
      xs[count] = x; ys[count] = y
      thetas[count] = angle[i]
      steps[count] = step
      nxs[count] = nx; nys[count] = ny
      bins[count] = bin
      histogram[bin]++
      count++
    }
  }

  // Counting sort into per-direction groups.
  const offsets = new Int32Array(ORIENTATION_BINS + 1)
  for (let b = 0; b < ORIENTATION_BINS; b++) offsets[b + 1] = offsets[b] + histogram[b]
  const cursor = offsets.slice(0, ORIENTATION_BINS)
  const order = new Int32Array(count)
  for (let q = 0; q < count; q++) order[cursor[bins[q]]++] = q

  return { xs, ys, thetas, steps, nxs, nys, count, offsets, order }
}

/**
 * Candidate pairs of roughly-perpendicular page directions, best first. The vote
 * is weighted by |step| rather than by gradient magnitude, so it is cast by
 * surface boundaries rather than by whichever print happens to be densest.
 */
export function dominantDirections(field, maxPairs = 2) {
  const weight = new Float32Array(ORIENTATION_BINS)
  for (let q = 0; q < field.count; q++) {
    const b = Math.min(ORIENTATION_BINS - 1, (field.thetas[q] / PI * ORIENTATION_BINS) | 0)
    weight[b] += Math.abs(field.steps[q])
  }
  return peakPairs(weight, maxPairs)
}

// ─── Dominant orientations ────────────────────────────────────

const ORIENTATION_BINS = 90 // 2 degrees per bin

/**
 * Candidate pairs of roughly-perpendicular edge orientations, best first.
 * @returns {Array<[number, number]> | null} radians in [0, PI)
 */
export function orientationCandidates(mag, angle, minMagnitude = 1.6, maxPairs = 3) {
  const hist = new Float32Array(ORIENTATION_BINS)
  for (let i = 0; i < mag.length; i++) {
    const m = mag[i]
    if (m < minMagnitude) continue
    hist[Math.min(ORIENTATION_BINS - 1, (angle[i] / PI * ORIENTATION_BINS) | 0)] += m
  }
  return peakPairs(hist, maxPairs)
}

/** The single best orientation pair. */
export function dominantOrientations(mag, angle, minMagnitude = 1.6) {
  const pairs = orientationCandidates(mag, angle, minMagnitude, 1)
  return pairs ? pairs[0] : null
}

/** Peaks of a direction histogram, paired with their near-perpendicular partner. */
function peakPairs(weight, maxPairs) {
  // Circular smoothing: 179 degrees and 1 degree are the same direction.
  const smooth = new Float32Array(ORIENTATION_BINS)
  for (let b = 0; b < ORIENTATION_BINS; b++) {
    let sum = 0
    for (let k = -2; k <= 2; k++) {
      sum += weight[(b + k + ORIENTATION_BINS) % ORIENTATION_BINS] * (3 - Math.abs(k))
    }
    smooth[b] = sum
  }

  const peaks = []
  for (let b = 0; b < ORIENTATION_BINS; b++) {
    const prev = smooth[(b - 1 + ORIENTATION_BINS) % ORIENTATION_BINS]
    const next = smooth[(b + 1) % ORIENTATION_BINS]
    if (smooth[b] > 0 && smooth[b] >= prev && smooth[b] >= next) peaks.push({ b, value: smooth[b] })
  }
  peaks.sort((x, y) => y.value - x.value)

  const apart = (i, j) => Math.min((i - j + ORIENTATION_BINS) % ORIENTATION_BINS,
    (j - i + ORIENTATION_BINS) % ORIENTATION_BINS)
  const quarter = ORIENTATION_BINS / 2
  const tolerance = Math.round(24 / 180 * ORIENTATION_BINS)
  const minApart = Math.round(12 / 180 * ORIENTATION_BINS)
  const toRad = b => (b + 0.5) / ORIENTATION_BINS * PI

  const pairs = []
  for (const peak of peaks) {
    if (pairs.length >= maxPairs) break
    if (pairs.some(p => apart(p.bin, peak.b) < minApart)) continue
    let partner = -1, partnerValue = 0
    for (let d = -tolerance; d <= tolerance; d++) {
      const b = (peak.b + quarter + d + ORIENTATION_BINS) % ORIENTATION_BINS
      if (smooth[b] > partnerValue) { partnerValue = smooth[b]; partner = b }
    }
    if (partner === -1 || partnerValue <= 0) continue
    pairs.push({ bin: peak.b, pair: [toRad(peak.b), toRad(partner)] })
  }
  return pairs.length ? pairs.map(p => p.pair) : null
}

// ─── Candidate borders ────────────────────────────────────────

/**
 * Straight borders near a given direction, each carrying its own angle.
 *
 * The angle is swept rather than fixed because opposite edges of a page held at
 * an angle to the camera are not parallel — they converge towards the vanishing
 * point. Forcing a single angle per direction cannot represent that, and a
 * steeply held page was undetectable as a result: the vertical direction's best
 * evidence collapsed because no one angle fitted both sides.
 *
 * Sweeping is nearly free here. The expensive measurement, the coarse step, was
 * computed once per pixel in edgeField; each angle in the sweep only re-projects
 * it, and only over the pixels whose own edge direction could belong.
 *
 * Signs are kept: crossing into the page and crossing back out are opposite
 * transitions, so a page's two borders are opposite-signed peaks. That also makes
 * it irrelevant whether the paper is lighter or darker than the bench.
 */
export function candidateLines(field, width, height, opts = {}) {
  const {
    stepAngle = 3 / 180 * PI,
    tolerance = 5 / 180 * PI,
    maxLines = 16
  } = opts

  const acc = new Float32Array(width + height + 4)
  // Smoothing must not be done in place: acc[b-1] would already hold its own
  // smoothed value, making this a recursive filter with gain above one rather
  // than a three-tap average. It amplifies along the array and manufactures
  // peaks out of nothing, which is exactly what it did.
  const smooth = new Float32Array(width + height + 4)
  const found = []

  // Every angle, rather than a window around a guessed direction. A window is
  // cheaper but cannot work: a page held steeply enough that its far edge is half
  // the width of its near one has its two side borders nearly 40 degrees apart,
  // so wherever the window is centred one of them falls outside it, and that page
  // was simply undetectable. Sweeping everything costs about twice as much in a
  // stage that is not the expensive one.
  for (let theta = 0; theta < PI - 1e-9; theta += stepAngle) {
    const nx = Math.cos(theta), ny = Math.sin(theta)
    const shift = (nx < 0 ? -nx * width : 0) + (ny < 0 ? -ny * height : 0)
    const bins = Math.ceil(Math.abs(nx) * width + Math.abs(ny) * height) + 1
    acc.fill(0, 0, bins)

    // Only the bin lookup folds, since edge directions are stored folded.
    let folded = theta % PI
    if (folded < 0) folded += PI
    const lowBin = Math.floor((folded - tolerance) / PI * ORIENTATION_BINS)
    const highBin = Math.ceil((folded + tolerance) / PI * ORIENTATION_BINS)
    for (let b = lowBin; b <= highBin; b++) {
      const bin = (b + ORIENTATION_BINS) % ORIENTATION_BINS
      for (let k = field.offsets[bin]; k < field.offsets[bin + 1]; k++) {
        const q = field.order[k]
        let diff = Math.abs(field.thetas[q] - folded)
        if (diff > PI / 2) diff = PI - diff
        if (diff > tolerance) continue
        const at = Math.round(field.xs[q] * nx + field.ys[q] * ny + shift)
        if (at < 0 || at >= bins) continue
        // Re-expressed along this line's normal rather than the pixel's own.
        const along = field.nxs[q] * nx + field.nys[q] * ny
        acc[at] += along > 0 ? field.steps[q] : -field.steps[q]
      }
    }

    let ceiling = 0
    smooth[0] = 0
    for (let b = 1; b < bins - 1; b++) {
      const v = acc[b - 1] + 2 * acc[b] + acc[b + 1]
      smooth[b] = v
      const size = v < 0 ? -v : v
      if (size > ceiling) ceiling = size
    }
    if (ceiling <= 0) continue

    for (let b = 2; b < bins - 2; b++) {
      const v = smooth[b]
      if ((v < 0 ? -v : v) < ceiling * 0.08) continue
      if (v > 0 && (v < smooth[b - 1] || v < smooth[b + 1])) continue
      if (v < 0 && (v > smooth[b - 1] || v > smooth[b + 1])) continue
      found.push({ theta, d: b - shift, strength: v < 0 ? -v : v, sign: v > 0 ? 1 : -1 })
    }
  }

  if (!found.length) return []

  // Two lines are the same border if they lie on top of each other where it
  // matters — inside the frame — whatever their angles say.
  // Suppress non-maxima by *position*, so each place in the frame contributes
  // one border at its own best angle. Comparing endpoints instead does not work:
  // across a 30 degree sweep the ends of a line move 60px, so every angle looks
  // like a distinct border and thirteen variants of the same table rule crowd
  // the real one off the shortlist. The midpoint barely moves, so it identifies
  // the border while leaving the angle free.
  found.sort((a, b) => b.strength - a.strength)
  const unique = []
  for (const line of found) {
    const segment = clipToFrame(line, width, height)
    if (!segment) continue
    line.segment = segment
    line.middle = {
      x: (segment[0].x + segment[1].x) / 2,
      y: (segment[0].y + segment[1].y) / 2
    }
    // Same place *and* same direction. Position alone is not enough once every
    // angle is searched: a horizontal line across the middle of the frame and a
    // vertical one down the middle share a midpoint but are not the same border.
    const sameBorder = unique.some(k => {
      if (Math.hypot(k.middle.x - line.middle.x, k.middle.y - line.middle.y) >= 9) return false
      let turn = Math.abs(k.theta - line.theta) % PI
      if (turn > PI / 2) turn = PI - turn
      return turn < 20 / 180 * PI
    })
    if (sameBorder) continue
    unique.push(line)
    if (unique.length >= 40) break
  }
  if (!unique.length) return []

  // Both the strongest borders and the outermost ones, because they are rarely
  // the same. Shortlisting on strength alone is the mistake that made a form on a
  // light bench undetectable: the page border is a 30-level step and the form's
  // own table rules are 190-level ones, so the border never made the list and
  // every hypothesis began at a rule.
  return unique
}

/**
 * Split candidate borders into the page's two sides, and order each set by where
 * it sits across the frame.
 *
 * Assigning by angle rather than searching per direction is what lets the two
 * borders of one side differ by 40 degrees, as they must under real perspective.
 */
export function groupByDirection(lines, baseA, baseB) {
  const gap = (theta, base) => {
    let d = Math.abs(((theta % PI) + PI) % PI - base)
    return d > PI / 2 ? PI - d : d
  }
  const families = [[], []]
  for (const line of lines) {
    const family = gap(line.theta, baseA) <= gap(line.theta, baseB) ? 0 : 1
    families[family].push(line)
  }
  // Position along each family's own axis, so "outermost" means something.
  for (const [index, base] of [[0, baseA], [1, baseB]]) {
    const axisX = Math.cos(base), axisY = Math.sin(base)
    for (const line of families[index]) {
      line.along = line.middle.x * axisX + line.middle.y * axisY
    }
    families[index].sort((a, b) => a.along - b.along)
  }
  return families
}

// ─── Verifying a hypothesis against the image ─────────────────

/**
 * How much of one edge of a candidate quad actually lies on a page border.
 *
 * This is the term that makes the detector robust. Picking the strongest peaks
 * and trusting them is greedy: one wrong pick and the frame is wrong, with no way
 * back — which is why the previous version swung between three pixels and total
 * failure. Instead every plausible quad is measured against the image, and the
 * one with real evidence behind it wins even if its lines were not the strongest.
 *
 * Four things are measured along the edge:
 *
 *   support  — is there an aligned gradient near it at all? A line drawn across
 *              blank bench scores zero.
 *   polarity — do the two sides differ in the same direction all the way along?
 *              A line lying along a row of text does not.
 *   contrast — by how much.
 *   calm     — how textured the strip just outside is. This is the one that
 *              separates the page border from the heavy rule under a form's
 *              header, which is otherwise indistinguishable: both are clean,
 *              high-contrast, perfectly straight steps with support 1.0. What
 *              differs is what lies beyond. Outside the page is bench, which is
 *              smooth. Outside the header rule is more form — title text, more
 *              rules — because content is always inside the page. So the strip
 *              beyond a true border is calm, and the strip beyond an internal
 *              rule is busy.
 *
 * Calm is measured on the grey image rather than on `mag`, deliberately: the
 * gradient magnitudes have been locally normalised, which is what makes a faint
 * edge in shadow findable, but it also flattens exactly the texture difference
 * being looked for here.
 */
export function edgeEvidence(gray, mag, angle, width, height, from, to, opts = {}) {
  const { samples = 32, searchRadius = 3, minMagnitude = 1.2, angleTolerance = 26 / 180 * PI, inside } = opts

  const dx = to.x - from.x, dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 12) return { support: 0, polarity: 0, contrast: 0, seen: 0 }

  // Normal to the edge, and the angle a gradient across it would have. Where the
  // caller knows which side is the page, the normal is turned to face outwards
  // so that "outer" and "inner" mean what they say.
  let nx = -dy / length, ny = dx / length
  if (inside) {
    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2
    if ((mx - inside.x) * nx + (my - inside.y) * ny < 0) { nx = -nx; ny = -ny }
  }
  let normalAngle = Math.atan2(ny, nx)
  if (normalAngle < 0) normalAngle += PI
  if (normalAngle >= PI) normalAngle -= PI

  let supported = 0, seen = 0, stepSum = 0, positive = 0, negative = 0
  let outerTexture = 0, innerTexture = 0
  const band = []

  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples
    const px = from.x + dx * t, py = from.y + dy * t

    let found = false
    for (let r = -searchRadius; r <= searchRadius && !found; r++) {
      const x = Math.round(px + nx * r), y = Math.round(py + ny * r)
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue
      const i2 = y * width + x
      if (mag[i2] < minMagnitude) continue
      let diff = Math.abs(angle[i2] - normalAngle)
      if (diff > PI / 2) diff = PI - diff
      if (diff <= angleTolerance) found = true
    }

    // The step across the edge, at a scale where text and rules do not exist.
    let outer = 0, inner = 0, taps = 0
    for (let d = 4; d <= 9; d++) {
      const ax = Math.round(px + nx * d), ay = Math.round(py + ny * d)
      const bx = Math.round(px - nx * d), by = Math.round(py - ny * d)
      if (ax < 0 || ay < 0 || bx < 0 || by < 0) continue
      if (ax >= width || ay >= height || bx >= width || by >= height) continue
      outer += gray[ay * width + ax]
      inner += gray[by * width + bx]
      taps++
    }
    if (!taps) continue

    seen++
    if (found) supported++
    const step = (outer - inner) / taps
    stepSum += Math.abs(step)
    if (step > 1.5) positive++
    else if (step < -1.5) negative++

    // How busy each side is, out to a distance where a form's next rule or line
    // of print would show up.
    outerTexture += deviation(gray, width, height, px, py, nx, ny, band)
    innerTexture += deviation(gray, width, height, px, py, -nx, -ny, band)
  }

  if (!seen) return { support: 0, polarity: 0, contrast: 0, calm: 0, seen: 0 }
  const outerMad = outerTexture / seen
  const innerMad = innerTexture / seen
  return {
    support: supported / seen,
    // One-sided means a real boundary; balanced means the line is sitting on
    // content rather than on the page's edge.
    polarity: Math.max(positive, negative) / seen,
    contrast: Math.min(1, (stepSum / seen) / 40),
    // Relative, not absolute: what matters is that beyond the border is quieter
    // than the page, whatever the page's own print density happens to be.
    calm: inside ? (innerMad + 4) / (innerMad + outerMad + 8) : 0.5,
    seen
  }
}

/**
 * How much the frame's own noise moves brightness between neighbouring pixels.
 *
 * The threshold for "this is a real step in brightness" has to sit above this,
 * or in poor light a fraction of the noise is mistaken for surface boundaries.
 * There is enough of it to shift the estimate of which way the page runs, which
 * tilts one border by several degrees. Uses a low percentile so that genuine
 * detail in the picture does not inflate it.
 */
export function noiseFloor(gray, width, height) {
  const differences = []
  // A sparse sample: this only needs to be roughly right.
  for (let y = 2; y < height - 2; y += 3) {
    for (let x = 2; x < width - 3; x += 7) {
      differences.push(Math.abs(gray[y * width + x + 1] - gray[y * width + x]))
    }
  }
  if (differences.length < 32) return 0
  differences.sort((a, b) => a - b)
  // The 60th percentile: most of a frame is flat surface, so this lands in the
  // noise rather than on the page's print.
  return differences[Math.floor(differences.length * 0.6)]
}

/** Mean absolute deviation of the grey strip running out from a point. */
function deviation(gray, width, height, px, py, nx, ny, band) {
  band.length = 0
  for (let d = 5; d <= 16; d++) {
    const x = Math.round(px + nx * d), y = Math.round(py + ny * d)
    if (x < 0 || y < 0 || x >= width || y >= height) continue
    band.push(gray[y * width + x])
  }
  if (band.length < 4) return 0
  let mean = 0
  for (const v of band) mean += v
  mean /= band.length
  let mad = 0
  for (const v of band) mad += Math.abs(v - mean)
  return mad / band.length
}

/**
 * The segment of an infinite line that lies inside the frame, so that a single
 * candidate border can be weighed on its own evidence before being combined into
 * quads. Pruning here rather than after combining is what keeps the search
 * affordable: a handful of good lines per direction instead of every product of
 * every candidate.
 */
export function clipToFrame(line, width, height) {
  const nx = Math.cos(line.theta), ny = Math.sin(line.theta)
  // p = d*n + t*(-ny, nx)
  let tMin = -1e9, tMax = 1e9
  const slab = (base, coefficient, limit) => {
    if (Math.abs(coefficient) < 1e-9) return base >= 0 && base <= limit
    const a = -base / coefficient, b = (limit - base) / coefficient
    tMin = Math.max(tMin, Math.min(a, b))
    tMax = Math.min(tMax, Math.max(a, b))
    return true
  }
  if (!slab(line.d * nx, -ny, width)) return null
  if (!slab(line.d * ny, nx, height)) return null
  if (tMax - tMin < 24) return null
  return [
    { x: line.d * nx - tMin * ny, y: line.d * ny + tMin * nx },
    { x: line.d * nx - tMax * ny, y: line.d * ny + tMax * nx }
  ]
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

// ─── Sharpening the result ────────────────────────────────────

/**
 * Re-fit one border to the pixels that actually lie on it.
 *
 * The search works on a 3 degree grid, which on a 220px edge leaves the corners
 * several pixels out even when the right border was found — enough to shave a
 * column off the form. Fitting is also the only way to represent a border that
 * is not quite straight in the way the grid assumes.
 *
 * Total least squares, weighted by step size, so the fit is driven by the strong
 * middle of a border rather than by its ragged ends.
 */
export function refineLine(field, line, from, to, opts = {}) {
  const { band = 4, angleTolerance = 14 / 180 * PI, minPoints = 24 } = opts

  const nx = Math.cos(line.theta), ny = Math.sin(line.theta)
  const dx = to.x - from.x, dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 24) return line
  const ux = dx / length, uy = dy / length

  let folded = line.theta % PI
  if (folded < 0) folded += PI

  let weight = 0, sumX = 0, sumY = 0, points = 0
  const low = Math.floor((folded - angleTolerance) / PI * ORIENTATION_BINS)
  const high = Math.ceil((folded + angleTolerance) / PI * ORIENTATION_BINS)
  const chosen = []

  for (let b = low; b <= high; b++) {
    const bin = (b + ORIENTATION_BINS) % ORIENTATION_BINS
    for (let k = field.offsets[bin]; k < field.offsets[bin + 1]; k++) {
      const q = field.order[k]
      let diff = Math.abs(field.thetas[q] - folded)
      if (diff > PI / 2) diff = PI - diff
      if (diff > angleTolerance) continue
      const px = field.xs[q], py = field.ys[q]
      // Perpendicular distance to the line, and how far along it we are.
      if (Math.abs(px * nx + py * ny - line.d) > band) continue
      const along = (px - from.x) * ux + (py - from.y) * uy
      if (along < -4 || along > length + 4) continue
      // Only pixels stepping the same way as this border, so a rule just inside
      // it cannot drag the fit.
      const facing = field.nxs[q] * nx + field.nys[q] * ny
      const signed = facing > 0 ? field.steps[q] : -field.steps[q]
      if (Math.sign(signed) !== line.sign) continue
      const w = Math.abs(signed)
      chosen.push(q, w)
      weight += w; sumX += px * w; sumY += py * w; points++
    }
  }
  if (points < minPoints || weight <= 0) return line

  const cx = sumX / weight, cy = sumY / weight
  let sxx = 0, syy = 0, sxy = 0
  for (let i = 0; i < chosen.length; i += 2) {
    const q = chosen[i], w = chosen[i + 1]
    const ax = field.xs[q] - cx, ay = field.ys[q] - cy
    sxx += w * ax * ax; syy += w * ay * ay; sxy += w * ax * ay
  }
  // Principal direction of the point cloud; the normal is perpendicular to it.
  const angleOfLine = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const fittedNormal = angleOfLine + PI / 2
  const fx = Math.cos(fittedNormal), fy = Math.sin(fittedNormal)
  // Keep the original normal's orientation, so d and sign stay comparable.
  const flip = (fx * nx + fy * ny) < 0 ? -1 : 1
  const theta = Math.atan2(fy * flip, fx * flip)
  const d = cx * Math.cos(theta) + cy * Math.sin(theta)

  let turned = Math.abs(theta - line.theta) % PI
  if (turned > PI / 2) turned = PI - turned
  // A fit that disagrees this much has locked onto something else.
  if (turned > 10 / 180 * PI || Math.abs(d - line.d) > 7) return line
  return { ...line, theta, d }
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
 * Geometry a page has to satisfy before it is worth measuring. Cheap, so it runs
 * on every hypothesis; the expensive image evidence only runs on survivors.
 */
function geometry(lineA, lineB, width, height, limits) {
  const raw = [
    intersect(lineA[0], lineB[0]), intersect(lineA[0], lineB[1]),
    intersect(lineA[1], lineB[1]), intersect(lineA[1], lineB[0])
  ]
  if (raw.some(p => p === null)) return null

  const marginX = width * limits.outsideMargin, marginY = height * limits.outsideMargin
  if (raw.some(p =>
    p.x < -marginX || p.x > width + marginX ||
    p.y < -marginY || p.y > height + marginY)) return null

  const corners = orderCorners(raw)
  if (!isConvex(corners)) return null

  const areaFraction = polygonArea(corners) / (width * height)
  if (areaFraction < limits.minAreaFraction || areaFraction > limits.maxAreaFraction) return null

  // Opposite sides of a rectangle stay similar even under perspective.
  const top = distance(corners[0], corners[1])
  const right = distance(corners[1], corners[2])
  const bottom = distance(corners[2], corners[3])
  const left = distance(corners[3], corners[0])
  const horizontal = Math.min(top, bottom) / Math.max(top, bottom)
  const vertical = Math.min(left, right) / Math.max(left, right)
  const squareness = Math.min(horizontal, vertical)
  if (squareness < limits.minSquareness) return null

  // Which line each edge came from, in the same order as the corners, so the
  // winner can be re-fitted afterwards.
  const lines = []
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4]
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
    let closest = null, nearest = Infinity
    for (const line of [lineA[0], lineA[1], lineB[0], lineB[1]]) {
      const off = Math.abs(mx * Math.cos(line.theta) + my * Math.sin(line.theta) - line.d)
      if (off < nearest) { nearest = off; closest = line }
    }
    lines.push(closest)
  }

  return { corners, areaFraction, squareness, lines }
}

/**
 * Detects the page quad in a grayscale frame.
 *
 * Hypothesise and verify, rather than pick-the-strongest-and-hope:
 *
 *   1. propose a few candidate edge orientations
 *   2. within each, propose a few candidate borders per direction
 *   3. combine them into quads and discard the geometrically impossible
 *   4. measure what survives against the image, and return the best
 *
 * Step 4 is the important one. Every earlier version of this file was greedy —
 * strongest orientation, strongest two lines — and a form's table rules are long
 * enough and straight enough to win that contest. Measuring means a weak but
 * genuine page border beats a strong table rule, because the rule has paper on
 * both sides and the border does not.
 *
 * @returns {{corners, confidence, areaFraction, support} | null}
 *          corners normalised 0..1, ordered TL, TR, BR, BL
 */
export function detectDocumentQuad(gray, width, height, opts = {}) {
  const {
    minAreaFraction = 0.05,
    // Above 1 is allowed: a page held close legitimately overflows the frame.
    maxAreaFraction = 1.8,
    minMagnitude = 1.4,
    outsideMargin = 0.35,
    minSquareness = 0.42,
    // A quad has to be mostly sitting on real edges. Below this it is a guess.
    minSupport = 0.5,
    // The bar for getting *onto* the shortlist is deliberately lower than the bar
    // for being accepted. A hypothesis comes off a 3 degree search grid, so it can
    // be several pixels out on one side and still be the right border; judging it
    // at full strictness before it has been re-fitted throws away good candidates
    // for being rough. The strict test is applied afterwards, to the sharpened
    // quad, which is the thing actually being returned.
    shortlistSupport = 0.34,
    // A quad this well evidenced is a real boundary rather than a coincidence.
    strongSupport = 0.82,
    strongPolarity = 0.72,
    strongContrast = 0.2,
    minEdgeSupport = 0.5,
    // A page is bounded on all four sides. An edge with no step across it is
    // running over open bench, however good the other three look.
    minEdgeContrast = 0.14,
    // How much worse than the best a quad may score and still be preferred for
    // being further out.
    outerTolerance = 0.8,
    maxMeasured = 24,
    // How close two borders must be, across the page, to be the same border.
    mergeDistance = 5
  } = opts

  if (!gray || !width || !height || gray.length < width * height) return null

  const smoothed = blur3(gray, width, height)
  const { mag, angle, gx, gy } = gradients(smoothed, width, height)
  const field = edgeField(smoothed, mag, angle, gx, gy, width, height, { minMagnitude })
  if (field.count < 150) return null

  const orientations = dominantDirections(field)
  if (!orientations) return null

  const limits = { minAreaFraction, maxAreaFraction, outsideMargin, minSquareness }

  /**
   * Judge each candidate border on its own, collapse the ones that are really the
   * same border, and keep what is worth combining.
   *
   * Collapsing matters more than it sounds. Searching every angle produces a fan
   * of lines through each border — a dozen variants of the page's top edge at
   * angles a few degrees apart. Their midpoints are far apart, so suppressing on
   * position in the frame does not merge them, and the fan then defeats the
   * outermost rule: the variant that happens to sit furthest out is chosen even
   * though it is twelve degrees wrong and a quarter the quality. Suppressing along
   * this family's own axis collapses the fan to its best member, which is what
   * makes outermost mean the outermost *border* rather than the outermost stray
   * angle through it.
   */
  const worthwhile = lines => {
    const judged = []
    for (const line of lines) {
      const e = edgeEvidence(smoothed, mag, angle, width, height, line.segment[0], line.segment[1],
        { minMagnitude: minMagnitude * 0.85 })
      if (!e.seen) continue
      // Contrast enters as a plain factor, with no floor under it. A floor is
      // what let a table rule win: a rule has paper on both sides, so its
      // upper-envelope contrast is nearly nothing, yet a term like
      // (0.45 + 0.55 * contrast) still handed it 0.45 and it outranked a genuine
      // low-contrast border. Support is only half-weighted for the opposite
      // reason: a faint border on a pale bench really does have weak gradients,
      // and demanding strong ones rejects the very case that needs finding.
      judged.push({
        ...line,
        quality: (0.3 + 0.7 * e.support) * (0.3 + 0.7 * e.polarity) * e.contrast
      })
    }
    if (!judged.length) return []

    judged.sort((a, b) => b.quality - a.quality)
    const collapsed = []
    for (const line of judged) {
      if (collapsed.some(k => Math.abs(k.along - line.along) < mergeDistance)) continue
      collapsed.push(line)
    }

    // Relative to the best available, not an absolute bar: a page filling the
    // frame and a page in the middle of one give very different absolute numbers,
    // and each is the best evidence its own frame has to offer.
    const ceiling = collapsed[0].quality
    return collapsed.filter(j => j.quality >= Math.max(ceiling * 0.4, 0.02))
  }

  /**
   * Ways the two opposing borders in one direction might be chosen, widest first.
   * Outermost is not a tie-break: everything printed on a form is inside the
   * form, so the page's border is the outermost real boundary going inwards. That
   * is what stops the heavy rule under a form's header being read as the top of
   * the page — nothing about the rule is wrong, it is simply not outermost.
   */
  const pairings = lines => {
    if (lines.length < 2) return []
    const byPosition = lines.slice().sort((a, b) => a.along - b.along)
    const out = []
    for (let i = 0; i < byPosition.length; i++) {
      for (let j = byPosition.length - 1; j > i; j--) {
        const a = byPosition[i], b = byPosition[j]
        const reach = b.along - a.along
        if (reach < 24) continue
        out.push({ pair: [a, b], matched: a.sign !== b.sign ? 1 : 0, reach })
      }
    }
    out.sort((x, y) => (y.matched - x.matched) || (y.reach - x.reach))
    return out.slice(0, 4).map(o => o.pair)
  }

  const allLines = candidateLines(field, width, height)
  const hypotheses = []
  for (const [thetaA, thetaB] of orientations) {
    const [familyA, familyB] = groupByDirection(allLines, thetaA, thetaB)
    const pairsA = pairings(worthwhile(familyA))
    const pairsB = pairings(worthwhile(familyB))
    for (const pa of pairsA) for (const pb of pairsB) {
      const geo = geometry(pa, pb, width, height, limits)
      if (geo) hypotheses.push(geo)
    }
  }
  if (!hypotheses.length) return null

  // Outermost first, so the first credible quad is the page and the search can
  // stop there. The score decides only when nothing clears the bar.
  hypotheses.sort((x, y) => y.areaFraction - x.areaFraction)

  const measured = []
  for (const h of hypotheses.slice(0, maxMeasured)) {
    const centre = {
      x: h.corners.reduce((t, c) => t + c.x, 0) / 4,
      y: h.corners.reduce((t, c) => t + c.y, 0) / 4
    }
    let support = 0, polarity = 0, contrast = 0, calm = 0, edges = 0
    let weakest = 1, weakestContrast = 1
    for (let i = 0; i < 4; i++) {
      const e = edgeEvidence(smoothed, mag, angle, width, height,
        h.corners[i], h.corners[(i + 1) % 4],
        { minMagnitude: minMagnitude * 0.85, inside: centre })
      // An edge entirely off screen is not evidence either way, so it is skipped
      // rather than counted as a failure — a page held close is a normal frame.
      if (!e.seen) continue
      support += e.support; polarity += e.polarity; contrast += e.contrast; calm += e.calm
      if (e.support < weakest) weakest = e.support
      if (e.contrast < weakestContrast) weakestContrast = e.contrast
      edges++
    }
    if (edges < 2) continue
    support /= edges; polarity /= edges; contrast /= edges; calm /= edges
    if (support < shortlistSupport) continue
    const solid = support >= minSupport && weakest >= minEdgeSupport
    // Every border has to hold up on its own, not on the average. A quad
    // stretching from a stray object on the bench across to the page's far side
    // has two excellent edges and two crossing open bench, and the mean hides it.
    if (weakest < shortlistSupport * 0.6 || weakestContrast < minEdgeContrast) continue

    measured.push({
      ...h,
      support, polarity, contrast, calm, solid,
      score: support ** 2
        * (0.4 + 0.6 * polarity)
        * (0.45 + 0.55 * contrast)
        * (0.4 + 0.6 * calm)
        * (0.85 + 0.15 * h.squareness)
    })
  }
  if (!measured.length) return null

  // Of the quads that stand up, take the outermost — but only among those whose
  // evidence is genuinely comparable to the best on offer.
  //
  // Outermost has to be part of the rule, because the heavy rule under a form's
  // header is a real, crisp, full-width boundary that scores as well as the page
  // border by every measure of boundary quality. Nothing about it is wrong; it is
  // simply not the outermost, and everything printed on a form is inside the form.
  //
  // But it cannot be the whole rule either, or a stray folder on the bench drags
  // the frame out to enclose it. Requiring comparable evidence keeps both in
  // check: a marginally-better inner quad loses to the page, and a far weaker
  // outer one does not win.
  // Quads that already stand up on their own are preferred outright. Only if
  // there are none does a rough one get a chance, and then it has to earn its
  // place after being sharpened. Ordering it this way means the rescue path can
  // only ever add detections, never spoil one that already worked.
  const solid = measured.filter(m => m.solid)
  const pool = solid.length ? solid : measured
  const ceiling = Math.max(...pool.map(m => m.score))
  const contenders = pool.filter(m => m.score >= ceiling * outerTolerance)
  const best = solid.length
    ? contenders.reduce((a, b) => (b.areaFraction > a.areaFraction ? b : a))
    // Nothing convincing, so take the best evidence rather than the widest: this
    // is the path a nearly blank sheet takes, where the search grid leaves every
    // hypothesis a few pixels out and none of them looks solid until re-fitted.
    : pool.reduce((a, b) => (b.score > a.score ? b : a))

  if (!best || best.support < minSupport) return null

  // Sharpen the four borders now that we know which they are. Cheap, because it
  // happens once rather than per hypothesis.
  const sharpened = best.lines.map((line, i) =>
    refineLine(field, line, best.corners[i], best.corners[(i + 1) % 4]))
  const recomputed = [
    intersect(sharpened[3], sharpened[0]), intersect(sharpened[0], sharpened[1]),
    intersect(sharpened[1], sharpened[2]), intersect(sharpened[2], sharpened[3])
  ]
  const fitted = recomputed.every(Boolean) && isConvex(orderCorners(recomputed))
    ? orderCorners(recomputed)
    : null

  const judge = quad => {
    const centre = {
      x: quad.reduce((t, c) => t + c.x, 0) / 4,
      y: quad.reduce((t, c) => t + c.y, 0) / 4
    }
    let support = 0, polarity = 0, contrast = 0, calm = 0, edges = 0, weakest = 1
    for (let i = 0; i < 4; i++) {
      const e = edgeEvidence(smoothed, mag, angle, width, height,
        quad[i], quad[(i + 1) % 4],
        { minMagnitude: minMagnitude * 0.85, inside: centre })
      if (!e.seen) continue
      support += e.support; polarity += e.polarity; contrast += e.contrast; calm += e.calm
      if (e.support < weakest) weakest = e.support
      edges++
    }
    if (!edges) return null
    return {
      quad,
      support: support / edges,
      polarity: polarity / edges,
      contrast: contrast / edges,
      calm: calm / edges,
      weakest
    }
  }

  // The re-fit is kept only if it is actually better. Least squares assumes the
  // points it is given belong to the line, and in a noisy frame some of them do
  // not, which can tilt a border by several degrees. Measuring both and keeping
  // the better one makes sharpening safe by construction.
  const rough = judge(best.corners)
  const sharp = fitted ? judge(fitted) : null
  const chosen = sharp && (!rough || sharp.support >= rough.support - 0.1) ? sharp : rough
  if (!chosen) return null
  const { quad: corners, support, polarity, contrast, calm, weakest } = chosen
  // A rescue candidate has to prove itself now that it has been sharpened. One
  // that was already solid keeps its place: re-fitting cannot make an outline
  // worse than the one it was fitted to, but it can move a corner a few pixels
  // and there is no reason to lose a good detection to that.
  if (!best.solid && (support < minSupport || weakest < minEdgeSupport)) return null

  const confidence = Math.min(1, support ** 2
    * (0.4 + 0.6 * polarity)
    * (0.45 + 0.55 * contrast)
    * (0.4 + 0.6 * calm)
    * (0.85 + 0.15 * best.squareness))

  return {
    corners: corners.map(c => ({ x: c.x / width, y: c.y / height })),
    confidence,
    areaFraction: polygonArea(corners) / (width * height),
    support
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
