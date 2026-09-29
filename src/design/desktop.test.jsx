import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useIsDesktop, DESKTOP_MIN } from './viewport.js'

// The phone layout is the one this app has to be best at, and the desktop work
// must not cost it anything. These check the switch itself — that a narrow
// window is treated as a phone whatever machine it is on, and that a resize is
// noticed rather than needing a reload.

function widthIs(px) {
  const listeners = new Set()
  window.matchMedia = vi.fn(query => ({
    matches: px >= DESKTOP_MIN,
    media: query,
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
    addListener: fn => listeners.add(fn),
    removeListener: fn => listeners.delete(fn)
  }))
  return { resizeTo: wide => listeners.forEach(fn => fn({ matches: wide })) }
}

function Probe() {
  return <span>{useIsDesktop() ? 'desktop' : 'phone'}</span>
}

let original
beforeEach(() => { original = window.matchMedia })
afterEach(() => { window.matchMedia = original; vi.restoreAllMocks() })

describe('what counts as a desktop', () => {
  it('is a width, not a device', () => {
    // A laptop with the window dragged narrow gets the phone layout, and that
    // is right: it is the space available that decides whether a sidebar fits.
    widthIs(800)
    render(<Probe />)
    expect(screen.getByText('phone')).toBeInTheDocument()
  })

  it('answers on the first render, with no flash of the wrong one', () => {
    widthIs(1440)
    render(<Probe />)
    expect(screen.getByText('desktop')).toBeInTheDocument()
  })

  it('notices a window being resized', async () => {
    const screenAt = widthIs(1440)
    render(<Probe />)
    expect(screen.getByText('desktop')).toBeInTheDocument()
    screenAt.resizeTo(false)
    await waitFor(() => expect(screen.getByText('phone')).toBeInTheDocument())
  })

  it('falls back to the phone layout where it cannot ask', () => {
    // A test environment, or a browser old enough to lack matchMedia. Being
    // wrong towards the phone is the safe direction.
    window.matchMedia = undefined
    render(<Probe />)
    expect(screen.getByText('phone')).toBeInTheDocument()
  })
})
