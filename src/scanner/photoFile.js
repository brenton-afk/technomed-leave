// ─── A photograph from the phone's own camera ────────────────────────────────
// "Are we actually going to solve this? … Pull out all the stops." — Brent,
// 5 Nov 2026. A web page's camera is a video stream: denoised, compressed and
// focused for moving pictures. The phone's own camera app takes a still with
// its full sensor, real autofocus, stabilisation and HDR — what Dropbox's
// scanner uses — and `<input capture>` hands that file straight to the page.
// This draws it, the right way up, at full detail (capped only so a 50 MP
// sensor cannot exhaust a phone's canvas memory), for the same detection,
// flattening and review as any other capture.

/** The largest side kept. 4096 is about 350 dpi across an A4 form. */
export const PHOTO_MAX_DIM = 4096

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      // 'from-image' honours the photo's EXIF rotation, so a portrait shot is
      // not handed over lying on its side.
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch { /* fall through to an <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('That photo could not be read'))
      img.src = url
    })
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

/** The photo as a canvas, no larger than `maxDim` on its long side. */
export async function photoToCanvas(file, maxDim = PHOTO_MAX_DIM) {
  const picture = await decode(file)
  const width = picture.width || picture.naturalWidth
  const height = picture.height || picture.naturalHeight
  if (!width || !height) throw new Error('That photo could not be read')
  const scale = Math.min(1, maxDim / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(picture, 0, 0, canvas.width, canvas.height)
  picture.close?.()
  return canvas
}
