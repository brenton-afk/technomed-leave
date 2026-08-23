import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadOpenCv, openCvReady, resetOpenCvForTests } from './opencvLoader.js'

// The engine is eleven megabytes. The first version fetched it with a plain
// script tag behind a full-screen "Starting the scanner…", which on a hospital
// connection is most of a minute of nothing moving and no way to take a
// photograph — reported, fairly, as the scanner being broken.
//
// So: the bytes are counted as they arrive, the wait has a deadline, and a
// failure is never cached. Every one of those is a guarantee the camera relies
// on, since it now runs without waiting for any of this.

/** A script that registers a cv module asynchronously, as the real one does. */
const ASYNC_SOURCE = `
  window.cv = window.cv || {};
  const handler = window.cv.onRuntimeInitialized;
  setTimeout(() => { window.cv.Mat = function () {}; handler && handler(); }, 0);
`

function respondWith(source, { length = source.length, stream = true } = {}) {
  const encoded = new TextEncoder().encode(source)
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    headers: { get: name => (name === 'content-length' ? String(length) : null) },
    text: () => Promise.resolve(source),
    body: stream
      ? {
        getReader() {
          // Two chunks, so progress has something to report between them.
          const halves = [encoded.slice(0, encoded.length >> 1), encoded.slice(encoded.length >> 1)]
          let i = 0
          return { read: () => Promise.resolve(i < halves.length ? { done: false, value: halves[i++] } : { done: true }) }
        }
      }
      : undefined
  }))
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
  it('waits for the WASM runtime, not merely for the file', async () => {
    // Resolving on the download gives a module whose Mat is not a constructor.
    respondWith(ASYNC_SOURCE)
    const cv = await loadOpenCv()
    expect(typeof cv.Mat).toBe('function')
    expect(openCvReady()).toBe(true)
  })

  it('reports progress as the bytes arrive', async () => {
    respondWith(ASYNC_SOURCE)
    const seen = []
    await loadOpenCv(f => seen.push(f))
    expect(seen.length).toBeGreaterThan(1)
    expect(seen[seen.length - 1]).toBe(1)
    // Monotonic, so a percentage on screen never goes backwards.
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
  })

  it('still loads when the response cannot be streamed or measured', async () => {
    respondWith(ASYNC_SOURCE, { length: 0, stream: false })
    const cv = await loadOpenCv()
    expect(typeof cv.Mat).toBe('function')
  })

  it('downloads once however many callers ask', async () => {
    respondWith(ASYNC_SOURCE)
    const [a, b] = await Promise.all([loadOpenCv(), loadOpenCv()])
    expect(a).toBe(b)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('costs nothing at all once it is in memory', async () => {
    respondWith(ASYNC_SOURCE)
    await loadOpenCv()
    resetOpenCvForTests()          // forget the promise, keep window.cv
    window.cv = { Mat: function () {} }
    global.fetch = vi.fn()
    await loadOpenCv()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('when it does not arrive', () => {
  it('gives up rather than leaving the scanner waiting forever', async () => {
    vi.useFakeTimers()
    // A download that never completes: the case that looked like a hang.
    global.fetch = vi.fn(() => new Promise(() => {}))
    const attempt = loadOpenCv()
    const assertion = expect(attempt).rejects.toThrow(/too long/i)
    await vi.advanceTimersByTimeAsync(46000)
    await assertion
  })

  it('does not cache a failure, so a retry can succeed', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('offline')))
    await expect(loadOpenCv()).rejects.toThrow()

    respondWith(ASYNC_SOURCE)
    // Back on wifi. A cached rejection would mean reloading the app was the only
    // way to get edge detection back.
    await expect(loadOpenCv()).resolves.toBeTruthy()
  })

  it('reports a bad response rather than running it', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 404, headers: { get: () => null }
    }))
    await expect(loadOpenCv()).rejects.toThrow(/404/)
  })

  it('gives up on a file that is not the engine, rather than hanging', async () => {
    // What a catch-all rewrite serving index.html would produce. It cannot be
    // detected the moment the script runs: the real library reuses the very
    // object seeded for it, so there is nothing to compare identities against.
    // The deadline is what catches it.
    vi.useFakeTimers()
    respondWith('/* not opencv */')
    const attempt = loadOpenCv()
    const assertion = expect(attempt).rejects.toThrow(/too long/i)
    await vi.advanceTimersByTimeAsync(46000)
    await assertion
  })
})
