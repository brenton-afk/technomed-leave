// ─── Document detection with OpenCV ───────────────────────────────────────────
// Finds the page in a camera frame: the largest four-sided contour that could
// plausibly be a sheet of paper.
//
// This replaces a hand-written detector. That one measured well on synthetic
// scenes and was unusable on a phone, which is worth recording: it projected
// brightness steps onto candidate line angles and picked the best-scoring
// quadrilateral, so its answer was a fresh guess every frame and it moved like
// one. Canny plus findContours is a different proposition — a contour is a
// connected path that either closes around the page or does not, so consecutive
// frames agree with each other far more often, and what disagreement remains is
// small enough for smoothing to absorb.
//
// Every Mat is released. A leak here is not a slow drift: at ten detections a
// second on a phone it exhausts the WASM heap in under a minute and takes the
// tab with it.

/** Ordered TL, TR, BR, BL — the order the perspective transform expects. */
function orderCorners(points) {
  const cx = points.reduce((t, p) => t + p.x, 0) / 4
  const cy = points.reduce((t, p) => t + p.y, 0) / 4
  const byAngle = points.slice().sort((a, b) =>
    Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  let start = 0, best = Infinity
  for (let i = 0; i < 4; i++) {
    const score = byAngle[i].x + byAngle[i].y
    if (score < best) { best = score; start = i }
  }
  return [0, 1, 2, 3].map(i => byAngle[(start + i) % 4])
}

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
    if (Math.abs(cross) < 1e-9) continue
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/**
 * Opposite sides of a rectangle stay comparable under perspective. A shape whose
 * sides are wildly different lengths is a shadow or a bench edge, not paper.
 */
/**
 * How much of the frame the page covers, as a fraction of the most it *could*
 * cover — which is not the same as the fraction of the frame it covers, and
 * conflating the two made auto-capture impossible to satisfy.
 *
 * A portrait A4 page inside a 16:9 landscape camera frame can occupy at most
 * 39.8% of it, however close the phone is held: the page's height is limited by
 * the frame's height, and its width is then fixed by the paper. So asking for
 * "60% of the frame" asked for something no distance could produce — the scanner
 * sat there advising "Move closer" indefinitely and never fired.
 *
 * Measuring against the achievable maximum asks the question that was meant: does
 * the page nearly fill the frame?
 */
function fillFraction(corners, areaFraction, frameAspect) {
  const side = (a, b) => Math.hypot(corners[a].x - corners[b].x, corners[a].y - corners[b].y)
  const pageWidth = (side(0, 1) + side(3, 2)) / 2
  const pageHeight = (side(0, 3) + side(1, 2)) / 2
  if (!pageWidth || !pageHeight || !frameAspect) return 0
  // Corners are normalised, so their aspect has to be put back into the frame's
  // proportions before it can be compared with it.
  const pageAspect = (pageWidth * frameAspect) / pageHeight
  const most = Math.min(pageAspect / frameAspect, frameAspect / pageAspect)
  if (!(most > 0)) return 0
  return Math.min(1, areaFraction / most)
}

function squareness(corners) {
  const side = (a, b) => Math.hypot(corners[a].x - corners[b].x, corners[a].y - corners[b].y)
  const top = side(0, 1), right = side(1, 2), bottom = side(2, 3), left = side(3, 0)
  if (!top || !right || !bottom || !left) return 0
  return Math.min(
    Math.min(top, bottom) / Math.max(top, bottom),
    Math.min(left, right) / Math.max(left, right))
}

/**
 * Canny thresholds, tried in order until a page is found.
 *
 * One pair cannot cover the range. A form on a dark bench has a hard boundary and
 * wants high thresholds so the print inside it does not fragment the contour; the
 * same form on a white bench has a boundary of thirty grey levels and needs low
 * ones or there is no contour at all. Trying a short ladder costs a few
 * milliseconds and is the difference between working on one surface and working
 * on any of them.
 */
const CANNY_LADDER = [
  [75, 200],
  [40, 120],
  [18, 54]
]

/**
 * How far a simplified outline may sit from the contour it came from, as a
 * fraction of the perimeter.
 *
 * Also a ladder, and for a related reason. A page's contour is not a clean
 * rectangle: the edge ridge zig-zags a pixel either way, and where a form's own
 * print runs to the margin it joins the border and adds an excursion. At 2% those
 * came back as twelve- and sixteen-sided polygons and were thrown away as "not a
 * quadrilateral". Loosening until four corners appear keeps the page; starting
 * tight means a shape that really is a clean rectangle is measured as one.
 */
const APPROX_LADDER = [0.02, 0.035, 0.05, 0.08]

/**
 * Four corners from a convex outline, however many vertices it has.
 *
 * The last resort when no epsilon yields exactly four. The extremes of x+y and
 * x-y are the corners of any convex quadrilateral that is not turned close to 45
 * degrees, which a page held to photograph never is.
 */
function extremeCorners(points) {
  let tl = points[0], br = points[0], tr = points[0], bl = points[0]
  for (const p of points) {
    if (p.x + p.y < tl.x + tl.y) tl = p
    if (p.x + p.y > br.x + br.y) br = p
    if (p.x - p.y > tr.x - tr.y) tr = p
    if (p.x - p.y < bl.x - bl.y) bl = p
  }
  const distinct = new Set([tl, br, tr, bl])
  return distinct.size === 4 ? [tl, tr, br, bl] : null
}

/**
 * The four corners of one contour, or null.
 *
 * The hull comes first, and it is the step that made this work. A page is convex,
 * so anything the contour does inward — print touching the margin, a shadow
 * biting into the edge, the ridge wandering — is noise by definition, and taking
 * the hull removes all of it in one operation rather than hoping a threshold
 * avoids it.
 */
function cornersOf(cv, contour, minHullArea) {
  const hull = new cv.Mat()
  try {
    cv.convexHull(contour, hull, false, true)
    if (hull.rows < 4) return null
    // Filtered on the *hull's* area, not the contour's, and that distinction is
    // the whole game. A page border broken anywhere — by a shadow, by print
    // reaching the margin — stops being a closed loop and becomes a ribbon traced
    // out and back, enclosing almost nothing. Filtering on enclosed area threw
    // every one of those away and left the largest survivor being some region
    // *inside* the page: the top edge of the frame kept snapping to the heavy rule
    // under a form's header, because that rule does close. The hull spans what the
    // contour reaches, which is the thing actually being asked about.
    if (cv.contourArea(hull) < minHullArea) return null
    const perimeter = cv.arcLength(hull, true)

    for (const epsilon of APPROX_LADDER) {
      const approx = new cv.Mat()
      try {
        cv.approxPolyDP(hull, approx, epsilon * perimeter, true)
        if (approx.rows === 4) {
          return [0, 1, 2, 3].map(n => ({ x: approx.intAt(n, 0), y: approx.intAt(n, 1) }))
        }
      } finally {
        approx.delete()
      }
    }

    const points = []
    for (let n = 0; n < hull.rows; n++) points.push({ x: hull.intAt(n, 0), y: hull.intAt(n, 1) })
    return extremeCorners(points)
  } finally {
    hull.delete()
  }
}

/**
 * @param {object} cv                the OpenCV module
 * @param {Uint8ClampedArray|Uint8Array} rgba  frame pixels, 4 bytes per pixel
 * @param {number} width, height     frame size
 * @param {object} [opts]
 * @param {number} [opts.minAreaFraction]  ignore anything smaller (default 0.2)
 * @returns {{corners, areaFraction, squareness, contrast}|null}
 *          corners normalised 0..1, ordered TL TR BR BL
 */
export function detectDocument(cv, rgba, width, height, opts = {}) {
  const { minAreaFraction = 0.2, minSquareness = 0.45, blur = 5 } = opts
  if (!cv || !rgba || !width || !height) return null

  const frameArea = width * height
  const open = []
  const track = mat => { open.push(mat); return mat }

  try {
    const source = track(cv.matFromArray
      ? cv.matFromImageData({ data: rgba, width, height })
      : null)
    if (!source) return null

    const grey = track(new cv.Mat())
    cv.cvtColor(source, grey, cv.COLOR_RGBA2GRAY)

    // Blur before Canny, or sensor noise in poor light becomes edges of its own
    // and the page's contour never closes.
    const smoothed = track(new cv.Mat())
    cv.GaussianBlur(grey, smoothed, new cv.Size(blur, blur), 0, 0, cv.BORDER_DEFAULT)

    // How much tonal range the frame has, for deciding whether it is worth
    // capturing automatically. A frame this flat is either dark or blown out.
    const mean = track(new cv.Mat())
    const deviation = track(new cv.Mat())
    cv.meanStdDev(grey, mean, deviation)
    const contrast = deviation.doubleAt(0, 0) / 64 // ~1.0 is a well-lit page

    // An adaptive rung, tried first. Otsu picks the threshold that best separates
    // the frame's own two populations of tone, so on a white form on a white bench
    // — where every fixed threshold is either too high to see the border or low
    // enough to drown in the print — it lands where the border actually is.
    const otsuMask = track(new cv.Mat())
    const otsu = cv.threshold(smoothed, otsuMask, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU)
    const ladder = [[Math.max(6, otsu * 0.33), Math.max(18, otsu)], ...CANNY_LADDER]

    let best = null
    for (const [low, high] of ladder) {
      const edges = track(new cv.Mat())
      cv.Canny(smoothed, edges, low, high, 3, false)

      // Close small gaps, so a border broken by a shadow or a staple still forms
      // one path rather than several.
      const kernel = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)))
      cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel)

      const contours = new cv.MatVector()
      const hierarchy = track(new cv.Mat())
      cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)

      try {
        for (let i = 0; i < contours.size(); i++) {
          const contour = contours.get(i)
          try {
            // Cheap rejection before the hull: a contour shorter than one side of
            // the smallest acceptable page cannot bound one.
            if (cv.arcLength(contour, false) < Math.min(width, height) * Math.sqrt(minAreaFraction)) continue

            const found = cornersOf(cv, contour, frameArea * minAreaFraction)
            if (!found) continue
            const corners = orderCorners(found)
            if (!isConvex(corners)) continue

            const areaFraction = polygonArea(corners) / frameArea
            if (areaFraction < minAreaFraction || areaFraction > 1.02) continue
            const shape = squareness(corners)
            if (shape < minSquareness) continue

            if (!best || areaFraction > best.areaFraction) {
              best = { corners, areaFraction, squareness: shape }
            }
          } finally {
            contour.delete()
          }
        }
      } finally {
        contours.delete()
      }
      // The first threshold that finds a page is the most selective one that
      // could, so there is nothing to gain by going looser.
      if (best) break
    }

    if (!best) return null
    const normalised = best.corners.map(c => ({ x: c.x / width, y: c.y / height }))
    return {
      corners: normalised,
      areaFraction: best.areaFraction,
      // What "close enough to capture" is actually judged on.
      fill: fillFraction(normalised, best.areaFraction, width / height),
      squareness: best.squareness,
      contrast
    }
  } finally {
    for (const mat of open) {
      try { mat.delete() } catch { /* already released */ }
    }
  }
}
