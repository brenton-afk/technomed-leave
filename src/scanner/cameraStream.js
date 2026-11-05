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
// The torch belongs beside the stream, not in a component.
//
// It used to be a useState in the camera view while the stream lived here, and
// the two came apart the moment the view closed: the light stayed on because
// nothing stopped the track, the flag was lost with the unmount, and reopening
// showed a torch button reading "off" whose first tap sent torch:true again. Two
// taps to turn it off, the first appearing to do nothing — reported, correctly,
// as not being able to turn it off at all.
let torchIsOn = false

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

  opening = tryEach(constraintLadder())
    .then(async granted => {
      stream = granted
      opening = null
      // Before the first frame is shown, so a resolution change happens now
      // rather than as a visible jump once somebody is lining up a page.
      await tuneCamera(granted.getVideoTracks()[0]).catch(() => {})
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

/**
 * Where the browser can take a real photograph (Chrome on Android), the stream
 * is asked for the sensor's own 4:3 shape first.
 *
 * Asked for a width alone, Chrome on Aimee's Samsung S25 FE opened a 1920 x 886
 * stream — the screen's 19.5:9 shape, cut out of the middle of the sensor. The
 * view was narrowed ("the width of the camera is narrowed"), a page got about
 * 880 pixels across, and the full-resolution photograph was then thrown away
 * because its 4:3 shape did not match the video's (5 Nov 2026). 4:3 is the
 * sensor's native shape on every phone, so asking for it crops nothing — it is
 * the widest view the camera has.
 *
 * Only where a photograph can be taken: an iPhone keeps the width-only request,
 * which is what it was tuned on (see raiseResolution).
 */
export function constraintLadder(canPhotograph = typeof window !== 'undefined' && 'ImageCapture' in window) {
  if (!canPhotograph) return CONSTRAINT_LADDER
  return [
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, aspectRatio: { ideal: 4 / 3 } }, audio: false },
    ...CONSTRAINT_LADDER
  ]
}

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
    // Stopping the track extinguishes the light, so this is bookkeeping rather
    // than the mechanism — but a stale flag would make the next torch button lie.
    for (const track of stream.getTracks()) track.stop()
    stream = null
  }
  torchIsOn = false
  opening = null
}

/** Whether the stream is already open, so the caller knows not to show a wait. */
export function cameraOpen() {
  return Boolean(stream?.active)
}

/** Whether the light is actually on, as far as the browser will say. */
export function torchOn() {
  return torchIsOn
}

/**
 * The torch, where the device has one.
 *
 * Two constraint shapes are tried. `advanced` is the form everything documents,
 * and some builds accept it for switching on and quietly ignore it for switching
 * off — which is the worst possible failure for a light. Where the browser will
 * report the setting back, its report is believed over the request.
 */
export async function setTorch(on) {
  const track = stream?.getVideoTracks()?.[0]
  if (!track?.getCapabilities?.().torch) return false

  for (const constraints of [{ advanced: [{ torch: on }] }, { torch: on }]) {
    try {
      await track.applyConstraints(constraints)
      const reported = track.getSettings?.()?.torch
      if (reported === undefined || reported === on) {
        torchIsOn = on
        return true
      }
    } catch {
      // Try the other shape before giving up.
    }
  }
  return false
}

/**
 * Puts the light out, and says whether it worked.
 *
 * Called on leaving the camera and on the app being backgrounded. A torch left
 * burning in someone's pocket flattens the phone they need for the next case, and
 * it is not obvious where it came from.
 */
export async function turnTorchOff() {
  if (!torchIsOn) return true
  return setTorch(false)
}

export function hasTorch() {
  return Boolean(stream?.getVideoTracks()?.[0]?.getCapabilities?.().torch)
}

// ─── Zoom ────────────────────────────────────────────────────────────────────
// Asked for because a page that will not fit leaves nothing to do: the missing
// edge is off the sensor, so no amount of dragging a corner brings it back, and
// "move back" is not always possible in a theatre corridor.
//
// This is the camera's own zoom, not a crop of the picture — pulling below 1x on
// a phone with an ultra-wide switches to that lens and genuinely sees more. Not
// every device offers it, which is why everything here reports what it can do
// rather than assuming.

/** What the camera can do, or null where it cannot zoom at all. */
export function zoomRange() {
  const caps = stream?.getVideoTracks()?.[0]?.getCapabilities?.()
  if (!caps || typeof caps.zoom !== 'object') return null
  const { min = 1, max = 1, step = 0.1 } = caps.zoom
  if (!(max > min)) return null
  return { min, max, step: step || 0.1 }
}

export function currentZoom() {
  return stream?.getVideoTracks()?.[0]?.getSettings?.().zoom ?? 1
}

/** Sets the zoom, clamped to what the camera says it can do. */
export async function setZoom(value) {
  const track = stream?.getVideoTracks()?.[0]
  const range = zoomRange()
  if (!track || !range) return false

  const wanted = Math.min(range.max, Math.max(range.min, Number(value) || 1))
  for (const constraints of [{ advanced: [{ zoom: wanted }] }, { zoom: wanted }]) {
    try {
      await track.applyConstraints(constraints)
      return true
    } catch {
      // Try the other shape, as with the torch.
    }
  }
  return false
}

/** For tests. */
export function resetCameraForTests() {
  stream = null
  opening = null
  torchIsOn = false
}

// ─── Sharper pictures ─────────────────────────────────────────────────────────
// "The scan was blurry." — Aimee, via Brent, 3 Nov 2026. Three things a web page
// can do about that, each only where the phone says it can.

/** Focus, exposure and white balance left to run continuously, where offered. */
async function continuousModes(track) {
  const caps = track.getCapabilities?.() || {}
  const wanted = {}
  for (const key of ['focusMode', 'exposureMode', 'whiteBalanceMode']) {
    if (Array.isArray(caps[key]) && caps[key].includes('continuous')) wanted[key] = 'continuous'
  }
  if (!Object.keys(wanted).length) return
  try { await track.applyConstraints({ advanced: [wanted] }) } catch { /* keep what we had */ }
}

/**
 * The most pixels the camera will give *without changing what it sees*.
 *
 * The stream is opened at about 1920 wide, which is a safe mode on every phone.
 * Many will go higher. Only the width is raised — never a width and a height,
 * which is what once made an iPhone crop its sensor and magnify the view — and
 * the result is checked: if the picture's shape changed, the camera achieved
 * the width by switching mode, so that width is abandoned.
 *
 * Several widths are tried, largest first, and the first that keeps the shape
 * is kept. It used to try one — the camera's maximum, 4032 — and an iPhone
 * only offers that as a 4:3 photo mode, so the shape changed, the check put it
 * back to 1920, and every scan was taken from a 1080-pixel-wide frame. A page
 * came out about 800 pixels across, 100 dpi, and the lot numbers on the
 * stickers could not be read (Bowes usage, 5 Nov 2026). 4K at the same 16:9
 * shape — 3840 — was there all along.
 */
export const WIDTH_LADDER = [4032, 3840, 3264, 2880, 2560, 2304]

export async function raiseResolution(track, { limit = 4032 } = {}) {
  const caps = track?.getCapabilities?.() || {}
  const before = track?.getSettings?.() || {}
  if (!before.width || !before.height) return false
  // Safari may not say what it can do; then every width is worth asking.
  const max = caps.width?.max || Infinity
  const shape = s => (s.width && s.height ? Math.max(s.width, s.height) / Math.min(s.width, s.height) : 0)
  const was = shape(before)
  const longest = Math.max(before.width, before.height)
  const widths = WIDTH_LADDER.filter(w => w <= Math.min(max, limit) && w > longest * 1.15)
  if (!widths.length) return false

  for (const width of widths) {
    try {
      await track.applyConstraints({ ...stripSize(track.getConstraints?.() || {}), width: { ideal: width } })
    } catch {
      continue
    }
    const after = track.getSettings?.() || {}
    const gained = Math.max(after.width || 0, after.height || 0) > longest * 1.15
    if (gained && Math.abs(shape(after) - was) <= 0.04) return true
  }
  // None kept its shape: back to the view somebody can actually frame a page in.
  try { await track.applyConstraints({ ...stripSize(track.getConstraints?.() || {}), width: { ideal: before.width } }) } catch { /* as it is */ }
  return false
}

// The size goes; the shape asked for, if any, stays — raising the width of a
// 4:3 stream must not let it wander back to the screen's shape.
function stripSize(constraints) {
  const { width, height, ...rest } = constraints
  return rest
}

export async function tuneCamera(track) {
  if (!track) return
  await continuousModes(track)
  await raiseResolution(track)
}

// Android's Chrome can take a real photograph from the stream: full sensor
// resolution, with the phone's own focus and processing, rather than a frame
// grabbed out of video. Safari has no such thing. Used only where it gives a
// meaningfully bigger picture, and abandoned for the session the first time
// it fails or stalls — a shutter that hangs is worse than a slightly smaller
// photograph.
let stillsWork = true

export function canTakeStill() {
  return stillsWork && typeof window !== 'undefined' && 'ImageCapture' in window
    && Boolean(stream?.getVideoTracks?.()[0])
}

/** A full-resolution still as an ImageBitmap, or null to fall back to the video. */
export async function takeStill({ timeoutMs = 2500 } = {}) {
  if (!canTakeStill()) return null
  const track = stream.getVideoTracks()[0]
  try {
    const capture = new window.ImageCapture(track)
    const caps = await withTimeout(capture.getPhotoCapabilities(), timeoutMs)
    const streamWidth = Math.max(track.getSettings?.().width || 0, track.getSettings?.().height || 0)
    const photoMax = Math.max(caps?.imageWidth?.max || 0, caps?.imageHeight?.max || 0)
    if (!photoMax || photoMax < streamWidth * 1.3) return null
    // No flash unless the torch is already on. Left to the default ('auto' on
    // Android), a dim theatre fires it — and a flash on paper over stainless
    // steel is a white blot over exactly the stickers being photographed.
    const settings = {}
    if (Array.isArray(caps?.fillLightMode) && caps.fillLightMode.includes('off') && !torchIsOn) {
      settings.fillLightMode = 'off'
    }
    const blob = await withTimeout(capture.takePhoto(settings), timeoutMs)
    return await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    stillsWork = false
    return null
  }
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))])
}

/** What the camera is delivering now, for the line under a captured page. */
export function cameraDetail() {
  const s = stream?.getVideoTracks?.()[0]?.getSettings?.() || {}
  return { width: s.width || 0, height: s.height || 0, focusMode: s.focusMode || '' }
}
