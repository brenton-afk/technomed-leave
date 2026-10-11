import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
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
  it('has auto-capture off until it is asked for', async () => {
    // It is the one mode that can go wrong while nobody is watching: it fires
    // on its own judgement, and a poor judgement has already photographed and
    // cropped the page before anybody sees the outline.
    localStorage.clear()
    show()
    const toggle = screen.getByRole('switch', { name: /Auto-capture/ })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    toggle.click()
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
  })

  it('remembers auto-capture being turned on', async () => {
    localStorage.clear()
    // Somebody who turns it on has a reason — a glossy form, a bad bench, a
    // page that will not lie flat — and the reason is still true for the next
    // form in the pile.
    show()
    screen.getByRole('switch', { name: /Auto-capture/ }).click()
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tm_clinical_prefs') || '{}').autoCapture).toBe(true))

    cleanup()
    show()
    expect(screen.getByRole('switch', { name: /Auto-capture/ }))
      .toHaveAttribute('aria-checked', 'true')
  })

  it('keeps the shutter whichever way the switch is set', async () => {
    show()
    expect(screen.getByRole('button', { name: 'Capture page' })).toBeInTheDocument()
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

describe('the corner editor measures one box', () => {
  // "When I hit the capture button it shifts violently upwards and moves the
  // entire frame."
  //
  // Not detection — the outline was right in the viewfinder. The photograph
  // and the SVG drawn over it were measured against different boxes: the
  // container was a flex item with the default flex-shrink, so on a short
  // screen it was compressed, the photograph kept its own height and was
  // clipped, and the SVG at height:100% was squashed into the shortened box.
  // Normalised corners then landed in a shorter space than the picture
  // occupied, so the quad rode up and flattened — worse with every button
  // added underneath it.
  const capture = {
    preview: 'data:image/jpeg;base64,x',
    original: 'data:image/jpeg;base64,y',
    originalWidth: 900,
    originalHeight: 1200,
    corners: [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.2 }, { x: 0.9, y: 0.8 }, { x: 0.1, y: 0.8 }]
  }
  const noop = () => {}
  const open = () => render(
    <CropReview capture={capture} cv={null} pageCount={0}
      onConfirm={noop} onRetake={noop} onAddAnother={noop} onCancel={noop} />)

  const editor = () =>
    screen.getByAltText('The photograph the page was taken from').parentElement

  it('is sized by the photograph, not by a shape computed for it', () => {
    // Two attempts went wrong before this. A box with a computed aspect ratio
    // and the photograph absolutely filling it stood taller than the screen on
    // a portrait form, putting the bottom two handles under the buttons —
    // "the bottom gets cut off, such that I can't adjust the bottom of the
    // scan even if I wanted to". Shrinking that box by its height collapsed it
    // to nothing, because a box whose only child is absolutely positioned has
    // no size of its own to shrink from.
    //
    // The photograph is an ordinary element again and gives the box its size.
    // It cannot collapse, an image having intrinsic dimensions, and it cannot
    // be the wrong shape, because nothing computes a shape.
    open()
    const photo = screen.getByAltText('The photograph the page was taken from')
    expect(photo.style.position).not.toBe('absolute')
    expect(photo.style.display).toBe('block')
    expect(editor().style.aspectRatio).toBe('')
  })

  it('is capped so that it fits on the screen', () => {
    // Room for the hint above and the buttons below. In vh because a
    // percentage would need a definite parent and would reintroduce exactly
    // the circularity that collapsed the box.
    open()
    const photo = screen.getByAltText('The photograph the page was taken from')
    expect(photo.style.maxWidth).toBe('100%')
    expect(photo.style.maxHeight).toMatch(/vh/)
  })

  it('does not clip the handles that sit on its corners', () => {
    // A handle on a corner is half outside the box by design, and clipping it
    // took away the part you aim at.
    open()
    expect(editor().style.overflow).toBe('visible')
  })

  it('keeps its corner handles, which are the point of the screen', () => {
    open()
    for (let i = 1; i <= 4; i++) {
      expect(screen.getByLabelText(`Corner ${i}`)).toBeInTheDocument()
    }
    // Inside the same box as the photograph and the outline, so all three
    // move together.
    expect(screen.getByLabelText('Corner 1').parentElement).toBe(editor())
  })

  it('can be scrolled, whatever the photograph turns out to be', () => {
    // A screen held over a bench with a signed form in the other hand must
    // never be able to put a control out of reach.
    const { container } = open()
    const sheet = container.firstChild
    expect(sheet.style.overflowY).toBe('auto')
    // Up only. Sideways is the bug that had the edit sheet sliding under a
    // thumb.
    expect(sheet.style.overflowX).toBe('hidden')
  })

  it('keeps the buttons on the screen while it is scrolled', () => {
    // The actual fix for the freeze. Shrinking the photograph to make room
    // was the wrong trade on a screen whose whole job is dragging four
    // corners accurately — so the photograph keeps its size and the controls
    // stop moving instead.
    open()
    const buttons = screen.getByText('Retake').closest('div').parentElement
    expect(buttons.style.position).toBe('sticky')
    expect(buttons.style.bottom).toBe('0px')
    // Opaque, because the photograph scrolls underneath them.
    expect(buttons.style.background).toBe('rgb(0, 0, 0)')
  })

  it('lays the outline over the photograph itself', () => {
    // The thing all three earlier bugs came down to: the outline, the handles
    // and the picture have to be measured against one box. They are the same
    // element's children now, and that element is the picture's own box.
    open()
    const photo = screen.getByAltText('The photograph the page was taken from')
    const svg = editor().querySelector('svg')
    expect(photo.parentElement).toBe(editor())
    expect(svg.parentElement).toBe(editor())
    expect(screen.getByLabelText('Corner 1').parentElement).toBe(editor())
  })

  it('draws the handles over the same box', () => {
    // Same parent, both filling it. Anything that resizes it resizes both.
    open()
    const svg = editor().querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg.style.width).toBe('100%')
    expect(svg.style.height).toBe('100%')
  })

  it('still gives way on the preview above, which is only a confirmation', () => {
    const { container } = open()
    const preview = screen.getByAltText('The page as it will be saved').parentElement
    // Read off the longhands: jsdom does not expand the `flex` shorthand.
    expect(preview.style.flexGrow).toBe('1')
    expect(preview.style.flexShrink).toBe('1')
    expect(container).toBeTruthy()
  })
})

// ─── The outline is drawn over the picture, not beside it ────────────────────
// "The frame is still all over the place."
//
// The outline is an SVG over the box, and the video sits inside that box with
// object-fit: contain — so the two coincide only while the box carries the
// camera's own aspect ratio. That was read once, from loadedmetadata, and never
// again. A track whose resolution changes afterwards — applyConstraints for the
// torch or the zoom does it, and iOS renegotiates on its own — leaves the box
// the wrong shape, the video letterboxed inside it, and the outline stretched
// across the whole box instead of across the picture.
describe('the box the outline is measured against', () => {
  const source = readFileSync(join(__dirname, 'CameraSheet.jsx'), 'utf8')

  it('is shaped by the camera’s own dimensions', () => {
    expect(source).toMatch(/aspectRatio: frame \? `\$\{frame\.width\} \/ \$\{frame\.height\}`/)
  })

  it('listens for the picture changing shape, not only for it arriving', () => {
    // loadedmetadata fires once. `resize` is the event that fires when
    // videoWidth or videoHeight change afterwards, and React has no onResize
    // for media elements — so both are attached natively.
    const attach = source.slice(source.indexOf('const attachVideo'))
    const body = attach.slice(0, attach.indexOf('\n  }, [])'))
    expect(body).toMatch(/addEventListener\('loadedmetadata', measure\)/)
    expect(body).toMatch(/addEventListener\('resize', measure\)/)
  })

  it('also checks it on every detection, whatever changed it', () => {
    // The loop already reads the true dimensions to size its canvas, so it is
    // the cheapest place to notice — and it catches a change from any cause
    // rather than only the ones anybody thought of.
    const loop = source.slice(source.indexOf('if (!video?.videoWidth) return'))
    const body = loop.slice(0, loop.indexOf('detectCanvasRef.current'))
    expect(body).toMatch(/frameRef\.current\.width !== video\.videoWidth/)
    expect(body).toMatch(/frameRef\.current\.height !== video\.videoHeight/)
    expect(body).toMatch(/setFrame\(frameRef\.current\)/)
  })

  it('draws no outline at all until the shape is known', () => {
    // Until the camera reports, the container is a 3/4 placeholder — and an
    // outline over a placeholder sits somewhere the picture is not.
    expect(source).toMatch(/\{frame && <Outline /)
  })
})

// ─── There is always a way out ───────────────────────────────────────────────
// "Need the ability to get out of the scanner when it freezes or fails, needs a
// back or exit button or similar. There can't be situations when you get stuck
// in a part of the app, you always need to be able to return to the main page."
//
// The scanner had one exit and it was the wrong shape: "Past scans" at the foot
// of the control bar, which is itself inside `{!error && …}` — so a camera that
// would not open took the only way out with it. The crop screen's Cancel sat
// below a photograph tall enough to push it off the bottom of a sheet that did
// not scroll. Both were escapes that depended on the rest of the screen
// working, which is exactly when an escape is wanted.
describe('getting out', () => {
  const source = readFileSync(join(__dirname, 'CameraSheet.jsx'), 'utf8')

  it('offers a close on the camera, outside every condition', () => {
    const view = source.slice(source.indexOf('visibility: pending ?'))
    const before = view.slice(0, view.indexOf('<div style={{ position: \'relative\', flex: 1'))
    // Rendered flat, not behind a `&&` on error or camera state.
    expect(before).toMatch(/<WayOut onCancel=\{onCancel\} \/>/)
    expect(before).not.toMatch(/&&/)
  })

  it('offers one on the crop screen too', () => {
    const crop = source.slice(
      source.indexOf('export function CropReview'), source.indexOf('export default function CameraSheet'))
    expect(crop).toMatch(/<WayOut onCancel=\{onCancel\} \/>/)
  })

  it('is fixed on the crop screen, so scrolling cannot lose it', () => {
    const crop = source.slice(
      source.indexOf('export function CropReview'), source.indexOf('export default function CameraSheet'))
    const block = crop.slice(crop.indexOf('zIndex: 10'))
    expect(crop.slice(0, crop.indexOf('<WayOut'))).toMatch(/position: 'fixed', top: 0, left: 0/)
    expect(block).toBeTruthy()
  })

  it('has nothing to go wrong in it', () => {
    // No state, no condition, one call. The dumbest thing on the page on
    // purpose: it is what is left when everything else has failed.
    const out = source.slice(source.indexOf('function WayOut'))
    const body = out.slice(0, out.indexOf('\n}'))
    expect(body).not.toMatch(/useState|useEffect|useRef/)
    expect(body).toMatch(/onClick=\{onCancel\}/)
    expect(body).toMatch(/aria-label="Close the scanner"/)
  })

  it('is big enough to hit with a thumb', () => {
    const out = source.slice(source.indexOf('function WayOut'))
    expect(out.slice(0, out.indexOf('\n}'))).toMatch(/minWidth: 44, minHeight: 44/)
  })
})

// ─── The shutter must not move the page ──────────────────────────────────────
// "The scan is still jumping last minute. Captures the frame well then when I
// hit scan, the page jumps up and it cuts off the bottom part of the page."
//
// Capture re-detects on the still, which is right: the corners handed in came
// from a detection up to a tenth of a second earlier, and a hand-held phone
// drifts in between. What was wrong is that it took whatever came back, every
// time, without comparing it to what was on the screen.
//
// The outline somebody watched settle is the product of a tracker — dozens of
// detections, smoothed, each checked against the last. The still gets one
// detection on one frame, which is exactly the noisy thing the tracker exists
// to average out. Giving the single reading authority over the many inverted
// the arrangement, and one bad frame moved the crop off the page after the
// shutter had gone.
describe('re-detecting at the shutter', () => {
  const source = readFileSync(join(__dirname, 'CameraSheet.jsx'), 'utf8')
  const capture = source.slice(source.indexOf('const capture = useCallback'))
  const body = capture.slice(0, capture.indexOf('\n  }, [])'))

  it('only accepts a reading that agrees with the one on screen', () => {
    expect(body).toMatch(/maxCornerShift\(corners, onTheStill\?\.corners\) <= CAPTURE_AGREEMENT/)
    expect(body).toMatch(/if \(onTheStill\?\.corners && agrees\)/)
  })

  it('takes it outright when there was nothing on screen to disagree with', () => {
    // No tracked outline — the engine failed, or the page was only just
    // found. Anything the still can offer beats nothing.
    expect(body).toMatch(/const agrees = corners\s*\n\s*\?[\s\S]{0,120}: true/)
  })

  it('allows a real correction through', () => {
    // A tenth of a second of hand drift is a fraction of the threshold. What
    // is excluded is the still latching onto something else entirely, which
    // moves a corner a long way.
    const threshold = /const CAPTURE_AGREEMENT = ([\d.]+)/.exec(source)
    expect(threshold).toBeTruthy()
    expect(Number(threshold[1])).toBeGreaterThan(0.03)
    expect(Number(threshold[1])).toBeLessThan(0.2)
  })

  it('still falls back to the whole frame when neither reading holds up', () => {
    // Nothing found on the still, and the tracked corners do not sit on
    // anything in it either. Honestly wrong beats confidently wrong.
    expect(body).toMatch(/cornersAreSupported/)
    expect(body).toMatch(/corners = null/)
  })
})
