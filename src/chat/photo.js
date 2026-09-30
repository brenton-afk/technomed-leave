// ─── Getting a photograph small enough to send ───────────────────────────────
// Straight off a phone camera a picture is four or five megabytes. Sent as-is
// that is slow on a hospital connection, expensive to store, and pointless: the
// thing being photographed is a booking form, a tray with a part number on it,
// or a whiteboard, and every one of those is legible at a fraction of the size.
//
// Resized in the browser rather than on the way in, so the big version never
// leaves the phone at all — which is the cheapest privacy win available here.
// The original stays in the camera roll where the person who took it can see it.

export const MAX_SIDE = 1600
export const QUALITY = 0.82

/**
 * A photograph, resized and re-encoded as JPEG.
 *
 * Returns a Blob and the dimensions, so the message can reserve the right shape
 * of space before the image has loaded and the channel does not jump about as
 * pictures arrive.
 *
 * @param {File} file
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
export async function shrink(file, { maxSide = MAX_SIDE, quality = QUALITY } = {}) {
  const bitmap = await loadBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  const blob = await new Promise(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('That photo could not be read')
  return { blob, width, height }
}

async function loadBitmap(file) {
  // createImageBitmap handles the orientation tag on its own, which matters:
  // a photo taken in portrait and drawn without it comes out on its side.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // Falls through — Safari has been picky about the options object.
    }
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
    URL.revokeObjectURL(url)
  }
}

/**
 * What to say before a photograph is sent.
 *
 * The text in a message goes through identifiers.js, which reads it and warns.
 * A photograph walks past all of that — it cannot be read the same way, and a
 * picture of a booking form carries a full name, usually a date of birth and
 * often a UR number.
 *
 * So the warning is unconditional, and it names what to do rather than simply
 * disapproving: crop the top off, which is where hospital forms put the patient
 * label. Unconditional because a conditional warning trains people to ignore it
 * — and because the app has no way to know which photographs are the risky ones.
 *
 * It warns; it does not refuse. The team needs to send these, and a channel
 * that will not carry the picture sends everybody back to WhatsApp, where there
 * is no warning at all.
 */
export const PHOTO_WARNING =
  'Photos of paperwork show the patient’s name — crop the label off before sending.'
