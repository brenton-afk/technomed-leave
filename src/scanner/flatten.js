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
    // Cubic, not linear: the warp is also a resample, and linear softens the
    // fine print it is meant to be making legible.
    cv.warpPerspective(input, flat, transform, new cv.Size(size.width, size.height),
      cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255))

    if (enhance) enhanceDocument(cv, flat)

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
 * Makes a photographed page read like a scanned one, in place.
 *
 * "The scan was blurry" — in the PDF the distributor and Dropbox receive
 * (Aimee, 3 Nov 2026). Forms are photographed on a stainless steel bench under
 * theatre lights: the paper comes out grey at one end and white at the other,
 * with glare patches, and a global auto-levels cannot fix that — whatever it
 * does to the dark end it does to the bright end too.
 *
 * So, as scanning apps do, the lighting is estimated and divided out. The
 * paper behind the print is found by spreading the light parts over the dark
 * (a dilation, which swallows strokes of ink) and smoothing; every pixel is
 * then divided by the paper's brightness at that point. Paper goes evenly
 * white wherever it was lit, and ink stays as dark relative to its paper as it
 * was — which is the thing that makes it legible. Colour is kept: each channel
 * is divided by the same estimate, so blue pen stays blue.
 *
 * Then the usual auto-levels, and a light unsharp mask.
 *
 * Each step is guarded on its own. A failure in one leaves the page as the
 * previous step left it — never worse than the flattened photograph.
 */
export function enhanceDocument(cv, image) {
  const open = []
  const track = mat => { open.push(mat); return mat }
  try {
    try { evenLighting(cv, image, track) } catch { /* as it was */ }
    try { stretchContrast(cv, image, track) } catch { /* as it was */ }
    try { unsharp(cv, image, track) } catch { /* as it was */ }
  } finally {
    for (const mat of open) {
      try { mat.delete() } catch { /* already released */ }
    }
  }
}

export function evenLighting(cv, image, track) {
  const grey = track(new cv.Mat())
  cv.cvtColor(image, grey, cv.COLOR_RGBA2GRAY)

  // Estimated at a quarter size: the lighting changes slowly across a page, and
  // a median over a full-resolution page would cost seconds on a phone.
  const small = track(new cv.Mat())
  const scale = 0.25
  cv.resize(grey, small, new cv.Size(Math.max(8, Math.round(grey.cols * scale)), Math.max(8, Math.round(grey.rows * scale))), 0, 0, cv.INTER_AREA)
  const kernel = track(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7)))
  cv.dilate(small, small, kernel)
  cv.medianBlur(small, small, 15)

  // Not paper at all — a dark photograph, or the page was not found and this is
  // the bench. Dividing by it would only blow out noise.
  if (cv.mean(small)[0] < 90) return

  const paper = track(new cv.Mat())
  cv.resize(small, paper, new cv.Size(grey.cols, grey.rows), 0, 0, cv.INTER_LINEAR)
  // Never divide by near-black: a deep shadow is lifted, not exploded.
  cv.max(paper, track(new cv.Mat(paper.rows, paper.cols, paper.type(), new cv.Scalar(40))), paper)

  const channels = track(new cv.MatVector())
  cv.split(image, channels)
  for (let c = 0; c < 3; c++) {
    const ch = channels.get(c)
    cv.divide(ch, paper, ch, 255)
    channels.set(c, ch)
    ch.delete()
  }
  cv.merge(channels, image)
}

export function unsharp(cv, image, track) {
  const blurred = track(new cv.Mat())
  cv.GaussianBlur(image, blurred, new cv.Size(0, 0), 1.1, 1.1, cv.BORDER_DEFAULT)
  cv.addWeighted(image, 1.6, blurred, -0.6, 0, image)
}

/**
 * Pulls the tonal range back out to full span, in place.
 *
 * The black and white points are taken from a blurred copy, so a single specular
 * highlight or a dark speck cannot set them and flatten everything else. That is
 * the difference between an auto-levels that helps and one that makes every
 * photograph with a glare spot worse.
 */
export function stretchContrast(cv, image, track) {
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
  // convertTo saturates at 0; convertScaleAbs, which this used, takes the
  // *absolute value* — so any ink darker than the blurred black point went
  // negative and was flipped back up into grey. The thinnest, darkest strokes,
  // which are the ones that set the black point lowest in a sharp photograph,
  // came out washed out on every scan.
  image.convertTo(image, -1, alpha, -black * alpha)
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
