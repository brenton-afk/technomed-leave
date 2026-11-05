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
  return edgeSupportDetail(grey, corners, spread).support
}

/** The same, with the weakest measurable side alongside the average. */
export function edgeSupportDetail(grey, corners, spread = 64) {
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
  // The weakest side, as well as the average. "You still need to be better"
  // (Brent, 3 Nov 2026): an outline whose top and right lay on the page and
  // whose left ran across bare wood to the corner of the picture passed on
  // the average — three strong sides carried one that sat on nothing. A page
  // has four real edges; every one that can be measured has to be there.
  let weakest = 1
  // And the side with the least of *anything* under it. A side can score
  // weakly for two opposite reasons: print running up to the border flips the
  // step's direction (busy — it is the page), or there is no step at all
  // (empty — it runs across bare wood or shadow). Only the second says the
  // quad is wrong, so only it counts against a quad in the ranking.
  let emptiest = 1

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
    let sideSupported = 0
    let sideActive = 0
    let sideCounted = 0
    for (let i = 0; i < PER_SIDE; i++) {
      // Skirt the corners: the rounding of a real sheet and the overshoot of
      // approxPolyDP both live there, and neither says anything about the side.
      const t = 0.12 + (0.76 * i) / (PER_SIDE - 1)
      const x = a.x + dx * t, y = a.y + dy * t
      const outside = at(x + nx * REACH, y + ny * REACH)
      const inside = at(x - nx * REACH, y - ny * REACH)
      // Under glare there is nothing to measure: the light has flattened
      // paper and bench alike to white. Like a side along the frame's edge,
      // that is no evidence either way, so it is not counted — or the right
      // outline of a page with glare across one corner scores as though that
      // side ran across bare steel (Aimee, RHH, 4 Nov 2026).
      // Near white outside a bright inside is the glare's core. (Its softer
      // halo was tried too: it excused real sides on pale steel and made the
      // outline less steady, so it is not.)
      if (outside >= GLARE && inside >= 200) continue
      const step = inside - outside
      counted++
      sideCounted++
      if (Math.abs(step) < STEP) continue
      sideActive++
      // Consistent in sign along the side, or it is print rather than a border.
      const s = Math.sign(step)
      if (sign === 0) sign = s
      else if (s !== sign) continue
      supported++
      sideSupported++
    }
    // A side mostly lost to glare is judged on what can be seen of it, and
    // only if enough can be.
    if (sideCounted < PER_SIDE * 0.35) continue
    weakest = Math.min(weakest, sideSupported / sideCounted)
    emptiest = Math.min(emptiest, sideActive / sideCounted)
  }

  // No measurable side — a page framed right to all four edges — is not a
  // reason to reject it. Nothing was measured, so nothing is alleged.
  if (!counted) return { support: 1, weakest: 1, emptiest: 1 }
  // A side with almost nothing under it sinks the quad, whatever the others do.
  const average = supported / counted
  return { support: weakest < WEAKEST_SIDE ? Math.min(weakest, average) : average, weakest, emptiest }
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

/**
 * Whether the outline is a page that genuinely runs off the picture.
 *
 * "The scanner kept advising her to step back as the full page wasn't in view
 * when it was." — Aimee, via Brent, 3 Nov 2026.
 *
 * It used to say so whenever any one corner came within two pixels of the
 * edge of the 240-pixel detection frame — under one percent. That is exactly
 * where a corner sits when somebody fills the screen with the form to get a
 * sharp scan, which is what they should be doing.
 *
 * What a page cut off by the frame actually looks like is different: its
 * outline runs *along* the frame's edge, so one side has both ends on the same
 * border; or a corner is missing altogether, which leaves two corners pressed
 * against the borders. One corner near an edge is neither.
 */
export function clippedByFrame(corners, width, height, slack = 2) {
  const on = p => ({
    left: p.x <= slack, top: p.y <= slack,
    right: p.x >= width - 1 - slack, bottom: p.y >= height - 1 - slack
  })
  const flags = corners.map(on)
  for (let i = 0; i < 4; i++) {
    const a = flags[i]
    const b = flags[(i + 1) % 4]
    if ((a.left && b.left) || (a.top && b.top) || (a.right && b.right) || (a.bottom && b.bottom)) return true
  }
  const pressed = flags.filter(f => f.left || f.top || f.right || f.bottom).length
  return pressed >= 2
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

  // Biggest, but a side with little under it counts against it. The page and
  // a wedge of table or shadow beside it make a bigger quad than the page
  // alone — and it was winning on size, with one side lying across bare wood
  // (Brent's photograph, 3 Nov 2026). A candidate whose weakest side is thin
  // ranks at a little over half its size, so the true page beats it.
  // On a sliding scale rather than a step: a side scoring around the line
  // would otherwise flip a quad's rank from frame to frame with the sensor
  // noise, and the outline with it ("print to the edge" on the bench jumped
  // 18% of the frame between the page and the box printed inside it).
  const weight = c => c.areaFraction * (0.4 + 0.6 * Math.min(1, (c.filledSide ?? 1) / FILLED_SIDE) ** 2)
  const biggest = list =>
    list.reduce((best, c) => (!best || weight(c) > weight(best)) ? c : best, null)

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
    // Genuinely overhanging — touching exactly one edge of the picture — and
    // bigger by the same weighting as everything else. It took any quad
    // touching *at most* one edge, so a wholly visible one with a bare side
    // (page plus a wedge of shadow) came back in through here on raw size.
    const overhanging = pool.filter(c =>
      c !== bestVisible
      && edgesTouched(c.corners, width, height) === 1
      && weight(c) > weight(bestVisible))
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
// Brighter than any paper: glare, where nothing can be measured.
const GLARE = 248
// Brighter round a corner than paper ever is, on average: glare.
const CORNER_GLARE = 243

// ─── Re-fitting a nearly right quad ───────────────────────────────────────────
// On a stainless bench the traced outline is often right on three sides and
// wrong on one: glare has washed out a stretch of edge, so the contour cut
// across to the wrong corner, or a seam in the steel ran into the border and
// was followed. The page's real edges are still there for most of their
// length. So each side is searched for, along its own normal, as the
// strongest step with paper on the inside, sample by sample; the samples that
// find nothing (glare) are dropped, a robust line is fitted through the rest
// (so a seam crossing it is one outlier, not a bend), and the four lines are
// intersected into new corners.

const MAX_REFINES = 8
const LINE_TOL = 2.5

/**
 * Whether another good candidate for the same page puts a corner somewhere
 * else. On a clean frame every way of finding the page agrees to a pixel or
 * two; where glare has erased part of an edge they disagree about the corner
 * it hid, and that disagreement is the honest measure of how well the corner
 * is known (a random steel scene: three readings of one corner, 18px apart,
 * and the one chosen fired the shutter 10px out).
 *
 * The same page means three corners agree — not the box printed inside the
 * form, which differs at all four.
 */
function disputed(chosen, candidates, width) {
  const near = width * 0.025, far = width * 0.04
  return candidates.some(c => {
    if (c === chosen || c.edgeSupport < chosen.edgeSupport - 0.15) return false
    const gaps = c.corners.map((p, i) => Math.hypot(p.x - chosen.corners[i].x, p.y - chosen.corners[i].y))
    return gaps.filter(g => g <= near).length === 3 && gaps.some(g => g > far)
  })
}

/** Whether the pixels around a corner are blown out to near white. */
function cornerInGlare(grey, corner) {
  const data = grey.data
  const w = grey.cols, h = grey.rows
  const r = Math.max(2, Math.round(Math.min(w, h) * 0.02))
  let total = 0, count = 0
  for (let y = Math.round(corner.y) - r; y <= Math.round(corner.y) + r; y++) {
    for (let x = Math.round(corner.x) - r; x <= Math.round(corner.x) + r; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      total += data[y * w + x]
      count++
    }
  }
  return count > 0 && total / count >= CORNER_GLARE
}

/** A line through points, robust to a minority that are wrong. */
function robustLine(points, tolerance) {
  if (points.length < 4) return null
  let best = null
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i], b = points[j]
      const dx = b.x - a.x, dy = b.y - a.y
      const len = Math.hypot(dx, dy)
      if (len < 4) continue
      const nx = -dy / len, ny = dx / len
      const c = nx * a.x + ny * a.y
      let count = 0
      for (const p of points) if (Math.abs(nx * p.x + ny * p.y - c) <= tolerance) count++
      if (!best || count > best.count) best = { nx, ny, c, count }
    }
  }
  if (!best) return null
  // Least squares over the agreeing points: the direction of most spread.
  const inliers = points.filter(p => Math.abs(best.nx * p.x + best.ny * p.y - best.c) <= tolerance)
  const mx = inliers.reduce((t, p) => t + p.x, 0) / inliers.length
  const my = inliers.reduce((t, p) => t + p.y, 0) / inliers.length
  let sxx = 0, syy = 0, sxy = 0
  for (const p of inliers) { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my) }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const nx = -Math.sin(angle), ny = Math.cos(angle)
  return { nx, ny, c: nx * mx + ny * my, inliers: inliers.length }
}

/**
 * The quad with each side moved onto the page edge nearest it, or null when
 * the edges are not there to be found.
 *
 * @param grey  a single-channel cv.Mat
 */
export function refineQuad(grey, corners, spread = 64) {
  const data = grey.data
  const w = grey.cols, h = grey.rows
  const short = Math.min(w, h)
  const REACH = Math.max(6, Math.round(short * 0.14))
  const STEP = Math.max(6, Math.min(14, spread * 0.15))
  const SAMPLES = 24
  const at = (x, y) => {
    const px = Math.min(w - 1, Math.max(0, Math.round(x)))
    const py = Math.min(h - 1, Math.max(0, Math.round(y)))
    return data[py * w + px]
  }
  // The middle value of six pixels of a profile. A median, not a mean: a
  // printed rule two pixels thick is a minority of the strip and drops out,
  // where in a mean it reads as a darker region — that is, as a border.
  const six = new Float64Array(6)
  const median6 = (profile, from, dir) => {
    for (let k = 0; k < 6; k++) six[k] = profile[from + dir * k]
    six.sort()
    return (six[2] + six[3]) / 2
  }
  // Each sample's pixels along the normal, read once.
  const PAD = 8
  const profile = new Float64Array(2 * (REACH + PAD) + 1)
  const ZERO = REACH + PAD

  // The paper's own tone: the middle of what the quad encloses, which is
  // mostly paper whatever is printed on it.
  const cx = corners.reduce((t, c) => t + c.x, 0) / 4
  const cy = corners.reduce((t, c) => t + c.y, 0) / 4
  const tones = []
  for (const c of corners) {
    for (let f = 0.15; f <= 0.75; f += 0.15) tones.push(at(cx + (c.x - cx) * f, cy + (c.y - cy) * f))
  }
  tones.sort((p, q) => p - q)
  const paper = tones[Math.floor(tones.length * 0.6)]
  const PAPER_TOL = Math.max(10, spread * 0.2)

  const lines = []
  for (let side = 0; side < 4; side++) {
    const a = corners[side], b = corners[(side + 1) % 4]
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 8) return null
    const nx = dy / len, ny = -dx / len // outward
    const found = []
    for (let i = 0; i < SAMPLES; i++) {
      const t = 0.06 + (0.88 * i) / (SAMPLES - 1)
      const x = a.x + dx * t, y = a.y + dy * t
      // The nearest place to the side as drawn where paper meets something
      // darker that stays darker. Glare is brighter than paper, so its rim
      // never qualifies; a stretch washed out by it finds nothing, and is
      // left to the rest of the side.
      for (let k = -ZERO; k <= ZERO; k++) profile[k + ZERO] = at(x + nx * k, y + ny * k)
      let pick = null
      for (let d = 0; d <= REACH && !pick; d++) {
        for (const off of d ? [d, -d] : [0]) {
          const qx = x + nx * off, qy = y + ny * off
          if (qx < 1 || qy < 1 || qx > w - 2 || qy > h - 2) continue
          const inside = median6(profile, ZERO + off - 1, -1)
          if (Math.abs(inside - paper) > PAPER_TOL) continue
          const outside = median6(profile, ZERO + off + 2, 1)
          if (paper - outside < STEP) continue
          pick = { x: qx, y: qy, off }
          break
        }
      }
      if (!pick) continue
      // Settle on the steepest point of that step, within a pixel or two.
      let bestStep = -Infinity, bx = pick.x, by = pick.y
      for (let k = -2; k <= 2; k++) {
        const qx = pick.x + nx * k, qy = pick.y + ny * k
        const g = at(qx - nx, qy - ny) - at(qx + nx, qy + ny)
        if (g > bestStep) { bestStep = g; bx = qx; by = qy }
      }
      found.push({ x: bx, y: by })
    }
    const line = robustLine(found, LINE_TOL)
    // Most of a side has to agree on where the edge is, or there is no edge.
    if (!line || line.inliers < SAMPLES * 0.4) return null
    lines.push(line)
  }

  const meet = (p, q) => {
    const det = p.nx * q.ny - p.ny * q.nx
    if (Math.abs(det) < 1e-6) return null
    return { x: (p.c * q.ny - p.ny * q.c) / det, y: (p.nx * q.c - p.c * q.nx) / det }
  }
  const out = []
  for (let i = 0; i < 4; i++) {
    const c = meet(lines[(i + 3) % 4], lines[i])
    if (!c || c.x < -2 || c.y < -2 || c.x > w + 1 || c.y > h + 1) return null
    out.push({ x: Math.min(w - 1, Math.max(0, c.x)), y: Math.min(h - 1, Math.max(0, c.y)) })
  }
  return orderCorners(out)
}
const REGION_CLOSE = 7

// See `confident` in detectDocument. Measured on the bench, with noise.
const CONFIDENT_SIDE = 0.65
const BUSY_SIDE = 0.9
// The least any one measurable side may have. Lower than the average bar, so
// a real side broken by a shadow or a staple still stands.
const WEAKEST_SIDE = 0.1
// How much of its length a side needs *something* under it — any step at
// all — before it counts as fully on the page. Below this a quad still
// stands, but ranks lower (see chooseCandidate). Measured: a true page with
// print to its border is ~1.0; a page-plus-shadow wedge on Brent's table was
// 0.43; the box printed inside a form, 0.36.
const FILLED_SIDE = 0.6

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

    // One contour, judged: the same tests whichever way it was found.
    const consider = (contour, { wholeOnly = false } = {}) => {
      // Cheap rejection before the hull: a contour shorter than one side of
      // the smallest acceptable page cannot bound one.
      if (cv.arcLength(contour, false) < Math.min(width, height) * Math.sqrt(minAreaFraction)) return

      const found = cornersOf(cv, contour, frameArea * minAreaFraction)
      if (!found) return
      const corners = orderCorners(found)
      if (!isConvex(corners)) return
      // A region is only a page if it is wholly in view: the background is a
      // region too, and it runs to the edges of the picture, where no side
      // can be checked against anything. Pages cut off by the frame are left
      // to the traced edges, which handle them.
      if (wholeOnly && touchesBorder(corners, width, height, 3)) return

      const areaFraction = polygonArea(corners) / frameArea
      if (areaFraction < minAreaFraction || areaFraction > 1.02) return
      const shape = squareness(corners)
      if (shape < minSquareness) return

      // The pixels have the final say. A quad can satisfy every
      // geometric test and still be a line drawn across a photograph.
      const { support, weakest, emptiest } = edgeSupportDetail(grey, corners, spread)

      // Nearly right, with one side wrong: glare ate a corner, or a seam in a
      // steel bench pulled one out. Each side is re-fitted to the page edge
      // near it and the result judged afresh, beside the original.
      // The same rough outline turns up on several thresholds; re-fitting it
      // once is enough.
      const seen = weakest < CONFIDENT_SIDE && refinedSeeds.some(q => q.every((c, i) =>
        Math.abs(c.x - corners[i].x) <= 3 && Math.abs(c.y - corners[i].y) <= 3))
      if (weakest < CONFIDENT_SIDE && !seen && refinedSeeds.length < MAX_REFINES) {
        refinedSeeds.push(corners)
        // Twice: the first pass moves a side most of the way; the second,
        // starting from there, finds the stretch of edge the first could not
        // reach.
        const once = refineQuad(grey, corners, spread)
        const better = once && (refineQuad(grey, once, spread) || once)
        if (better) admit(better, 'refined')
      }

      if (support < minEdgeSupport) return
      candidates.push({
        corners,
        areaFraction,
        squareness: shape,
        edgeSupport: support,
        weakestSide: weakest,
        filledSide: emptiest,
        ...interiorTones(grey, corners)
      })
    }

    // A re-fitted quad, through the same tests as any other.
    const refinedSeeds = []
    const admit = (corners, source) => {
      if (!isConvex(corners)) return
      const areaFraction = polygonArea(corners) / frameArea
      if (areaFraction < minAreaFraction || areaFraction > 1.02) return
      const shape = squareness(corners)
      if (shape < minSquareness) return
      const { support, weakest, emptiest } = edgeSupportDetail(grey, corners, spread)
      if (support < minEdgeSupport) return
      candidates.push({
        source, corners, areaFraction, squareness: shape,
        edgeSupport: support, weakestSide: weakest, filledSide: emptiest,
        ...interiorTones(grey, corners)
      })
    }

    const eachContour = (contours, fn) => {
      try {
        for (let i = 0; i < contours.size(); i++) {
          const contour = contours.get(i)
          try { fn(contour) } finally { contour.delete() }
        }
      } finally {
        contours.delete()
      }
    }

    // ── The paper as a shape, not only as a line ──
    //
    // "You still need to be better" — Brent, 3 Nov 2026: white paper on a
    // wooden table, his own shadow across the bottom of the frame, and the
    // outline ran from the page's top-right to the corner of the picture.
    // Tracing edges, the page's bottom edge and the shadow's edge met and were
    // traced as one line, so the page never came out as a four-sided shape on
    // any rung — and something else did.
    //
    // So the page is also looked for as what it is: a region brighter (or, for
    // a dark form on a pale bench, darker) than what it lies on. The Otsu
    // split already computed above is that region. Opening it cuts the thin
    // bridges where a shadow or a cable touches the page; each separate region
    // then goes through exactly the same tests as a traced contour, and the
    // ranking below picks between them all.
    for (const invert of [false, true]) {
      const region = track(new cv.Mat())
      if (invert) cv.bitwise_not(otsuMask, region)
      else otsuMask.copyTo(region)
      // Close first: a form's printed rules run most of the page's width, and
      // without this they cut the paper into strips, none of them a page —
      // so on a shiny bench, where tracing fails, this fallback found
      // nothing either (Aimee, RHH, 4 Nov 2026). Then open, which cuts the
      // thin bridges to a shadow, a cable or a bright streak in the steel.
      const fill = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(REGION_CLOSE, REGION_CLOSE)))
      cv.morphologyEx(region, region, cv.MORPH_CLOSE, fill)
      const open = track(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5)))
      cv.morphologyEx(region, region, cv.MORPH_OPEN, open)
      const regionContours = new cv.MatVector()
      const regionHierarchy = track(new cv.Mat())
      cv.findContours(region, regionContours, regionHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
      eachContour(regionContours, contour => consider(contour, { wholeOnly: true }))
    }

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
      eachContour(contours, consider)
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

    // For measuring the detector offline (scripts/, the bench): every
    // candidate considered, not only the one chosen.
    if (Array.isArray(opts.inspect)) opts.inspect.push(...candidates)
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
      offEdge: edgesTouched(chosen.corners, width, height) < 3
        && clippedByFrame(chosen.corners, width, height),
      // Three or four borders touched is the surface the page is on, not the
      // page — the page's own edges were not found. "Move back" is the wrong
      // advice for that; the background is the problem.
      surfaceOnly: edgesTouched(chosen.corners, width, height) >= 3,

      // Whether the outline can be trusted enough to photograph by itself.
      //
      // Aimee's stainless bench at RHH (4 Nov 2026): glare, a seam or steel
      // close to the paper's tone, and the detector's best answer was a quad
      // with one side across bare steel — a shape that passes every test on
      // average and is still not the page. Every such wrong answer on the
      // bench has a side with little step under it, and almost every right
      // answer has none: measured, wrong answers' weakest sides ran 0.14 to
      // 0.64 and right ones 0.71 and up. The exception is a page whose print
      // runs to its border, which flips the step's sign — but that side is
      // *busy*, not empty, and an empty side is what a wrong answer has.
      // Unconfident answers are still drawn and can still be taken by hand;
      // they just never fire the shutter on their own.
      //
      // And a corner sitting in glare is a guess, however good the sides
      // look: the light has erased exactly the two edges that would have
      // placed it. Found on random steel scenes, where the one wrong outline
      // that still fired had its corner 10px out, inside a glare patch.
      ...(() => {
        const why = !(chosen.weakestSide >= CONFIDENT_SIDE || chosen.filledSide >= BUSY_SIDE) ? 'edge'
          : chosen.corners.some(c => cornerInGlare(grey, c)) ? 'glare'
            : disputed(chosen, candidates, width) ? 'corner' : ''
        // Which rule held the shutter, shown small on the camera screen so a
        // screenshot from a phone says it outright.
        return { confident: !why, unsureWhy: why }
      })(),
      weakestSide: chosen.weakestSide,

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
