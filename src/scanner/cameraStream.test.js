import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  acquireCamera, releaseCamera, cameraOpen, cameraPermission, resetCameraForTests,
  setTorch, torchOn, turnTorchOff, hasTorch
} from './cameraStream.js'

// Scanning a three-page form used to open the camera three times, because the
// component that opened it also closed it on unmount. On iOS each of those is a
// visible stall and a second of black while the sensor settles. The stream is
// shared and held instead, so these are the guarantees that matters rest on.

function fakeStream() {
  const tracks = [{ stop: vi.fn(), getCapabilities: () => ({ torch: true }) }]
  return { active: true, getTracks: () => tracks, getVideoTracks: () => tracks }
}

let granted

beforeEach(() => {
  resetCameraForTests()
  granted = fakeStream()
  global.navigator.mediaDevices = { getUserMedia: vi.fn(() => Promise.resolve(granted)) }
})

afterEach(() => {
  releaseCamera()
  vi.restoreAllMocks()
})

describe('opening the camera once', () => {
  it('asks the browser exactly once, however many times it is acquired', async () => {
    const first = await acquireCamera()
    const second = await acquireCamera()
    const third = await acquireCamera()
    expect(first).toBe(second)
    expect(second).toBe(third)
    // One getUserMedia call is one permission check, and at most one prompt.
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('asks once even when acquired again before the first attempt resolves', async () => {
    // Two pages captured in quick succession, or a re-render mid-open.
    const both = await Promise.all([acquireCamera(), acquireCamera()])
    expect(both[0]).toBe(both[1])
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('hints a width but never pins the shape of the frame', async () => {
    await acquireCamera()
    const request = navigator.mediaDevices.getUserMedia.mock.calls[0][0]
    expect(request.video.facingMode).toEqual({ ideal: 'environment' })
    expect(request.audio).toBe(false)

    // A width on its own asks the device for its nearest mode, which is how a
    // stream sharp enough for handwriting is obtained.
    expect(request.video.width).toEqual({ ideal: 1920 })

    // A width *and* a height asks for a shape the camera may not have, and an
    // iPhone satisfies that by cropping the sensor or choosing a longer lens. The
    // preview then comes back magnified with a form that will not fit in it,
    // which is exactly what happened. Never both.
    expect(request.video.height).toBeUndefined()
    expect(request.video.aspectRatio).toBeUndefined()
  })

  it('reports whether it is already open, so no wait is shown needlessly', async () => {
    expect(cameraOpen()).toBe(false)
    await acquireCamera()
    expect(cameraOpen()).toBe(true)
  })
})

describe('closing it only when finished', () => {
  it('stops every track when released', async () => {
    const stream = await acquireCamera()
    releaseCamera()
    for (const track of stream.getTracks()) expect(track.stop).toHaveBeenCalled()
    expect(cameraOpen()).toBe(false)
  })

  it('opens again after a release, rather than handing back dead tracks', async () => {
    await acquireCamera()
    releaseCamera()
    granted = fakeStream()
    const fresh = await acquireCamera()
    expect(fresh.active).toBe(true)
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2)
  })
})

describe('when it cannot be opened', () => {
  it('does not cache the failure, so a retry is possible', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
      .mockResolvedValueOnce(fakeStream())

    await expect(acquireCamera()).rejects.toThrow()
    // Permission may have been granted in settings since. A cached rejection
    // would mean the only way back was reloading the app.
    await expect(acquireCamera()).resolves.toBeTruthy()
  })

  it('says so plainly when the browser has no camera API at all', async () => {
    global.navigator.mediaDevices = undefined
    await expect(acquireCamera()).rejects.toThrow(/cannot open the camera/i)
  })
})

describe('reading the existing permission', () => {
  it('reports what the browser already knows', async () => {
    global.navigator.permissions = { query: vi.fn(() => Promise.resolve({ state: 'granted' })) }
    expect(await cameraPermission()).toBe('granted')
  })

  it('reports not knowing rather than throwing, since Safari may not answer', async () => {
    global.navigator.permissions = { query: vi.fn(() => Promise.reject(new Error('unsupported'))) }
    expect(await cameraPermission()).toBe('unknown')
  })

  it('reports not knowing when there is no permissions API', async () => {
    global.navigator.permissions = undefined
    expect(await cameraPermission()).toBe('unknown')
  })
})


// ─── The torch ───────────────────────────────────────────────────────────────
// Reported as "my iphone light is being left on if you choose it to scan the
// document. I can't turn it off", and both halves of that were true.
//
// The state used to live in the camera view while the stream lived here, and the
// stream deliberately outlives the view. So closing the scanner lost the flag
// while the hardware light stayed on — nothing stopped the track — and reopening
// showed a torch button reading "off" whose first tap sent torch:true. Two taps
// to turn it off, the first appearing to do nothing.
//
// It is one piece of state now, kept beside the thing it controls.

/** A track that behaves as a real one does: settings report what was applied. */
function torchTrack({ honours = 'both', reports = true } = {}) {
  const track = {
    on: false,
    stop: vi.fn(function () { this.on = false }),
    getCapabilities: () => ({ torch: true }),
    getSettings() { return reports ? { torch: this.on } : {} },
    applyConstraints: vi.fn(function (constraints) {
      const wanted = constraints.advanced?.[0]?.torch ?? constraints.torch
      const shape = constraints.advanced ? 'advanced' : 'flat'
      if (honours === 'both' || honours === shape) this.on = wanted
      return Promise.resolve()
    })
  }
  return track
}

function streamOf(track) {
  return { active: true, getTracks: () => [track], getVideoTracks: () => [track] }
}

describe('the torch', () => {
  let track

  beforeEach(() => {
    track = torchTrack()
    granted = streamOf(track)
  })

  it('is off before the camera is even open', () => {
    expect(torchOn()).toBe(false)
    expect(hasTorch()).toBe(false)
  })

  it('remembers being on, so the button that follows cannot lie', async () => {
    await acquireCamera()
    expect(await setTorch(true)).toBe(true)
    // The whole bug: this is what the reopened camera view reads instead of
    // starting at false and sending torch:true on the first tap.
    expect(torchOn()).toBe(true)
    expect(track.on).toBe(true)
  })

  it('survives the camera view closing and coming back', async () => {
    await acquireCamera()
    await setTorch(true)
    // The view unmounts; the stream is held on purpose.
    expect(cameraOpen()).toBe(true)
    expect(torchOn()).toBe(true)
  })

  it('puts the light out when asked', async () => {
    await acquireCamera()
    await setTorch(true)
    expect(await turnTorchOff()).toBe(true)
    expect(torchOn()).toBe(false)
    expect(track.on).toBe(false)
  })

  it('does not touch the camera to turn off a light already off', async () => {
    await acquireCamera()
    await turnTorchOff()
    expect(track.applyConstraints).not.toHaveBeenCalled()
  })

  it('is out once the camera is released', async () => {
    await acquireCamera()
    await setTorch(true)
    releaseCamera()
    // Stopping the track is what extinguishes it; the flag has to agree, or the
    // next session starts with a button claiming a light that is not on.
    expect(track.on).toBe(false)
    expect(torchOn()).toBe(false)
  })

  it('falls back to the flat constraint when advanced is ignored', async () => {
    // Some builds accept `advanced` for on and quietly ignore it for off, which
    // is the worst possible failure for a light.
    track = torchTrack({ honours: 'flat' })
    granted = streamOf(track)
    await acquireCamera()
    expect(await setTorch(true)).toBe(true)
    expect(track.on).toBe(true)
    expect(track.applyConstraints).toHaveBeenCalledTimes(2)
  })

  it('believes the camera over the request', async () => {
    // A browser that accepts the constraint and does nothing. Claiming success
    // would leave the flag inverted and the next tap turning it back on.
    track = torchTrack({ honours: 'neither' })
    granted = streamOf(track)
    await acquireCamera()
    expect(await setTorch(true)).toBe(false)
    expect(torchOn()).toBe(false)
  })

  it('takes silence as agreement, since not every browser reports settings', async () => {
    track = torchTrack({ reports: false })
    granted = streamOf(track)
    await acquireCamera()
    expect(await setTorch(true)).toBe(true)
    expect(torchOn()).toBe(true)
  })

  it('says so rather than pretending on a phone with no light', async () => {
    const plain = { stop: vi.fn(), getCapabilities: () => ({}) }
    granted = { active: true, getTracks: () => [plain], getVideoTracks: () => [plain] }
    await acquireCamera()
    expect(hasTorch()).toBe(false)
    expect(await setTorch(true)).toBe(false)
    expect(torchOn()).toBe(false)
  })
})
