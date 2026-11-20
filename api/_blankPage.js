// ─── A black page is refused at the door (Toni, 20 Nov 2026) ────────────────
// Two Signus resupplies were filed with a page of pure black: a phone short
// of memory encoded an empty canvas. The phone now checks its own copies
// (src/scanner/blankCheck.js); this is the backstop for a phone that did not.
// No image decoder is needed: a JPEG of one flat colour compresses to almost
// nothing. The two black pages were 0.016 bytes a pixel; the real pages
// beside them 0.53, and a sparse typed page is still well over 0.1.

const FLAT = 0.03          // bytes per pixel below which a page is one colour
const BIG_ENOUGH = 400_000 // pixels — a thumbnail is not judged

/** Width and height from a JPEG's frame header, or null. */
export function jpegSize(bytes) {
  let i = 2
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue }
    const marker = bytes[i + 1]
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] }
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3])
  }
  return null
}

/** True for a JPEG page that is one flat colour — black from a failed canvas. */
export function looksLikeBlankJpeg(base64) {
  try {
    const bytes = Buffer.from(String(base64 || ''), 'base64')
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false
    const size = jpegSize(bytes)
    if (!size) return false
    const pixels = size.width * size.height
    return pixels >= BIG_ENOUGH && bytes.length / pixels < FLAT
  } catch {
    return false
  }
}
