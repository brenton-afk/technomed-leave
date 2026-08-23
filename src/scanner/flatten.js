// ─── Flattening a captured page ───────────────────────────────────────────────
// Warps the four detected corners onto a rectangle, so the result is the page
// seen square on rather than a photograph of a page lying on a bench.
//
// A bounding-box crop, which is what this used to do, cannot achieve that: it
// keeps a wedge of bench in every corner and leaves the form itself skewed. A
// column of handwriting running diagonally is materially harder to read, and it
// is harder for the extraction model too.
//
// Then a contrast stretch, which is most of what makes a phone photograph look
// like a scan. Paper photographed indoors is rarely white and rarely evenly lit;
// pulling the tonal range back out to the full span is the same operation as
// "auto levels", and it is why a scan reads as a document rather than a snapshot.

import { rectifiedSize, expandQuad, worthRectifying, warpToRect } from './rectify.js'

/**
 * The size the flattened page should be. Shared by both paths so the result is
 * the same shape whether or not OpenCV is available.
 */
export function outputSize(corners, maxDimension) {
  return rectifiedSize(corners, maxDimension)
}

/**
 * Flattens with OpenCV: getPerspectiveTransform then warpPerspective, then a
 * contrast stretch.
 *
 * @param {object} cv
 * @param {HTMLCanvasElement} source  the full-resolution captured frame
 * @param {Array<{x:number,y:number}>} corners  in source pixels, TL TR BR BL
 * @param {{maxDimension?: number, enhance?: boolean}} [opts]
 * @returns {HTMLCanvasElement|null}
 */
export function flattenWithOpenCv(cv, source, corners, opts = {}) {
  const { maxDimension = 1568, enhance = true } = opts
  const size = outputSize(corners, maxDimension)
  if (!size) return null

  const open = []
  const track = mat => { open.push(mat); return mat }
  try {
    const input = track(cv.imread(source))
    const from = track(cv.matFromArray(4, 1, cv.CV_32FC2, [
      corners[0].x, corners[0].y, corners[1].x, corners[1].y,
      corners[2].x, corners[2].y, corners[3].x, corners[3].y
    ]))
    const to = track(cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, size.width, 0, size.width, size.height, 0, size.height
    ]))

    const transform = track(cv.getPerspectiveTransform(from, to))
    const flat = track(new cv.Mat())
    cv.warpPerspective(input, flat, transform, new cv.Size(size.width, size.height),
      cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255))

    if (enhance) stretchContrast(cv, flat, track)

    const out = document.createElement('canvas')
    out.width = size.width
    out.height = size.height
    cv.imshow(out, flat)
    return out
  } catch {
    return null
  } finally {
    for (const mat of open) {
      try { mat.delete() } catch { /* already released */ }
    }
  }
}

/**
 * Pulls the tonal range back out to full span, in place.
 *
 * The black and white points are taken from a blurred copy, so a single specular
 * highlight or a dark speck cannot set them and flatten everything else. That is
 * the difference between an auto-levels that helps and one that makes every
 * photograph with a glare spot worse.
 */
function stretchContrast(cv, image, track) {
  const grey = track(new cv.Mat())
  cv.cvtColor(image, grey, cv.COLOR_RGBA2GRAY)
  const blurred = track(new cv.Mat())
  cv.GaussianBlur(grey, blurred, new cv.Size(9, 9), 0, 0, cv.BORDER_DEFAULT)

  const { minVal, maxVal } = cv.minMaxLoc(blurred)
  const span = maxVal - minVal
  // Already using most of the range, or so flat that stretching it would only
  // amplify noise.
  if (span < 32 || span > 235) return

  // A little headroom at each end, so paper goes to near-white rather than
  // clipping the lightest print away with it.
  const black = Math.max(0, minVal - 6)
  const white = Math.min(255, maxVal + 6)
  const alpha = 255 / (white - black)
  cv.convertScaleAbs(image, image, alpha, -black * alpha)
}

/**
 * Flattens without OpenCV.
 *
 * The engine is eleven megabytes over hospital wifi, and it can fail to arrive.
 * When it does, a page still has to come out square — the extraction that follows
 * is the point of the whole feature, and it reads a flattened page markedly
 * better than a skewed one. Same geometry, no contrast stretch.
 */
export function flattenWithCanvas(source, corners, opts = {}) {
  const { maxDimension = 1568 } = opts
  const size = outputSize(corners, maxDimension)
  if (!size) return null

  const context = source.getContext('2d', { willReadFrequently: true })
  const pixels = context.getImageData(0, 0, source.width, source.height)
  const warped = warpToRect(pixels, corners, size, (w, h) => context.createImageData(w, h))
  if (!warped) return null

  const out = document.createElement('canvas')
  out.width = size.width
  out.height = size.height
  out.getContext('2d').putImageData(warped, 0, 0)
  return out
}

/**
 * Flattens a captured frame to its page, by whichever route is available.
 *
 * @param {object|null} cv
 * @param {HTMLCanvasElement} source
 * @param {Array<{x:number,y:number}>|null} corners  normalised 0..1
 * @returns {{canvas: HTMLCanvasElement, flattened: boolean}}
 */
export function flattenCapture(cv, source, corners, opts = {}) {
  const { margin = 0.012, maxDimension = 1568 } = opts

  if (corners?.length === 4) {
    // Outwards a little, so a border found a pixel inside the paper does not
    // shave the edge of the form off.
    const inPixels = expandQuad(
      corners.map(c => ({ x: c.x * source.width, y: c.y * source.height })), margin)

    if (worthRectifying(inPixels, source.width, source.height)) {
      const viaCv = cv ? flattenWithOpenCv(cv, source, inPixels, { maxDimension }) : null
      if (viaCv) return { canvas: viaCv, flattened: true }
      const viaCanvas = flattenWithCanvas(source, inPixels, { maxDimension })
      if (viaCanvas) return { canvas: viaCanvas, flattened: true }
    }
  }

  // No usable outline. The whole photograph is kept rather than a crop guessed
  // at: a wide picture costs a margin, a wrong one costs a column of the form.
  const scale = Math.min(1, maxDimension / Math.max(source.width, source.height))
  const out = document.createElement('canvas')
  out.width = Math.round(source.width * scale)
  out.height = Math.round(source.height * scale)
  out.getContext('2d').drawImage(source, 0, 0, out.width, out.height)
  return { canvas: out, flattened: false }
}
