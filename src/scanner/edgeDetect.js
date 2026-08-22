// ─── Live document edge detection ─────────────────────────────────────────────
// Finds the page in front of the camera so the capture frame can follow it,
// instead of showing a fixed guide that rarely matches what you are holding.
//
// Deliberately no OpenCV/wasm: a usage form is a light rectangle on a darker
// bench, which is the one case a simple approach handles well. The steps are
//
//   luminance → Otsu threshold → largest bright blob → its four extreme corners
//
// and everything here is a pure function over a grayscale array, so it can be
// tested without a camera or a canvas.

/**
 * Otsu's method: picks the threshold that best separates the histogram into two
 * classes. Chosen over a fixed cut-off because bench lighting varies wildly
 * between a theatre corridor and a car boot.
 */
export function otsuThreshold(gray) {
  const histogram = new Uint32Array(256)
  for (let i = 0; i < gray.length; i++) histogram[gray[i]]++

  const total = gray.length
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * histogram[t]

  let sumBackground = 0, weightBackground = 0, best = 0, bestVariance = -1
  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t]
    if (weightBackground === 0) continue
    const weightForeground = total - weightBackground
    if (weightForeground === 0) break

    sumBackground += t * histogram[t]
    const meanBackground = sumBackground / weightBackground
    const meanForeground = (sum - sumBackground) / weightForeground
    const between = weightBackground * weightForeground
      * (meanBackground - meanForeground) * (meanBackground - meanForeground)
    if (between > bestVariance) { bestVariance = between; best = t }
  }
  return best
}

/**
 * Largest 4-connected run of pixels above the threshold. Iterative flood fill —
 * a recursive one blows the stack on a full-frame page.
 * @returns {{ size: number, label: Int32Array, id: number } | null}
 */
export function largestBrightBlob(gray, width, height, threshold) {
  const label = new Int32Array(width * height).fill(-1)
  const stack = new Int32Array(width * height)
  let bestId = -1, bestSize = 0, nextId = 0

  for (let start = 0; start < gray.length; start++) {
    if (gray[start] <= threshold || label[start] !== -1) continue
    const id = nextId++
    let top = 0, size = 0
    stack[top++] = start
    label[start] = id

    while (top > 0) {
      const p = stack[--top]
      size++
      const x = p % width, y = (p - x) / width
      // 4-connectivity is enough and roughly twice as fast as 8.
      if (x > 0) { const n = p - 1; if (gray[n] > threshold && label[n] === -1) { label[n] = id; stack[top++] = n } }
      if (x < width - 1) { const n = p + 1; if (gray[n] > threshold && label[n] === -1) { label[n] = id; stack[top++] = n } }
      if (y > 0) { const n = p - width; if (gray[n] > threshold && label[n] === -1) { label[n] = id; stack[top++] = n } }
      if (y < height - 1) { const n = p + width; if (gray[n] > threshold && label[n] === -1) { label[n] = id; stack[top++] = n } }
    }

    if (size > bestSize) { bestSize = size; bestId = id }
  }

  return bestId === -1 ? null : { size: bestSize, label, id: bestId }
}

function polygonArea(corners) {
  let area = 0
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length]
    area += a.x * b.y - b.x * a.y
  }
  return Math.abs(area) / 2
}

// The corner search works by taking the extreme blob pixels along a pair of
// perpendicular axes. Which pair matters: the diagonal pair nails an
// axis-aligned page but collapses to a line on one rotated 45°, and the
// horizontal/vertical pair does the reverse. So several rotations are tried and
// the one that best explains the blob wins — that is what lets the frame track
// a page held at any angle.
const CORNER_SEARCH_ANGLES = 8

// How completely the blob must fill the quad its own corners describe.
const MIN_QUAD_FILL = 0.78

/** Extreme points along one rotated basis, ordered clockwise from top-left. */
function cornersForBasis(label, id, width, height, angle) {
  const ux = Math.cos(angle), uy = Math.sin(angle)
  const vx = -Math.sin(angle), vy = Math.cos(angle)

  let maxU = -Infinity, minU = Infinity, maxV = -Infinity, minV = Infinity
  let pMaxU = null, pMinU = null, pMaxV = null, pMinV = null

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (label[row + x] !== id) continue
      const u = x * ux + y * uy
      const v = x * vx + y * vy
      if (u > maxU) { maxU = u; pMaxU = { x, y } }
      if (u < minU) { minU = u; pMinU = { x, y } }
      if (v > maxV) { maxV = v; pMaxV = { x, y } }
      if (v < minV) { minV = v; pMinV = { x, y } }
    }
  }
  if (!pMaxU || !pMinU || !pMaxV || !pMinV) return null

  const points = [pMinU, pMinV, pMaxU, pMaxV]
  const cx = points.reduce((s, p) => s + p.x, 0) / 4
  const cy = points.reduce((s, p) => s + p.y, 0) / 4
  // Order around the centroid, then rotate so the top-left comes first.
  points.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  let startIndex = 0, best = Infinity
  for (let i = 0; i < 4; i++) {
    const score = points[i].x + points[i].y
    if (score < best) { best = score; startIndex = i }
  }
  return [0, 1, 2, 3].map(i => points[(startIndex + i) % 4])
}

/**
 * The four corners of a blob. Tries several basis rotations and keeps the
 * candidate whose quadrilateral best contains the blob, so the result is
 * correct for a page at any angle rather than only an upright one.
 *
 * @returns {Array<{x:number,y:number}>|null} TL, TR, BR, BL
 */
export function extremeCorners(label, id, width, height, blobSize = null) {
  let bestCorners = null, bestFill = -Infinity

  for (let i = 0; i < CORNER_SEARCH_ANGLES; i++) {
    const angle = (Math.PI / 2) * (i / CORNER_SEARCH_ANGLES)
    const corners = cornersForBasis(label, id, width, height, angle)
    if (!corners) continue

    const area = polygonArea(corners)
    if (area < 1) continue // degenerate: this basis collapsed the quad

    // Without a blob size to compare against, the largest quad is the best
    // guess; with one, prefer the quad the blob actually fills.
    if (blobSize == null) {
      if (area > bestFill) { bestFill = area; bestCorners = corners }
      continue
    }
    const fill = blobSize / area
    // A quad smaller than its own blob is not describing the shape at all
    // (a cross, say, whose extremes only trace one arm).
    if (fill > 1.12) continue
    if (fill > bestFill) { bestFill = fill; bestCorners = corners }
  }

  return bestCorners
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Detects the page quad in a grayscale frame.
 *
 * @param {Uint8Array|Uint8ClampedArray} gray  one byte per pixel
 * @param {number} width
 * @param {number} height
 * @param {{minAreaFraction?: number, maxAreaFraction?: number, minContrast?: number}} [opts]
 * @returns {{ corners: Array<{x:number,y:number}>, confidence: number, areaFraction: number } | null}
 *          corners are normalised 0..1 and ordered TL, TR, BR, BL
 */
export function detectDocumentQuad(gray, width, height, opts = {}) {
  const {
    // Below this the "page" is probably a highlight or a sticker; above it we
    // are looking at a wall or an overexposed frame, not an edge.
    minAreaFraction = 0.10,
    maxAreaFraction = 0.97,
    // Otsu always returns a split, even for a flat grey wall. Requiring real
    // separation between the two classes is what "reasonable contrast" means.
    minContrast = 26
  } = opts

  if (!gray || !width || !height) return null

  const threshold = otsuThreshold(gray)

  // Mean of each class, to measure how genuinely separated they are.
  let sumLow = 0, countLow = 0, sumHigh = 0, countHigh = 0
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] > threshold) { sumHigh += gray[i]; countHigh++ }
    else { sumLow += gray[i]; countLow++ }
  }
  if (!countLow || !countHigh) return null
  const contrast = (sumHigh / countHigh) - (sumLow / countLow)
  if (contrast < minContrast) return null

  const blob = largestBrightBlob(gray, width, height, threshold)
  if (!blob) return null

  const frameArea = width * height
  if (blob.size / frameArea < minAreaFraction) return null

  const corners = extremeCorners(blob.label, blob.id, width, height, blob.size)
  if (!corners) return null

  const quadArea = polygonArea(corners)
  const areaFraction = quadArea / frameArea
  if (areaFraction < minAreaFraction || areaFraction > maxAreaFraction) return null

  // A page is convex and roughly rectangular. If the blob fills its own quad
  // poorly, it is an irregular shape (a hand, a shadow) rather than paper.
  // A real page fills its own quad almost completely — around 0.97 even when
  // skewed, since its four corners *are* the extreme points. Anything much
  // lower is an irregular bright shape (a hand, a shadow, a window) whose
  // extremes happen to form a quad. Above 1 the quad fails to enclose its own
  // blob, so the corners are simply wrong.
  const fill = blob.size / quadArea
  if (fill < MIN_QUAD_FILL || fill > 1.12) return null

  // Opposite sides should be similar lengths. Rejects wedge shapes that are
  // clearly not a rectangle seen at an angle.
  const top = distance(corners[0], corners[1])
  const right = distance(corners[1], corners[2])
  const bottom = distance(corners[2], corners[3])
  const left = distance(corners[3], corners[0])
  const horizontalRatio = Math.min(top, bottom) / Math.max(top, bottom)
  const verticalRatio = Math.min(left, right) / Math.max(left, right)
  if (horizontalRatio < 0.45 || verticalRatio < 0.45) return null

  // Reported so the UI can show a settled frame differently from a guess.
  const confidence = Math.min(1,
    Math.max(0, (fill - MIN_QUAD_FILL) / (1 - MIN_QUAD_FILL)) * 0.5 +
    Math.min(horizontalRatio, verticalRatio) * 0.5
  )

  return {
    corners: corners.map(c => ({ x: c.x / width, y: c.y / height })),
    confidence,
    areaFraction
  }
}

/**
 * Exponential smoothing between frames. Detection jitters by a pixel or two
 * every frame; without this the overlay shivers even on a still page.
 */
export function smoothQuad(previous, next, alpha = 0.35) {
  if (!previous) return next
  if (!next) return null
  return {
    ...next,
    corners: next.corners.map((c, i) => ({
      x: previous.corners[i].x + (c.x - previous.corners[i].x) * alpha,
      y: previous.corners[i].y + (c.y - previous.corners[i].y) * alpha
    }))
  }
}

/** RGBA from a canvas → one luminance byte per pixel. */
export function toGrayscale(rgba, width, height) {
  const gray = new Uint8Array(width * height)
  for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
    // Rec. 601 luma; integer maths, called on every frame.
    gray[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8
  }
  return gray
}
