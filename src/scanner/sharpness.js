// ─── How sharp a frame is ─────────────────────────────────────────────────────
// "The scan was blurry." — Aimee, via Brent, 3 Nov 2026.
//
// A capture used to be whichever video frame happened to be on screen when the
// shutter fired. A hand-held phone is never still at that instant — the tap
// itself moves it — and the frame may also be one the lens was still hunting
// focus on. So the shutter now takes a short burst and keeps the sharpest.
//
// Sharpness is the variance of the Laplacian, the standard focus measure: a
// crisp edge produces large second derivatives, and blur — from shake or from
// focus — smooths them away. It is computed on a grey, downscaled copy of the
// middle of the frame, which is where the form is and which a page border or a
// bright window at the edge of the picture cannot dominate.

/**
 * Variance of the 4-neighbour Laplacian over a greyscale region of RGBA data.
 *
 * @param {Uint8ClampedArray} rgba   ImageData.data
 * @param {number} width
 * @param {number} height
 * @param {{x0?: number, y0?: number, x1?: number, y1?: number}} [box] fractions
 * @returns {number} higher is sharper; 0 for a flat or empty region
 */
export function laplacianVariance(rgba, width, height, box = {}) {
  const x0 = Math.max(1, Math.floor((box.x0 ?? 0.2) * width))
  const x1 = Math.min(width - 1, Math.ceil((box.x1 ?? 0.8) * width))
  const y0 = Math.max(1, Math.floor((box.y0 ?? 0.2) * height))
  const y1 = Math.min(height - 1, Math.ceil((box.y1 ?? 0.8) * height))
  if (x1 - x0 < 3 || y1 - y0 < 3) return 0

  const grey = i => 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4
      const lap = grey(i - 4) + grey(i + 4) + grey(i - width * 4) + grey(i + width * 4) - 4 * grey(i)
      sum += lap
      sumSq += lap * lap
      n++
    }
  }
  if (!n) return 0
  const mean = sum / n
  return sumSq / n - mean * mean
}

/** Width the sharpness is measured at. Fine print survives it; a full frame need not be read. */
export const SHARPNESS_WIDTH = 640

/**
 * Sharpness of a drawable (video, canvas, bitmap), measured on a small copy.
 *
 * @param {CanvasImageSource} source
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @param {HTMLCanvasElement} scratch reused between calls
 * @param {object} [box] the page's bounding box, as fractions, where known
 */
export function sharpnessOf(source, sourceWidth, sourceHeight, scratch, box) {
  const w = Math.min(SHARPNESS_WIDTH, sourceWidth)
  const h = Math.max(1, Math.round(w * sourceHeight / sourceWidth))
  if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h }
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(source, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  return laplacianVariance(data, w, h, box)
}

/** The page's bounding box from its corners, shrunk a little to stay on the paper. */
export function boxOf(corners) {
  if (!corners?.length) return undefined
  const xs = corners.map(c => c.x)
  const ys = corners.map(c => c.y)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const insetX = (maxX - minX) * 0.1
  const insetY = (maxY - minY) * 0.1
  return { x0: minX + insetX, x1: maxX - insetX, y0: minY + insetY, y1: maxY - insetY }
}
