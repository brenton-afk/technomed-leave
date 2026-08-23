import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import CameraSheet from './CameraSheet.jsx'
import { resetCameraForTests, torchOn, acquireCamera, setTorch }
  from '../../scanner/cameraStream.js'
import { resetOpenCvForTests } from '../../scanner/opencvLoader.js'

// The scanner has now been broken three times in ways that thirty seconds with a
// phone would have caught and that no test covered: a preview cropped to
// uselessness, an 11MB download in front of the shutter, and a video element
// destroyed on the second page. This is the test that should have existed first —
// it does not need a camera, only the promise that the app puts one on screen.

function fakeStream() {
  const track = { stop: vi.fn(), getCapabilities: () => ({}), applyConstraints: vi.fn() }
  return { active: true, getTracks: () => [track], getVideoTracks: () => [track] }
}

let stream

beforeEach(() => {
  resetCameraForTests()
  resetOpenCvForTests()
  stream = fakeStream()
  global.navigator.mediaDevices = { getUserMedia: vi.fn(() => Promise.resolve(stream)) }
  // jsdom has no media pipeline; the component only ever needs these to exist.
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
  // jsdom does not fetch the engine's script, so every test here runs in the
  // no-engine state — which is the one that has to keep working anyway.
})

afterEach(() => {
  resetCameraForTests()
  resetOpenCvForTests()
  vi.restoreAllMocks()
})

const noop = () => {}
const show = (props = {}) =>
  render(<CameraSheet pageCount={0} onCapture={noop} onDone={noop} onFallback={noop} {...props} />)

describe('opening the camera', () => {
  it('asks for the camera and puts the stream on the video', async () => {
    show()
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())
    const video = document.querySelector('video')
    expect(video).not.toBeNull()
    await waitFor(() => expect(video.srcObject).toBe(stream))
  })

  it('stops saying "Opening camera" once it is open', async () => {
    show()
    expect(screen.getByText(/Opening camera/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/Opening camera/)).not.toBeInTheDocument())
  })

  it('enables the shutter once the camera is open, engine or no engine', async () => {
    show()
    const shutter = screen.getByRole('button', { name: 'Capture page' })
    await waitFor(() => expect(shutter).not.toBeDisabled())
  })

  it('shows the video at the camera\'s own shape, not cropped to the screen', async () => {
    show()
    const video = document.querySelector('video')
    await waitFor(() => expect(video.srcObject).toBe(stream))
    // `cover` is what magnified the preview and lost the edges of the form.
    expect(video.style.objectFit).toBe('contain')
  })

  it('never lets the engine hold up the camera', async () => {
    show()
    // The engine never arrives here — jsdom does not fetch the script. That is
    // the state that read as "the scanner does not work", and the shutter must
    // not care about it.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Capture page' })).not.toBeDisabled())
    expect(screen.getByText(/Ready to shoot/)).toBeInTheDocument()
    // Nothing over the picture, either: the curtain is what looked like a hang.
    expect(screen.queryByText(/Starting the scanner/)).not.toBeInTheDocument()
  })

  it('says the whole photo is kept once the engine has given up', async () => {
    show()
    await waitFor(() => expect(document.querySelector('script[data-opencv]')).not.toBeNull())
    document.querySelector('script[data-opencv]').dispatchEvent(new Event('error'))
    await waitFor(() => expect(screen.getByText(/whole photo is kept/)).toBeInTheDocument())
    // And the shutter is still there.
    expect(screen.getByRole('button', { name: 'Capture page' })).not.toBeDisabled()
  })

  it('offers a retry when the camera fails, without reloading the app', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn(() =>
      Promise.reject(Object.assign(new Error('busy'), { name: 'NotReadableError' })))
    show()
    await waitFor(() => expect(screen.getByText(/in use by something else/)).toBeInTheDocument())

    resetCameraForTests()
    navigator.mediaDevices.getUserMedia = vi.fn(() => Promise.resolve(stream))
    screen.getByRole('button', { name: 'Try again' }).click()
    await waitFor(() => expect(document.querySelector('video')?.srcObject).toBe(stream))
  })

  it('reads out what the browser said, since that is the only diagnostic', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn(() =>
      Promise.reject(Object.assign(new Error('Could not start video source'), { name: 'NotReadableError' })))
    show()
    await waitFor(() => expect(screen.getByText(/NotReadableError/)).toBeInTheDocument())
    expect(screen.getByText(/Could not start video source/)).toBeInTheDocument()
  })

  it('offers the photo library when access is refused', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn(() =>
      Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })))
    const onFallback = vi.fn()
    show({ onFallback })
    await waitFor(() => expect(screen.getByText(/Camera access was blocked/)).toBeInTheDocument())
    screen.getByRole('button', { name: /Choose photos instead/ }).click()
    expect(onFallback).toHaveBeenCalled()
  })

  it('says something useful when the browser has no camera at all', async () => {
    global.navigator.mediaDevices = undefined
    show()
    await waitFor(() => expect(screen.getByText(/cannot open the camera/i)).toBeInTheDocument())
  })
})

describe('the controls', () => {
  it('has auto-capture on by default, and lets it be turned off', async () => {
    show()
    const toggle = screen.getByRole('checkbox', { name: /Auto-capture/ })
    expect(toggle).toBeChecked()
    toggle.click()
    await waitFor(() => expect(toggle).not.toBeChecked())
  })

  it('keeps the shutter when auto-capture is off', async () => {
    show()
    screen.getByRole('checkbox', { name: /Auto-capture/ }).click()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Capture page' })).toBeInTheDocument())
  })

  it('offers Done once there are pages', async () => {
    show({ pageCount: 2 })
    await waitFor(() => expect(screen.getByText(/Done · 2/)).toBeInTheDocument())
  })
})

describe('opening it a second time', () => {
  it('does not ask the browser again', async () => {
    const first = show()
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1))
    first.unmount()

    show()
    await waitFor(() => expect(document.querySelector('video')?.srcObject).toBe(stream))
    // One prompt for the session. Re-asking is what made a three-page scan stall
    // three times.
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
  })
})


describe('the torch', () => {
  // "My iphone light is being left on if you choose it to scan the document. I
  // can't turn it off." The light outlived the camera view because the stream
  // does, and the state used to live in the view.
  function torchStream() {
    const track = {
      on: false,
      stop: vi.fn(function () { this.on = false }),
      getCapabilities: () => ({ torch: true }),
      getSettings() { return { torch: this.on } },
      applyConstraints: vi.fn(function (c) {
        this.on = c.advanced?.[0]?.torch ?? c.torch
        return Promise.resolve()
      })
    }
    return {
      track,
      stream: { active: true, getTracks: () => [track], getVideoTracks: () => [track] }
    }
  }

  let track

  beforeEach(() => {
    const made = torchStream()
    track = made.track
    stream = made.stream
    navigator.mediaDevices.getUserMedia = vi.fn(() => Promise.resolve(stream))
  })

  it('offers a torch only where the camera has one', async () => {
    show()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Torch' })).toBeInTheDocument())
  })

  it('turns on, and says so', async () => {
    show()
    const button = await waitFor(() => screen.getByRole('button', { name: 'Torch' }))
    button.click()
    await waitFor(() => expect(track.on).toBe(true))
    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'))
  })

  it('goes out when the camera view is left', async () => {
    const view = show()
    const button = await waitFor(() => screen.getByRole('button', { name: 'Torch' }))
    button.click()
    await waitFor(() => expect(track.on).toBe(true))

    // Tapping Done closes the sheet. The stream is held on purpose — so if
    // nothing here puts the light out, it burns on with the app showing no camera.
    view.unmount()
    await waitFor(() => expect(track.on).toBe(false))
    expect(torchOn()).toBe(false)
  })

  it('goes out when the phone goes in a pocket', async () => {
    show()
    const button = await waitFor(() => screen.getByRole('button', { name: 'Torch' }))
    button.click()
    await waitFor(() => expect(track.on).toBe(true))

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(track.on).toBe(false))
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('reads the light from the stream, not from a fresh false', async () => {
    // The button's starting state is where this went wrong. The stream outlives
    // the view, so a light on with a button reading "off" is reachable — and its
    // first tap then sent torch:true, which is exactly "I can't turn it off".
    await acquireCamera()
    await setTorch(true)
    expect(track.on).toBe(true)

    show()
    const button = await waitFor(() => screen.getByRole('button', { name: 'Torch' }))
    expect(button.getAttribute('aria-pressed')).toBe('true')

    // One tap, and it is out.
    button.click()
    await waitFor(() => expect(track.on).toBe(false))
    expect(torchOn()).toBe(false)
  })
})
