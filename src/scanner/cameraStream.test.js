import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  acquireCamera, releaseCamera, cameraOpen, cameraPermission, resetCameraForTests
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

  it('asks for the rear camera at capture resolution', async () => {
    await acquireCamera()
    const request = navigator.mediaDevices.getUserMedia.mock.calls[0][0]
    expect(request.video.facingMode).toEqual({ ideal: 'environment' })
    // Captured large and downscaled: it reads handwriting better than capturing
    // small does.
    expect(request.video.width.ideal).toBeGreaterThanOrEqual(1920)
    expect(request.audio).toBe(false)
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
