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
 * Two brightnesses per candidate: the middle of it, and the band just inside its
 * own border.
 *
 * Both are needed, and the second is the one that makes this work. The whole
 * interior of a cutting mat with a page on it is *mostly the page* — measured over
 * the mat's full area the mean came out at 205 against the page's own 208, so
 * "which of these two is lighter" could not tell them apart at all. The band
 * around the inside of the mat's border is the mat, and that reads 168.
 *
 * Sampled on a grid, bilinear across the corners rather than a true perspective
 * map — which does not matter for sampling, since every point still lands inside.
 */
/**
 * How much of the candidate's outline actually sits on an edge in the picture.
 *
 * The failure this exists for: a quadrilateral that is convex, the right size,
 * the right squareness, and runs diagonally across the middle of the page.
 * Every geometric test passes, because the shape is a perfectly good shape —
 * it is just not the shape of anything in the photograph. Reported with a page
 * on a wooden bench, where the paper could not have been more obvious.
 *
 * Contours are supposed to make that impossible, and mostly do. What gets
 * through is the hull of a contour that wandered: a border broken by a shadow
 * joins the print inside the page, the hull closes over both, and the quad it
 * approximates to cuts the corner.
 *
 * So each side is checked against the pixels. Sample along it, and a few
 * pixels either side of it: a real page border is a step — paper one side,
 * bench the other — and the step keeps the same sign the whole way along. A
 * line across the page interior crosses print, which is a step that changes
 * sign constantly, and white space, which is no step at all.
 *
 * Returns 0..1, the fraction of sampled points that look like a border.
 * Cheap: 4 sides, 14 samples, 2 reads each.
 */
export function edgeSupport(grey, corners, spread = 64) {
  const data = grey.data
  const w = grey.cols, h = grey.rows
  const PER_SIDE = 14
  // Far enough out to clear the blur, close enough to stay on the bench rather
  // than reaching the next object along.
  const REACH = Math.max(2, Math.round(Math.min(w, h) * 0.012))

  // What counts as a step, scaled to how much tonal range the frame has.
  //
  // A fixed 12 was right for a page on wood and wrong for a white form on a
  // white bench, where the border is a genuine but shallow step and a fixed
  // bar rejected the page outright — the detector went from a wrong answer to
  // no answer, which is not an improvement when somebody is holding a phone
  // over a form waiting for an outline.
  //
  // Floored, because in a very flat frame the remaining variation is sensor
  // noise and a threshold below it would call anything a border.
  const STEP = Math.max(7, Math.min(16, spread * 0.18))

  // Whether a side lies along the edge of the picture.
  //
  // There are no pixels beyond it to compare against, so it scores zero
  // however real it is. Counting that sinks every page photographed with an
  // edge out of frame — which is common, deliberate on a big form, and was a
  // 27px regression on the bench the moment this check was added. A side like
  // that is not evidence either way, so it is left out of the count rather
  // than counted as a failure.
  const margin = REACH + 1
  const onFrameEdge = (a, b) =>
    (a.x <= margin && b.x <= margin) || (a.x >= w - margin && b.x >= w - margin)
    || (a.y <= margin && b.y <= margin) || (a.y >= h - margin && b.y >= h - margin)

  const at = (x, y) => {
    const px = Math.min(w - 1, Math.max(0, Math.round(x)))
    const py = Math.min(h - 1, Math.max(0, Math.round(y)))
    return data[py * w + px]
  }

  let supported = 0, counted = 0

  for (let side = 0; side < 4; side++) {
    const a = corners[side]
    const b = corners[(side + 1) % 4]
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1) continue
    if (onFrameEdge(a, b)) continue
    // The outward normal. Corners are ordered clockwise, so rotating the
    // direction of travel by -90° points away from the middle.
    const nx = dy / len, ny = -dx / len

    let sign = 0
    for (let i = 0; i < PER_SIDE; i++) {
      // Skirt the corners: the rounding of a real sheet and the overshoot of
      // approxPolyDP both live there, and neither says anything about the side.
      const t = 0.12 + (0.76 * i) / (PER_SIDE - 1)
      const x = a.x + dx * t, y = a.y + dy * t
      const outside = at(x + nx * REACH, y + ny * REACH)
      const inside = at(x - nx * REACH, y - ny * REACH)
      const step = inside - outside
      counted++
      if (Math.abs(step) < STEP) continue
      // Consistent in sign along the side, or it is print rather than a border.
      const s = Math.sign(step)
      if (sign === 0) sign = s
      else if (s !== sign) continue
      supported++
    }
  }

  // No measurable side — a page framed right to all four edges — is not a
  // reason to reject it. Nothing was measured, so nothing is alleged.
  return counted ? supported / counted : 1
}

function interiorTones(grey, corners) {
  const data = grey.data
  const w = grey.cols, h = grey.rows
  const N = 28
  let coreN = 0, coreSum = 0, ringN = 0, ringSum = 0

  for (let i = 0; i < N; i++) {
    const v = 0.03 + (0.94 * i) / (N - 1)
    for (let j = 0; j < N; j++) {
      const u = 0.03 + (0.94 * j) / (N - 1)
      const topX = corners[0].x + (corners[1].x - corners[0].x) * u
      const topY = corners[0].y + (corners[1].y - corners[0].y) * u
      const botX = corners[3].x + (corners[2].x - corners[3].x) * u
      const botY = corners[3].y + (corners[2].y - corners[3].y) * u
      const x = Math.round(topX + (botX - topX) * v)
      const y = Math.round(topY + (botY - topY) * v)
      if (x < 0 || y < 0 || x >= w || y >= h) continue

      const edge = Math.min(u, 1 - u, v, 1 - v)
      const grey8 = data[y * w + x]
      if (edge >= 0.2) { coreSum += grey8; coreN++ }
      else if (edge <= 0.1) { ringSum += grey8; ringN++ }
    }
  }

  return {
    mean: coreN < 24 ? 0 : coreSum / coreN,
    ring: ringN < 24 ? 0 : ringSum / ringN
  }
}

function inside(polygon, point) {
  let within = false
  for (let i = 0, j = 3; i < 4; j = i++) {
    const a = polygon[i], b = polygon[j]
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      within = !within
    }
  }
  return within
}

const encloses = (outer, inner) => inner.every(p => inside(outer, p))

/** Whether any corner sits on the edge of the picture. */
/**
 * How many of the picture's four edges a candidate runs up against.
 *
 * One is a page held close. Three or four is the surface it is lying on.
 */
export function edgesTouched(corners, width, height, slack = 2) {
  return [
    corners.some(p => p.x <= slack),
    corners.some(p => p.y <= slack),
    corners.some(p => p.x >= width - slack),
    corners.some(p => p.y >= height - slack)
  ].filter(Boolean).length
}

function touchesBorder(corners, width, height, slack = 2) {
  return corners.some(p =>
    p.x <= slack || p.y <= slack || p.x >= width - slack || p.y >= height - slack)
}

/**
 * Which of the frame's quadrilaterals is the page.
 *
 * Taking the largest is the obvious rule and it is what produced "the frame just
 * doesn't really adjust at all to the page on the table". The surface a page is
 * lying on is *always* a bigger quadrilateral than the page — a table shot from
 * above, a cutting mat, a desk — and it is just as four-sided. On the reported
 * photograph the outline sat on the table with its corners off the edges of the
 * picture, and nothing downstream could help: the answer was confidently wrong
 * rather than noisy.
 *
 * Two things separate a page from the thing it is resting on, and neither is size.
 *
 * ENCLOSURE, AND WHICH IS LIGHTER. A surface contains the page; the page contains
 * nothing. So a candidate that encloses another is a surface — but only if the one
 * it encloses is lighter than the *enclosing surface itself*, measured in the band
 * inside its border rather than over its whole interior, which is largely the page.
 * That is what "a sheet of paper is lying on this" looks like.
 *
 * The tone test is load-bearing, not a refinement: a form's inner print box is also
 * enclosed by the page, and the band inside the page's border is paper — the same
 * tone as the box. So this declines to prefer it. Without the test, an older bug
 * would return where the outline snapped to the heavy rule under a form's header.
 *
 * BEING WHOLLY IN THE PICTURE. A quad clipped by the frame's edge cannot be a
 * page that is fully visible, and cropping to it would cut the form off. That
 * makes it wrong to offer whether or not it is the page, so it only wins if
 * nothing else is available.
 *
 * Every tier falls back rather than rejecting outright, so a frame that contains
 * only an awkward candidate still gets an outline instead of nothing.
 */
export function chooseCandidate(candidates, width, height) {
  if (!candidates.length) return null

  const surfaces = new Set()
  for (const outer of candidates) {
    for (const inner of candidates) {
      if (outer === inner) continue
      if (outer.areaFraction <= inner.areaFraction) continue
      // Against the outer's *own* surface — the band inside its border — and not
      // against its whole interior, which is largely the inner candidate.
      //
      // Eight grey levels: enough to tell paper from a bench, small enough that a
      // dim photograph still registers it.
      if (inner.mean <= outer.ring + 8) continue
      if (encloses(outer.corners, inner.corners)) surfaces.add(outer)
    }
  }

  let pool = candidates.filter(c => !surfaces.has(c))
  if (!pool.length) pool = candidates

  const biggest = list =>
    list.reduce((best, c) => (!best || c.areaFraction > best.areaFraction) ? c : best, null)

  // Preferring a candidate that sits wholly inside the picture is right when the
  // alternative is the bench or the desk running off the edges. It is wrong when
  // the page itself does — and the two are told apart by *how many* edges are
  // touched, not by size.
  //
  // A page held close enough to fill the frame, which is what anyone does to get
  // a form legible, overhangs one edge, usually the bottom. A table or a desk
  // runs off three or four. Size cannot separate them: the desk is much the
  // bigger of the two and must still lose.
  //
  // Without this, a page overhanging the bottom was thrown away in favour of the
  // only thing left that touched no edge — the box printed inside the form — so
  // the outline sat inside the paper and the capture cut the bottom off.
  const whollyVisible = pool.filter(c => !touchesBorder(c.corners, width, height))
  const bestVisible = biggest(whollyVisible)

  if (bestVisible) {
    const overhanging = pool.filter(c =>
      c !== bestVisible
      && edgesTouched(c.corners, width, height) <= 1
      && c.areaFraction > bestVisible.areaFraction)
    const page = biggest(overhanging)
    if (page) return page
    pool = whollyVisible
  }

  return biggest(pool)
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
/**
 * How much of a candidate's outline has to sit on a real edge.
 *
 * Just over half. A page on a bench scores high; a page whose bottom edge is
 * in shadow still clears it on the other three sides; a line across the middle
 * of a form does not come close. Set by what separates the two in the scenes,
 * not by taste — raising it further starts rejecting real pages photographed
 * on white.
 */
const MIN_EDGE_SUPPORT = 0.55

export function detectDocument(cv, rgba, width, height, opts = {}) {
  const {
    minAreaFraction = 0.2, minSquareness = 0.45, blur = 5,
    minEdgeSupport = MIN_EDGE_SUPPORT
  } = opts
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
    const spread = deviation.doubleAt(0, 0)
    const contrast = spread / 64 // ~1.0 is a well-lit page

    // An adaptive rung, tried first. Otsu picks the threshold that best separates
    // the frame's own two populations of tone, so on a white form on a white bench
    // — where every fixed threshold is either too high to see the border or low
    // enough to drown in the print — it lands where the border actually is.
    const otsuMask = track(new cv.Mat())
    const otsu = cv.threshold(smoothed, otsuMask, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU)
    const ladder = [[Math.max(6, otsu * 0.33), Math.max(18, otsu)], ...CANNY_LADDER]

    // Every acceptable quadrilateral from every rung, ranked once at the end.
    // Ranking as they arrive cannot work: whether a candidate is the surface under
    // the page is a fact about it *and another candidate*, which may come from a
    // different threshold.
    const candidates = []
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

            // The pixels have the final say. A quad can satisfy every
            // geometric test and still be a line drawn across a photograph.
            const support = edgeSupport(grey, corners, spread)
            if (support < minEdgeSupport) continue

            candidates.push({
              corners,
              areaFraction,
              squareness: shape,
              edgeSupport: support,
              ...interiorTones(grey, corners)
            })
          } finally {
            contour.delete()
          }
        }
      } finally {
        contours.delete()
      }
      // Every rung is tried, and the best answer across all of them wins.
      //
      // This used to stop at the first rung that found anything, on the reasoning
      // that it was the most selective one that could and there was nothing to
      // gain by going looser. That is wrong whenever two candidates exist, and it
      // was the largest single cause of the outline jumping about.
      //
      // Measured on the tilted-bench scene: one rung found the page (area 0.47,
      // 1.3px out) and another found something 25px out (area 0.37). Which rung
      // fired first flipped with the sensor noise, so the outline alternated
      // between the two — a 13% jump every other frame — and once two wrong
      // frames landed in a row the tracker confirmed the jump and sat on the
      // wrong answer. Comparing their areas would have picked the right one
      // every time — the wrong candidate was the *smaller* of the two — but they
      // were never compared, because the loop had already returned.
      //
      // Comparing them costs the remaining rungs on frames that would have exited
      // early. Detection is under a millisecond, so that is affordable and the
      // bench guards it.
    }

    const chosen = chooseCandidate(candidates, width, height)
    if (!chosen) return null
    const normalised = chosen.corners.map(c => ({ x: c.x / width, y: c.y / height }))
    return {
      corners: normalised,
      areaFraction: chosen.areaFraction,
      // Whether the page runs off the picture. Detecting one that does is
      // right — it beats locking onto the box printed inside it — but
      // *photographing* one is not: the missing edge is missing from the sensor,
      // so no amount of dragging a corner afterwards can bring it back.
      offEdge: edgesTouched(chosen.corners, width, height) > 0,

      // What "close enough to capture" is actually judged on.
      fill: fillFraction(normalised, chosen.areaFraction, width / height),
      squareness: chosen.squareness,
      contrast
    }
  } finally {
    for (const mat of open) {
      try { mat.delete() } catch { /* already released */ }
    }
  }
}

/**
 * Whether a set of corners actually sits on edges in this picture.
 *
 * The same check the detector applies to its own candidates, offered
 * separately so the moment of capture can ask it about corners that came from
 * somewhere else — the tracker, a frame a tenth of a second old, a detection
 * on a different image.
 *
 * The case it exists for: auto-capture fires, the still is re-detected, that
 * finds nothing, and the tracked corners stand by default. If those were
 * wrong, the review opens with a quad that has no relationship to the page —
 * reported as the frame "shifting up" on capture. Better to know.
 *
 * @param {Array<{x:number,y:number}>} corners  normalised 0..1
 */
export function cornersAreSupported(cv, rgba, width, height, corners, opts = {}) {
  const { minEdgeSupport = MIN_EDGE_SUPPORT } = opts
  if (!cv || !rgba || !width || !height || corners?.length !== 4) return false

  const open = []
  try {
    const source = cv.matFromImageData({ data: rgba, width, height })
    open.push(source)
    const grey = new cv.Mat()
    open.push(grey)
    cv.cvtColor(source, grey, cv.COLOR_RGBA2GRAY)

    const mean = new cv.Mat(); open.push(mean)
    const deviation = new cv.Mat(); open.push(deviation)
    cv.meanStdDev(grey, mean, deviation)

    const pixels = corners.map(c => ({ x: c.x * width, y: c.y * height }))
    return edgeSupport(grey, pixels, deviation.doubleAt(0, 0)) >= minEdgeSupport
  } catch {
    // Unable to check is not the same as failed. Saying yes here leaves the
    // behaviour exactly as it was before this existed.
    return true
  } finally {
    for (const mat of open) {
      try { mat.delete() } catch { /* already released */ }
    }
  }
}
