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
 * Asks for more resolution than is kept: capturing large and downscaling reads
 * handwriting better than capturing small.
 */
export function acquireCamera() {
  if (stream?.active) return Promise.resolve(stream)
  if (opening) return opening

  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error('This browser cannot open the camera directly.'))
  }

  opening = navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 2560 },
      height: { ideal: 1440 }
    },
    audio: false
  }).then(granted => {
    stream = granted
    opening = null
    return granted
  }).catch(err => {
    opening = null
    throw err
  })

  return opening
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
