import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import UsageScan from './UsageScan.jsx'

// "The scan page doesn't need to live in the desktop version as no one will
// ever scan from the desktop. But the ability to review the scanned items does
// need to live in the desktop version."
//
// Right: a usage form is scanned on a phone held over the paper on a theatre
// bench. A laptop has no camera pointed at the right thing and no hand free to
// hold it. What somebody at a desk wants is what has already been filed.

const USER = { name: 'Brenton Lovering', email: 'brenton@technomed.com.au', token: 'tok' }

const widthOf = px => {
  window.matchMedia = q => ({
    matches: px >= 1024, media: q, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}
  })
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true })
}

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ records: [] }) }))
})
afterEach(() => vi.restoreAllMocks())

describe('on a desktop', () => {
  beforeEach(() => widthOf(1680))

  it('opens on what has been filed, not the camera', async () => {
    render(<UsageScan user={USER} />)
    await waitFor(() => expect(screen.getByText('Filed usage')).toBeInTheDocument())
    expect(screen.getByText('Recent scans')).toBeInTheDocument()
  })

  it('does not offer a scan that cannot work', async () => {
    render(<UsageScan user={USER} />)
    await waitFor(() => expect(screen.getByText('Filed usage')).toBeInTheDocument())
    expect(screen.queryByText(/New Usage Scan/)).not.toBeInTheDocument()
  })

  it('says where scanning happens, once', async () => {
    // Plainly, rather than as a warning on a button that does nothing.
    render(<UsageScan user={USER} />)
    await waitFor(() =>
      expect(screen.getByText(/Scanning happens on a phone/)).toBeInTheDocument())
  })
})

describe('on a phone', () => {
  beforeEach(() => widthOf(390))

  it('still opens straight on the camera', async () => {
    // Tapping Scan means "scan something now", and making that three taps was
    // the wrong default.
    render(<UsageScan user={USER} />)
    await waitFor(() => expect(screen.queryByText('Filed usage')).not.toBeInTheDocument())
  })
})
