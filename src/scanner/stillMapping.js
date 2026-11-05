// ─── A photograph that is not the same shape as the video ────────────────────
// Chrome on Android takes a real photograph from the camera — full sensor, the
// phone's own focus and processing — but the live video it was framed in can be
// a different shape: on a Samsung S25 FE the stream was 19.5:9 and the photo
// 4:3. The photo was thrown away for not matching, and the page was taken from
// an 886-pixel-wide video frame instead (Aimee, 5 Nov 2026).
//
// The video is the middle of the same view: the largest rectangle of its shape
// that fits in the sensor, centred. So an outline drawn on the video maps into
// the photograph by that crop. The photo is then re-detected as every capture
// is, which corrects whatever this assumption gets slightly wrong.

/**
 * Corners normalised to the video (0..1), as corners normalised to the still,
 * or null when the two are not the same way up (portrait against landscape).
 */
export function cornersOnStill(corners, videoWidth, videoHeight, stillWidth, stillHeight) {
  if (!corners || corners.length !== 4) return null
  if (!videoWidth || !videoHeight || !stillWidth || !stillHeight) return null
  if ((videoWidth >= videoHeight) !== (stillWidth >= stillHeight)) return null
  const video = videoWidth / videoHeight
  const still = stillWidth / stillHeight
  // The video's share of the still, in each direction.
  const sx = video > still ? 1 : video / still
  const sy = video > still ? still / video : 1
  const ox = (1 - sx) / 2
  const oy = (1 - sy) / 2
  return corners.map(c => ({ x: ox + c.x * sx, y: oy + c.y * sy }))
}
