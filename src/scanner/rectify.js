// ─── Flattening the page ──────────────────────────────────────────────────────
// Turns the four corners the detector found into a straight-on image of the page.
//
// Cropping to the corners' bounding box, which is what this used to do, keeps a
// wedge of bench in every corner and leaves the form itself skewed. A projective
// warp removes both: the page comes out rectangular, edge to edge, as though the
// camera had been square on to it. That matters for reading it — a column of
// handwriting running diagonally across the frame is materially harder to follow
// than the same column upright — and it is also what makes the result look like a
// scan rather than a photograph of a desk.

/**
 * The homography taking the unit square to a quad, as eight coefficients.
 * (x, y) = ((a·u + b·v + c) / (g·u + h·v + 1), (d·u + e·v + f) / (g·u + h·v + 1))
 */
export function unitSquareToQuad(quad) {
  const [p0, p1, p2, p3] = quad
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y

  // With no perspective the mapping is affine and the general form divides by
  // zero, so that case is handled directly.
  let map
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    map = {
      a: p1.x - p0.x, b: p2.x - p1.x, c: p0.x,
      d: p1.y - p0.y, e: p2.y - p1.y, f: p0.y,
      g: 0, h: 0
    }
  } else {
    const denominator = dx1 * dy2 - dx2 * dy1
    if (Math.abs(denominator) < 1e-9) return null
    const g = (dx3 * dy2 - dx2 * dy3) / denominator
    const h = (dx1 * dy3 - dx3 * dy1) / denominator
    map = {
      a: p1.x - p0.x + g * p1.x, b: p3.x - p0.x + h * p3.x, c: p0.x,
      d: p1.y - p0.y + g * p1.y, e: p3.y - p0.y + h * p3.y, f: p0.y,
      g, h
    }
  }

  // A quad that has collapsed to a line or a point takes the affine branch and
  // comes out as a mapping with no area, which would silently produce a blank
  // image. Refuse it here rather than leaving every caller to notice.
  if (Math.abs(map.a * map.e - map.b * map.d) < 1e-6) return null
  return map
}

/**
 * The size the flattened page should be, in pixels.
 *
 * The two measurements of each side disagree under perspective — that is what
 * perspective is — so the longer of each pair is used. Taking the shorter would
 * squeeze the near edge of the page down to match the far one and lose detail
 * exactly where the picture is sharpest.
 */
export function rectifiedSize(quad, maxDimension) {
  const span = (a, b) => Math.hypot(quad[a].x - quad[b].x, quad[a].y - quad[b].y)
  const width = Math.max(span(0, 1), span(3, 2))
  const height = Math.max(span(0, 3), span(1, 2))
  if (!(width > 1) || !(height > 1)) return null
  const scale = Math.min(1, maxDimension / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

/**
 * Warps the quad out of `source` into a straight rectangle.
 *
 * Sampling is bilinear. Nearest-neighbour is faster but leaves printed text
 * visibly ragged after a rotation of a few degrees, and text is the entire point
 * of the picture.
 *
 * @param {ImageData} source
 * @param {Array<{x:number,y:number}>} quad  corners in source pixels, TL TR BR BL
 * @param {{width:number,height:number}} size
 * @returns {ImageData|null}
 */
export function warpToRect(source, quad, size, createImageData) {
  const map = unitSquareToQuad(quad)
  if (!map) return null

  const { width: outWidth, height: outHeight } = size
  const out = createImageData(outWidth, outHeight)
  const src = source.data, dst = out.data
  const sw = source.width, sh = source.height

  for (let y = 0; y < outHeight; y++) {
    const v = (y + 0.5) / outHeight
    for (let x = 0; x < outWidth; x++) {
      const u = (x + 0.5) / outWidth
      const w = map.g * u + map.h * v + 1
      const sx = (map.a * u + map.b * v + map.c) / w
      const sy = (map.d * u + map.e * v + map.f) / w
      const target = (y * outWidth + x) * 4

      if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) {
        // Outside the photograph. White, not black: a page is white, and a black
        // wedge in a corner reads as content to anything looking at it later.
        dst[target] = 255; dst[target + 1] = 255; dst[target + 2] = 255; dst[target + 3] = 255
        continue
      }

      const x0 = Math.floor(sx), y0 = Math.floor(sy)
      const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1)
      const fx = sx - x0, fy = sy - y0
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy)
      const w01 = (1 - fx) * fy, w11 = fx * fy

      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4

      for (let channel = 0; channel < 3; channel++) {
        dst[target + channel] =
          src[i00 + channel] * w00 + src[i10 + channel] * w10 +
          src[i01 + channel] * w01 + src[i11 + channel] * w11
      }
      dst[target + 3] = 255
    }
  }
  return out
}

/**
 * Nudges the corners outwards by a fraction of the page, so a border that the
 * detector placed a pixel or two inside the paper does not shave the edge of the
 * form off. Overshooting costs a thin margin of bench; undershooting costs data.
 */
export function expandQuad(quad, margin) {
  const cx = quad.reduce((t, c) => t + c.x, 0) / 4
  const cy = quad.reduce((t, c) => t + c.y, 0) / 4
  return quad.map(c => ({
    x: cx + (c.x - cx) * (1 + margin),
    y: cy + (c.y - cy) * (1 + margin)
  }))
}

/**
 * Whether a quad is worth warping at all.
 *
 * A quad this wrong is not a page, and flattening to it would crop into the form.
 * Refusing here is what makes the whole photograph the fallback rather than a
 * confident crop of the wrong thing.
 */
export function worthRectifying(quad, width, height) {
  if (!quad || quad.length !== 4) return false
  if (quad.some(c => !Number.isFinite(c.x) || !Number.isFinite(c.y))) return false
  const size = rectifiedSize(quad, 1e9)
  if (!size) return false
  // Smaller than this and it is a fragment, not a page.
  if (size.width < width * 0.2 || size.height < height * 0.2) return false
  const aspect = size.width / size.height
  // A4 is 1:1.41 either way up. This is far looser than that, since the point is
  // only to rule out a sliver.
  return aspect > 0.25 && aspect < 4
}
