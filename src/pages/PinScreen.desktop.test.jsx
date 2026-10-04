import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import PinScreen from './PinScreen.jsx'

// "Tried to log in on desktop, straight away it looks like a phone log in."
//
// The sign-in screen hardcoded a 460px column centred on the page, and it
// renders outside the app shell so the desktop layout never reached it. On a
// phone that column is the whole screen; on a laptop it is a phone-shaped
// strip with the body colour showing either side.

const widthOf = px => {
  window.matchMedia = q => ({
    matches: px >= 1024, media: q, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}
  })
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true })
}

beforeEach(() => {
  localStorage.clear()
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
})
afterEach(() => vi.restoreAllMocks())

const outer = container => container.firstChild

describe('signing in on a laptop', () => {
  beforeEach(() => widthOf(1680))

  it('fills the window instead of sitting in a phone-width strip', () => {
    const { container } = render(<PinScreen onLogin={() => {}} />)
    // No 460px cap on the page itself — the background is the screen.
    expect(outer(container).style.maxWidth).toBe('')
  })

  it('centres the form rather than letting it stretch', () => {
    const { container } = render(<PinScreen onLogin={() => {}} />)
    expect(outer(container).style.justifyContent).toBe('center')
    expect(outer(container).style.alignItems).toBe('center')
  })

  it('still shows the sign-in itself', () => {
    render(<PinScreen onLogin={() => {}} />)
    expect(screen.getByText('Welcome')).toBeInTheDocument()
  })
})

describe('signing in on a phone', () => {
  beforeEach(() => widthOf(390))

  it('keeps the layout it had', () => {
    // The phone screen was never the problem.
    const { container } = render(<PinScreen onLogin={() => {}} />)
    expect(outer(container).style.justifyContent).toBe('')
    expect(screen.getByText('Welcome')).toBeInTheDocument()
  })
})
