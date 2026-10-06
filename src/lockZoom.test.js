import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { currentScale, isZoomed, resetZoom, watchZoom } from './lockZoom.js'

// Two fingers on a scrolling list is a pinch, it happens by accident several
// times a day, and an installed web app on iOS remembers the zoom — across a
// refresh, a relaunch and the night. A page at 1.1 is not obviously zoomed; it
// quietly loses the right-hand edge, which is where the controls are.

const ORIGINAL = 'width=device-width, initial-scale=1, viewport-fit=cover'

const pageWith = scale => {
  const meta = document.createElement('meta')
  meta.setAttribute('name', 'viewport')
  meta.setAttribute('content', ORIGINAL)
  document.head.appendChild(meta)
  const listeners = {}
  // A stand-in rather than the real document: visibilityState is a getter and
  // cannot be assigned, and the point of this test is to drive it.
  const target = {
    document: {
      visibilityState: 'visible',
      addEventListener: (k, fn) => { listeners[k] = fn },
      removeEventListener: k => { delete listeners[k] },
      querySelector: sel => document.querySelector(sel)
    },
    visualViewport: { scale },
    addEventListener: (k, fn) => { listeners[k] = fn },
    removeEventListener: k => { delete listeners[k] }
  }
  return { meta, target, fire: k => listeners[k]?.() }
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', fn => { fn(); return 1 })
})
afterEach(() => {
  document.head.querySelectorAll('meta[name="viewport"]').forEach(m => m.remove())
  vi.unstubAllGlobals()
})

describe('noticing a zoom', () => {
  it('reads the scale the browser reports', () => {
    expect(currentScale({ scale: 1.4 })).toBe(1.4)
  })

  it('assumes 1 where the browser will not say', () => {
    // Desktop Safari and older Android have no visualViewport. Guessing
    // "zoomed" there would reset the page under somebody constantly.
    expect(currentScale(undefined)).toBe(1)
    expect(isZoomed(undefined)).toBe(false)
  })

  it('ignores rounding, catches a pinch', () => {
    expect(isZoomed({ scale: 1.001 })).toBe(false)
    expect(isZoomed({ scale: 1.1 })).toBe(true)
    // Zoomed out is just as much of a problem: the app comes back tiny.
    expect(isZoomed({ scale: 0.8 })).toBe(true)
  })
})

describe('resetting it', () => {
  it('locks the viewport and then gives pinch back', () => {
    // Pinch has to survive. This app is used to read handwritten forms, and
    // taking magnification off the screen that needs it most would be a worse
    // bug than the one being fixed.
    const { meta } = pageWith(1.3)
    expect(resetZoom(document)).toBe(true)
    expect(meta.getAttribute('content')).toBe(ORIGINAL)
  })

  it('passes through a locked state on the way', () => {
    // The lock is what forces the engine back to 1. Restoring before it has
    // acted leaves the page zoomed — the bug, reproduced by its own fix — so
    // the restore waits a frame.
    const { meta } = pageWith(1.3)
    const seen = []
    vi.stubGlobal('requestAnimationFrame', fn => { seen.push(meta.getAttribute('content')); fn() })
    resetZoom(document)
    expect(seen[0]).toMatch(/maximum-scale=1/)
    expect(seen[0]).toMatch(/user-scalable=no/)
    // And the safe area survives the round trip, or headers slide under the
    // clock on a notched iPhone.
    expect(seen[0]).toMatch(/viewport-fit=cover/)
  })

  it('says so when there is no viewport tag to work with', () => {
    expect(resetZoom(document)).toBe(false)
  })
})

describe('watching for the app being come back to', () => {
  it('straightens a zoomed page when it becomes visible', () => {
    const { meta, target, fire } = pageWith(1.25)
    const spy = vi.spyOn(meta, 'setAttribute')
    watchZoom(target)
    fire('visibilitychange')
    expect(spy).toHaveBeenCalled()
  })

  it('also catches a restore from the back/forward cache', () => {
    // visibilitychange does not fire for that one at all.
    const { meta, target, fire } = pageWith(1.25)
    const spy = vi.spyOn(meta, 'setAttribute')
    watchZoom(target)
    fire('pageshow')
    expect(spy).toHaveBeenCalled()
  })

  it('catches a rotation, where a stuck zoom shows most', () => {
    const { meta, target, fire } = pageWith(1.25)
    const spy = vi.spyOn(meta, 'setAttribute')
    watchZoom(target)
    fire('orientationchange')
    expect(spy).toHaveBeenCalled()
  })

  it('leaves a page that is not zoomed completely alone', () => {
    const { meta, target, fire } = pageWith(1)
    const spy = vi.spyOn(meta, 'setAttribute')
    watchZoom(target)
    fire('pageshow')
    expect(spy).not.toHaveBeenCalled()
  })

  it('never resets while somebody is using the app', () => {
    // Pulling the zoom out from under somebody who has just pinched into a
    // scan to read a lot number would be its own bug.
    const { meta, target, fire } = pageWith(1.4)
    target.document.visibilityState = 'hidden'
    const spy = vi.spyOn(meta, 'setAttribute')
    watchZoom(target)
    fire('visibilitychange')
    fire('pageshow')
    expect(spy).not.toHaveBeenCalled()
  })

  it('can be stopped, and lets go of its listeners', () => {
    const { meta, target, fire } = pageWith(1.4)
    const stop = watchZoom(target)
    stop()
    const spy = vi.spyOn(meta, 'setAttribute')
    fire('pageshow')
    expect(spy).not.toHaveBeenCalled()
  })

  it('does nothing at all where there is no window', () => {
    expect(() => watchZoom(undefined)()).not.toThrow()
  })
})
