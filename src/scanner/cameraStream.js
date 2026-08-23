// ─── One camera stream, held open ─────────────────────────────────────────────
// The stream lives here rather than inside the camera component, and that is the
// point. A component that opens the camera when it mounts and stops the tracks
// when it unmounts calls getUserMedia again for every page of a multi-page scan —
// and on iOS each of those is a visible stall, sometimes a permission prompt, and
// always a second of black while the sensor settles. Scanning a three-page form
// meant three of them.
//
// So it is acquired once and kept until the scanner is actually left. Permission
// is a per-origin browser setting that persists on its own; nothing here needs to
// ask twice.

let stream = null
let opening = null

/** What the browser already knows, so a prompt is never shown unnecessarily. */
export async function cameraPermission() {
  try {
    if (!navigator.permissions?.query) return 'unknown'
    const status = await navigator.permissions.query({ name: 'camera' })
    return status.state // 'granted' | 'denied' | 'prompt'
  } catch {
    // Safari has historically not supported the camera descriptor. Not knowing
    // is fine — it only means the caller cannot skip the explanatory line.
    return 'unknown'
  }
}

/**
 * The shared rear-camera stream.
 *
 * Deliberately asks for almost nothing: the rear camera, and that is all.
 *
 * It used to ask for 2560x1440, on the reasoning that capturing large and
 * downscaling reads handwriting better. That reasoning is sound and the request
 * was still wrong. An iPhone has several rear lenses at several native aspect
 * ratios, and pinning both dimensions makes it satisfy the request by cropping
 * the sensor or choosing a longer lens — so the preview came back magnified, with
 * a form that would not fit in it at any sensible distance. Reported, accurately,
 * as overzoomed and useless.
 *
 * One dimension is still hinted, because dropping resolution entirely can leave a
 * 640x480 stream and handwriting does not survive that. Hinting a width asks the
 * device to pick its closest *mode*; pinning a width and a height together asks it
 * to produce a shape it may not have, which it does by cropping. Only the second
 * causes the magnification.
 */
export function acquireCamera() {
  if (stream?.active) return Promise.resolve(stream)
  if (opening) return opening

  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error('This browser cannot open the camera directly.'))
  }

  opening = tryEach(CONSTRAINT_LADDER)
    .then(granted => {
      stream = granted
      opening = null
      return granted
    })
    .catch(err => {
      opening = null
      throw err
    })

  return opening
}

/**
 * What to ask for, in order, stopping at the first thing the device will give.
 *
 * A ladder rather than one request, because a phone that refuses the first must
 * still end up with a camera. Asking for a width *and* a height is what made an
 * iPhone crop its sensor to manufacture the shape, so no rung does that; the last
 * rung asks for nothing at all, which no device with a camera can refuse.
 */
const CONSTRAINT_LADDER = [
  { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false },
  { video: { facingMode: { ideal: 'environment' } }, audio: false },
  { video: true, audio: false }
]

async function tryEach(ladder) {
  let lastError = null
  for (const constraints of ladder) {
    try {
      const granted = await navigator.mediaDevices.getUserMedia(constraints)
      // Checked rather than assumed. A rung that resolves without a usable
      // stream would otherwise be taken as success, and the camera would read as
      // open with nothing behind it.
      if (granted?.getVideoTracks?.().length) return granted
      lastError = lastError || new Error('The camera returned no video')
    } catch (err) {
      lastError = err
      // A refusal is a refusal — asking for less will not change the answer, and
      // trying again only produces another prompt.
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') throw err
    }
  }
  throw lastError || new Error('No camera available')
}

/**
 * Stops the camera. Only when the scanner is being left — not between pages.
 */
export function releaseCamera() {
  if (stream) {
    for (const track of stream.getTracks()) track.stop()
    stream = null
  }
  opening = null
}

/** Whether the stream is already open, so the caller knows not to show a wait. */
export function cameraOpen() {
  return Boolean(stream?.active)
}

/** The torch, where the device has one. */
export async function setTorch(on) {
  const track = stream?.getVideoTracks()?.[0]
  if (!track?.getCapabilities?.().torch) return false
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] })
    return true
  } catch {
    return false
  }
}

export function hasTorch() {
  return Boolean(stream?.getVideoTracks()?.[0]?.getCapabilities?.().torch)
}

/** For tests. */
export function resetCameraForTests() {
  stream = null
  opening = null
}
