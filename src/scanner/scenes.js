// ─── Synthetic camera frames, for testing the detector ────────────────────────
// The first version of the detector scored perfectly on blank rectangles and
// then failed on a real form, because a real form is covered in printed text and
// table rules that produce stronger edges than the page border does. These
// scenes exist so that never happens again: every one is a form with content, at
// an angle, on a surface, with noise.

/** Homography taking the unit square to an arbitrary convex quad. */
function unitSquareTo(quad) {
  const [p0, p1, p2, p3] = quad
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y

  let a, b, c, d, e, f, g, h
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = p1.x - p0.x; b = p2.x - p1.x; c = p0.x
    d = p1.y - p0.y; e = p2.y - p1.y; f = p0.y
    g = 0; h = 0
  } else {
    const den = dx1 * dy2 - dx2 * dy1
    g = (dx3 * dy2 - dx2 * dy3) / den
    h = (dx1 * dy3 - dx3 * dy1) / den
    a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + h * p3.x; c = p0.x
    d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + h * p3.y; f = p0.y
  }
  return [a, b, c, d, e, f, g, h, 1]
}

function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g
  const det = a * A + b * B + c * C
  return [
    A / det, (c * h - b * i) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, (c * d - a * f) / det,
    C / det, (b * g - a * h) / det, (a * e - b * d) / det
  ]
}

/**
 * The content of a hospital "Record of Implantable Items Used" form, as a
 * function over the unit square. Returns a grey level.
 *
 * Deliberately busy: a heavy header block, a ruled table, and text. This content
 * is what defeated the first detector.
 */
export function formContent(u, v, paper) {
  const ink = 45
  // Header rule and title block. The margins here matter: an A4 form has 10mm
  // or so of clear paper at the edge, and putting print closer than that makes
  // every case pathological rather than realistic. A deliberately tight form is
  // a case of its own below.
  if (v > 0.075 && v < 0.093) return ink
  if (v > 0.035 && v < 0.068 && u > 0.06 && u < 0.62) return ((u * 90) | 0) % 3 ? ink + 25 : paper
  // Table: seven horizontal rules, two vertical column rules.
  for (let r = 0; r < 7; r++) {
    const y = 0.13 + r * 0.115
    if (v > y && v < y + 0.008) return ink
  }
  if (v > 0.13 && v < 0.94) {
    if ((u > 0.29 && u < 0.297) || (u > 0.63 && u < 0.637)) return ink
  }
  // Handwriting and print inside the cells.
  for (let r = 0; r < 7; r++) {
    const y = 0.155 + r * 0.115
    if (v > y && v < y + 0.035 && u > 0.04 && u < 0.9) {
      return ((u * 64 + r * 7) | 0) % 4 ? paper : ink + 30
    }
  }
  return paper
}

/**
 * A camera frame: a form rendered into `quad`, on a background.
 *
 * @param {object} o
 * @param {number} o.width, o.height
 * @param {Array<{x:number,y:number}>} o.quad  page corners, clockwise from top-left
 * @param {number} o.paper      page brightness
 * @param {number} o.bench      surface brightness
 * @param {number} [o.noise]    +/- sensor noise
 * @param {number} [o.vignette] corner darkening, 0..1
 * @param {Array}  [o.clutter]  other rectangles on the surface
 * @param {boolean}[o.content]  draw form content (default true)
 */
/**
 * Fills an arbitrary quadrilateral with a flat shade.
 *
 * Used for the surface a page is lying on. Axis-aligned `clutter` rectangles
 * cannot express that: a table photographed from above is a tilted quad whose
 * corners run off the frame, and it being a *quad* is the whole point — it is
 * exactly the shape the detector is looking for, which is why it gets picked
 * instead of the page.
 */
function fillQuad(g, W, H, quad, shade) {
  const inv = invert3(unitSquareTo(quad))
  const xs = quad.map(p => p.x), ys = quad.map(p => p.y)
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W, Math.ceil(Math.max(...xs)))
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H, Math.ceil(Math.max(...ys)))
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const w = inv[6] * x + inv[7] * y + inv[8]
      const u = (inv[0] * x + inv[1] * y + inv[2]) / w
      const v = (inv[3] * x + inv[4] * y + inv[5]) / w
      if (u < 0 || u > 1 || v < 0 || v > 1) continue
      g[y * W + x] = shade
    }
  }
}

export function scene(o) {
  const { width: W, height: H, quad, paper, bench } = o
  const content = o.content !== false
  const g = new Uint8Array(W * H)
  for (let i = 0; i < g.length; i++) g[i] = bench

  // The surface the page is on, under everything else.
  if (o.surface) fillQuad(g, W, H, o.surface.quad, o.surface.grey)

  for (const c of o.clutter || []) {
    for (let y = Math.max(0, c.y0); y < Math.min(H, c.y1); y++) {
      for (let x = Math.max(0, c.x0); x < Math.min(W, c.x1); x++) g[y * W + x] = c.grey
    }
  }

  const inv = invert3(unitSquareTo(quad))
  const xs = quad.map(p => p.x), ys = quad.map(p => p.y)
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W, Math.ceil(Math.max(...xs)))
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H, Math.ceil(Math.max(...ys)))

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const w = inv[6] * x + inv[7] * y + inv[8]
      const u = (inv[0] * x + inv[1] * y + inv[2]) / w
      const v = (inv[3] * x + inv[4] * y + inv[5]) / w
      if (u < 0 || u > 1 || v < 0 || v > 1) continue
      if (!content) { g[y * W + x] = paper; continue }
      // A tight form has its content pushed out to the paper's edge.
      const uu = o.tight ? 0.02 + u * 0.96 : u
      const vv = o.tight ? 0.005 + v * 0.99 : v
      g[y * W + x] = formContent(uu, o.tight ? Math.max(0.02, vv * 0.55) : vv, paper)
    }
  }

  if (o.vignette) {
    const cx = W / 2, cy = H / 2, r = Math.hypot(cx, cy)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const f = 1 - o.vignette * (Math.hypot(x - cx, y - cy) / r) ** 2
        g[y * W + x] = Math.max(0, Math.min(255, g[y * W + x] * f))
      }
    }
  }

  if (o.noise) {
    // Deterministic hash noise, so a failure is always reproducible.
    let seed = 0x9e3779b9
    for (let i = 0; i < g.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      const n = ((seed >>> 16) % (2 * o.noise + 1)) - o.noise
      g[i] = Math.max(0, Math.min(255, g[i] + n))
    }
  }

  return g
}

/** How far the detected corners sit from the truth, in pixels. */
export function cornerError(result, truth, width, height) {
  if (!result) return Infinity
  // Compare against every rotation: "top-left" is the detector's choice, and a
  // frame rotated a quarter turn is still the same page.
  let best = Infinity
  for (let r = 0; r < 4; r++) {
    let worst = 0
    for (let i = 0; i < 4; i++) {
      const c = result.corners[(i + r) % 4]
      worst = Math.max(worst, Math.hypot(c.x * width - truth[i].x, c.y * height - truth[i].y))
    }
    best = Math.min(best, worst)
  }
  return best
}

/**
 * The bench of cases the detector has to pass. Each is a real situation someone
 * scanning a usage form will actually be in.
 */
export function benchmark(W = 320, H = 240) {
  // Cases are authored at 320x240 and scaled, so the same scene can be measured
  // at whatever resolution the app actually runs detection at.
  const k = W / 320
  const rect = (x0, y0, x1, y1) => [
    { x: x0 * k, y: y0 * k }, { x: x1 * k, y: y0 * k },
    { x: x1 * k, y: y1 * k }, { x: x0 * k, y: y1 * k }
  ]
  const at = pts => pts.map(p => ({ x: p.x * k, y: p.y * k }))
  // A page held at an angle: near edge wider than the far edge.
  const tilted = at([{ x: 62, y: 30 }, { x: 258, y: 44 }, { x: 285, y: 208 }, { x: 36, y: 196 }])
  const rotated = at([{ x: 96, y: 22 }, { x: 292, y: 96 }, { x: 220, y: 220 }, { x: 26, y: 148 }])
  const steep = at([{ x: 88, y: 26 }, { x: 232, y: 30 }, { x: 296, y: 214 }, { x: 24, y: 210 }])

  return [
    { name: 'square on, dark bench', quad: rect(48, 26, 272, 214), paper: 232, bench: 62, noise: 3 },
    { name: 'square on, mid bench', quad: rect(48, 26, 272, 214), paper: 234, bench: 150, noise: 3 },
    { name: 'square on, LIGHT bench', quad: rect(48, 26, 272, 214), paper: 236, bench: 204, noise: 3 },
    { name: 'near-identical bench', quad: rect(48, 26, 272, 214), paper: 233, bench: 222, noise: 2 },
    { name: 'dark form, light bench', quad: rect(48, 26, 272, 214), paper: 120, bench: 226, noise: 3 },
    { name: 'tilted, light bench', quad: tilted, paper: 235, bench: 200, noise: 3 },
    { name: 'rotated 20 deg', quad: rotated, paper: 233, bench: 96, noise: 3 },
    { name: 'steep perspective', quad: steep, paper: 234, bench: 178, noise: 3 },
    { name: 'low light, noisy', quad: rect(48, 26, 272, 214), paper: 96, bench: 46, noise: 9 },
    { name: 'vignette + light bench', quad: rect(48, 26, 272, 214), paper: 236, bench: 202, noise: 3, vignette: 0.45 },
    {
      name: 'clutter beside the page', quad: rect(112, 26, 300, 214), paper: 234, bench: 198, noise: 3,
      clutter: [{ x0: 0, y0: 60 * k, x1: 74 * k, y1: 200 * k, grey: 120 }]
    },
    {
      name: 'page on a darker mat', quad: rect(64, 40, 256, 200), paper: 235, bench: 210, noise: 3,
      clutter: [{ x0: 40 * k, y0: 20 * k, x1: 288 * k, y1: 224 * k, grey: 168 }]
    },
    { name: 'fills the frame', quad: rect(12, 8, 308, 232), paper: 234, bench: 190, noise: 3 },
    { name: 'small in frame', quad: rect(104, 74, 216, 166), paper: 234, bench: 176, noise: 3 },
    // A form whose box border runs right at the paper's edge, which some
    // hospital sheets do. There is no clear paper to measure against, so this is
    // the hardest case in the set and it is here on purpose.
    { name: 'print to the edge', quad: rect(48, 26, 272, 214), paper: 234, bench: 198, noise: 3, tight: true },
    // ── The one from the photograph ──
    // A form on a wooden table, shot from above with the table's near edge and
    // the floor beyond it in frame. The table is a large tilted quadrilateral
    // running off three sides — which is to say, it is a better example of the
    // shape being searched for than the page is, and considerably bigger.
    //
    // Reported as "the frame just doesn't really adjust at all to the page on the
    // table": the outline sat on the table, corners off the edges of the picture,
    // and no amount of smoothing or gating downstream could help because the
    // detector's answer was confidently wrong. Every other scene here puts the
    // page on an infinite flat background, so none of them could produce it.
    {
      name: 'page on a table, edge in frame',
      // The page sits clear of the table's near edge, as it does in the
      // photograph. Overlapping the two merges their contours under Canny and
      // produces one ragged quad instead of two competing ones, which is a
      // different problem and not the one being reproduced here.
      quad: rect(104, 40, 232, 186), paper: 236, bench: 40, noise: 3,
      surface: { grey: 138, quad: [
        { x: -30 * k, y: -20 * k }, { x: 350 * k, y: 10 * k },
        { x: 300 * k, y: 255 * k }, { x: -60 * k, y: 215 * k }
      ] }
    },
    // The same thing without the tilt: a desk edge straight across the frame.
    {
      name: 'desk edge across the frame',
      quad: rect(88, 30, 232, 180), paper: 234, bench: 52, noise: 3,
      surface: { grey: 150, quad: [
        { x: -10 * k, y: -10 * k }, { x: 330 * k, y: -10 * k },
        { x: 330 * k, y: 205 * k }, { x: -10 * k, y: 205 * k }
      ] }
    }
  ].map(c => ({ ...c, width: W, height: H, image: scene({ ...c, width: W, height: H }) }))
}
