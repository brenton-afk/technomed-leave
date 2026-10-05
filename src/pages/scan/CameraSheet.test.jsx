import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import CameraSheet, { Outline, CropReview } from './CameraSheet.jsx'
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
    // A switch now, not a checkbox in a caption. It was asked for again as
    // though it did not exist, which is the only review a control needs.
    show()
    const toggle = screen.getByRole('switch', { name: /Auto-capture/ })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    toggle.click()
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'))
  })

  it('remembers auto-capture being turned off', async () => {
    // From a known state: the preference is now persisted, so the test above
    // leaves it off and this one would otherwise be toggling it back on.
    localStorage.clear()
    // Somebody who turns it off has a reason — a glossy form, a bad bench, a
    // page that will not lie flat — and the reason is still true for the next
    // form in the pile.
    show()
    screen.getByRole('switch', { name: /Auto-capture/ }).click()
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tm_clinical_prefs') || '{}').autoCapture).toBe(false))

    cleanup()
    show()
    expect(screen.getByRole('switch', { name: /Auto-capture/ }))
      .toHaveAttribute('aria-checked', 'false')
  })

  it('keeps the shutter when auto-capture is off', async () => {
    show()
    screen.getByRole('switch', { name: /Auto-capture/ }).click()
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


describe('escaping the app shell', () => {
  // "Notice how the Done button is stuck behind the tabs at the bottom. I can't
  // hit Done when it is scanned now."
  //
  // The sheet is rendered from a screen inside `.tm-scroll`, which on iOS is a
  // stacking context of its own because of `-webkit-overflow-scrolling: touch`.
  // A fixed child of it is ranked only against that region's own contents, so
  // zIndex 3100 could not clear a tab bar of 100 — the number was never the
  // problem. It stopped working the moment the tab bar became a row of the
  // layout instead of a fixed element in the same context.
  function inScrollRegion(props = {}) {
    const host = document.createElement('div')
    host.className = 'tm-scroll'
    document.body.appendChild(host)
    const view = render(
      <CameraSheet pageCount={1} onCapture={noop} onDone={noop} onFallback={noop} {...props} />,
      { container: host })
    return { host, view }
  }

  it('renders the camera on the body, not inside the scrolling region', async () => {
    const { host } = inScrollRegion()
    const video = await waitFor(() => {
      const found = document.querySelector('video')
      expect(found).not.toBeNull()
      return found
    })
    // The whole guarantee: nothing between this layer and the document can put
    // it in a stacking context, so nothing can rank the tab bar above it.
    expect(host.contains(video)).toBe(false)
    expect(document.body.contains(video)).toBe(true)
  })

  it('keeps Done out of the scrolling region too', async () => {
    const { host } = inScrollRegion()
    const done = await waitFor(() => screen.getByText(/Done · 1/))
    expect(host.contains(done)).toBe(false)
  })

  it('takes the sheet away with it when it closes', async () => {
    const { view } = inScrollRegion()
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull())
    // A portal that outlived its component would leave a black screen over the
    // app with no way back.
    view.unmount()
    expect(document.querySelector('video')).toBeNull()
  })
})

describe('the outline over the camera', () => {
  const VIEW = {
    opacity: 1,
    corners: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.12 }, { x: 0.88, y: 0.9 }, { x: 0.12, y: 0.88 }]
  }

  it('is white, not the brand colour', async () => {
    // "I don't like that the frame is green either." Anything drawn over the
    // camera is part of the viewfinder; the brand colour belongs to the app's
    // own chrome, and mixing the two made it look like a widget pasted onto a
    // video rather than the edge of the page itself.
    const { container } = render(<Outline view={VIEW} countdown={0} />)
    const stroked = [...container.querySelectorAll('[stroke]')]
      .map(el => el.getAttribute('stroke'))
      .filter(v => v && v !== 'none')
    expect(stroked.length).toBeGreaterThan(0)
    for (const stroke of stroked) expect(stroke).toBe('#fff')
  })

  it('eases towards the detection rather than jumping to it', async () => {
    // Detection runs at around ten frames a second and the video at sixty. The
    // outline used to redraw only when a detection finished, which is what made
    // it lag behind the picture. It now eases towards the last detection on its
    // own animation frame.
    const { container } = render(<Outline view={VIEW} countdown={0} />)
    const polygon = container.querySelector('polygon')
    // Nothing in the markup: the points arrive from the animation loop.
    expect(polygon.getAttribute('points')).toBeNull()
    await waitFor(() => expect(polygon.getAttribute('points')).toBeTruthy())
    // First frame lands part of the way, not all of it: 10% eased by 0.35.
    const firstX = Number(polygon.getAttribute('points').split(',')[0])
    expect(firstX).toBeGreaterThan(0)
    expect(firstX).toBeLessThanOrEqual(10)
  })

  it('draws a bracket at each corner', async () => {
    const { container } = render(<Outline view={VIEW} countdown={0} />)
    const path = container.querySelector('path[stroke]')
    await waitFor(() => expect(path.getAttribute('d')).toBeTruthy())
    // Four corners, each an L of two segments.
    expect(path.getAttribute('d').match(/M /g)).toHaveLength(4)
  })

  it('hides itself when no page is found', async () => {
    // The element stays mounted — the animation loop lives in it, and unmounting
    // on every lost frame would restart the easing from nowhere each time a page
    // came back. It fades instead.
    const { container } = render(<Outline view={null} countdown={0} />)
    const svg = container.querySelector('svg')
    await waitFor(() => expect(svg.style.opacity).toBe('0'))
    expect(container.querySelector('polygon').getAttribute('points')).toBeNull()
  })
})

describe('what the review screen offers', () => {
  const CAPTURE = {
    source: { width: 800, height: 600 },
    corners: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }],
    flattened: 'data:image/jpeg;base64,AAA',
    preview: 'data:image/jpeg;base64,BBB',
    original: 'data:image/jpeg;base64,CCC'
  }

  const review = (props = {}) => render(
    <CropReview capture={CAPTURE} cv={null}
      pageCount={0} onConfirm={() => {}} onRetake={() => {}}
      onAddAnother={() => {}} onCancel={() => {}} {...props} />
  )

  it('offers a way out of the scanner', async () => {
    // Auto-capture fires on its own. Landing in a review whose only exits are
    // Retake and keep-this-page is a trap.
    const onCancel = vi.fn()
    review({ onCancel })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('asks outright whether there is another page', async () => {
    // Asked for directly, and the two mistakes are not equal: reading a
    // one-page form as finished costs nothing, while sending page one of
    // three to a distributor and never noticing costs a tray of implants
    // nobody is billed for.
    review()
    expect(screen.getByText('Is there a second page?')).toBeInTheDocument()
  })

  it('counts up as the pages go on', async () => {
    review({ pageCount: 1 })
    expect(screen.getByText('Is there a page 3?')).toBeInTheDocument()
  })

  it('reads the page without a second confirmation', async () => {
    // It used to take three more taps: keep the page, close the camera, then
    // find "Read usage document" behind it. Answering "no" still reads.
    const onConfirm = vi.fn()
    review({ onConfirm })
    fireEvent.click(screen.getByRole('button', { name: 'No — read it' }))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('goes back for another page when the answer is yes', async () => {
    const onAddAnother = vi.fn()
    review({ onAddAnother })
    fireEvent.click(screen.getByRole('button', { name: 'Yes — scan it' }))
    expect(onAddAnother).toHaveBeenCalled()
  })

  it('counts the pages already taken in what it offers to read', async () => {
    review({ pageCount: 1 })
    expect(screen.getByRole('button', { name: 'No — read 2' })).toBeInTheDocument()
  })

  it('offers each answer exactly once', async () => {
    // "Add a page" used to sit in the row below as well, so there were two
    // ways to say yes and they looked like different things.
    review({ pageCount: 1 })
    expect(screen.queryByRole('button', { name: 'Add a page' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Yes/ })).toHaveLength(1)
  })
})

describe('the viewfinder, as a scanner rather than a camera', () => {
  // "On google drive it makes the frame a shadow section and has a checked
  // pattern that flashes through the page to show you that the scanner is
  // working. It is more nuanced and less basic than the scanner you have."
  //
  // Two things were missing. The surroundings were as bright as the page, so
  // the page sat in the bench rather than lifting off it; and a still outline
  // over a still page gives no sign the thing is alive.
  const view = {
    corners: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }],
    opacity: 1
  }
  const draw = (props = {}) => render(<Outline view={view} countdown={0} {...props} />)

  it('dims everything that is not the page', async () => {
    const { container } = draw()
    const scrim = container.querySelector('rect[mask]')
    expect(scrim).toBeTruthy()
    expect(scrim.getAttribute('mask')).toBe('url(#page-hole)')
    // Well short of opaque: the surroundings are how somebody sees they are
    // about to cut off a corner.
    expect(Number(scrim.getAttribute('fill-opacity'))).toBeGreaterThan(0.2)
    expect(Number(scrim.getAttribute('fill-opacity'))).toBeLessThan(0.6)
  })

  it('cuts the page out of the dimming, rather than drawing over it', async () => {
    const { container } = draw()
    const mask = container.querySelector('mask#page-hole')
    // White sheet, black page: the page is the hole.
    expect(mask.querySelector('rect').getAttribute('fill')).toBe('#fff')
    expect(mask.querySelector('polygon').getAttribute('fill')).toBe('#000')
  })

  it('sweeps a band of light across the page', async () => {
    const { container } = draw()
    const sweep = container.querySelector('.tm-scan-sweep')
    expect(sweep).toBeTruthy()
    // Clipped to the paper, or it would wash across the whole viewfinder.
    expect(sweep.closest('g').getAttribute('clip-path')).toBe('url(#page-only)')
  })

  it('keeps the outline fine', async () => {
    // Asked for: "make the outline border a little thinner". A heavy line sits
    // on top of the picture and reads as a drawing; a fine one reads as the
    // edge of the paper.
    const { container } = draw()
    const line = container.querySelectorAll('polygon[stroke="#fff"]')
    expect(line.length).toBeGreaterThan(0)
    expect(Number(line[0].getAttribute('stroke-width'))).toBeLessThanOrEqual(0.5)
  })
})
