import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadOpenCv, openCvReady, resetOpenCvForTests } from './opencvLoader.js'

// The engine is eleven megabytes, and how it is loaded has now been wrong twice.
// A script tag behind a full-screen wait looked like a hang. Fetching it for a
// progress bar was worse: response, chunks, Blob, a 22MB UTF-16 string and then
// eval, on a phone already holding a camera stream — enough to have the tab
// killed, which presented as the camera not opening at all.
//
// It is a script tag again, so the browser streams and compiles it without the
// copies. What these hold to is the rest: a deadline, a failure that is not
// cached, and waiting for the WASM runtime rather than merely for the file.

/** The injected script, so a test can decide what happens to it. */
function injected() {
  return document.querySelector('script[data-opencv]')
}

/**
 * Behaves as the real build does: `window.cv` becomes a *thenable* whose Mat does
 * not exist until it resolves, and which resolves to itself.
 *
 * This is the shape that was got wrong twice. Waiting for `.Mat` on the exported
 * object waits forever; seeding `onRuntimeInitialized` on it is discarded, because
 * the UMD wrapper overwrites `window.cv` with the factory's return value.
 */
function succeedAsThenable() {
  let settle
  const module = {
    then(onResolved) { settle = () => onResolved(module); return module }
  }
  window.cv = module
  injected().dispatchEvent(new Event('load'))
  setTimeout(() => { module.Mat = function () {}; settle?.() }, 0)
}

/** An older build: the classes simply appear, with no announcement at all. */
function succeedSilently() {
  window.cv = {}
  injected().dispatchEvent(new Event('load'))
  setTimeout(() => { window.cv.Mat = function () {} }, 0)
}

beforeEach(() => {
  resetOpenCvForTests()
  vi.useRealTimers()
})

afterEach(() => {
  resetOpenCvForTests()
  vi.restoreAllMocks()
})

describe('loading the engine', () => {
  it('waits for the thenable to resolve, which is how this build reports ready', async () => {
    // The bug that produced "Edge detection loading" for ever: `window.cv.Mat`
    // does not exist until the exported thenable resolves.
    const loading = loadOpenCv()
    await waitForScript()
    succeedAsThenable()
    const cv = await loading
    expect(typeof cv.Mat).toBe('function')
    expect(openCvReady()).toBe(true)
  })

  it('leaves the module on the global, not the thenable', async () => {
    // So a second caller and openCvReady() both find something usable.
    const loading = loadOpenCv()
    await waitForScript()
    succeedAsThenable()
    await loading
    expect(typeof window.cv.Mat).toBe('function')
  })

  it('notices a build that announces nothing and simply becomes ready', async () => {
    // The poll underneath every handshake. Being wrong about this again costs the
    // whole feature; the poll costs one comparison every 150ms.
    const loading = loadOpenCv()
    await waitForScript()
    succeedSilently()
    const cv = await loading
    expect(typeof cv.Mat).toBe('function')
  })

  it('fetches once however many callers ask', async () => {
    const both = Promise.all([loadOpenCv(), loadOpenCv()])
    await waitForScript()
    expect(document.querySelectorAll('script[data-opencv]')).toHaveLength(1)
    succeedAsThenable()
    const [a, b] = await both
    expect(a).toBe(b)
  })

  it('costs nothing at all once it is in memory', async () => {
    window.cv = { Mat: function () {} }
    await loadOpenCv()
    expect(injected()).toBeNull()
  })
})

/** The script is appended synchronously, but React and promises are not. */
async function waitForScript() {
  for (let i = 0; i < 20 && !injected(); i++) await Promise.resolve()
  expect(injected()).not.toBeNull()
}

describe('when it does not arrive', () => {
  it('gives up rather than leaving the scanner waiting forever', async () => {
    vi.useFakeTimers()
    const attempt = loadOpenCv()
    const assertion = expect(attempt).rejects.toThrow(/too long/i)
    await vi.advanceTimersByTimeAsync(91000)
    await assertion
  })

  it('reports a script that will not load', async () => {
    const attempt = loadOpenCv()
    await waitForScript()
    injected().dispatchEvent(new Event('error'))
    await expect(attempt).rejects.toThrow(/Could not load/)
  })

  it('does not cache a failure, so a retry can succeed', async () => {
    const first = loadOpenCv()
    await waitForScript()
    injected().dispatchEvent(new Event('error'))
    await expect(first).rejects.toThrow()

    // Back on wifi. A cached rejection would mean reloading the app was the only
    // way to get edge detection back.
    resetOpenCvForTests()
    const second = loadOpenCv()
    await waitForScript()
    succeedAsThenable()
    await expect(second).resolves.toBeTruthy()
  })

  it('gives up on a file that loads but is not the engine', async () => {
    // What a catch-all rewrite serving index.html would produce: the script runs,
    // nothing registers, and the deadline is what catches it. It cannot be spotted
    // sooner — the real library adopts the very object seeded for it, so there is
    // no identity to compare.
    vi.useFakeTimers()
    const attempt = loadOpenCv()
    const assertion = expect(attempt).rejects.toThrow(/too long/i)
    for (let i = 0; i < 20 && !injected(); i++) await Promise.resolve()
    injected()?.dispatchEvent(new Event('load'))
    await vi.advanceTimersByTimeAsync(91000)
    await assertion
  })
})


// The real 11MB file is exercised by `npm run check:engine` rather than here.
// Running an emscripten bundle inside vitest's module environment fights the
// harness — and it is the check that matters most, so it should not be the one
// that is flaky. See scripts/opencv-handshake.mjs.
