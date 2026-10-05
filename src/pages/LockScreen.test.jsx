import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const supports = vi.fn(() => true)
const authenticate = vi.fn()
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: (...a) => supports(...a),
  startAuthentication: (...a) => authenticate(...a),
  platformAuthenticatorIsAvailable: async () => true,
  startRegistration: vi.fn()
}))

import App from '../App.jsx'

// The app used to ask for Face ID on every cold open, which Brent kept
// reporting as "it makes me log in every time". He was right that it bought
// nothing: the phone or laptop is already locked by its operating system, so
// a second check to look at a case list taxed every open to catch nothing.
//
// Opening the app is now free. The admin portal is not — it holds everybody's
// pay, everybody's PINs and the system settings.

const ADMIN = {
  name: 'Brenton Lovering', email: 'brenton@technomed.com.au',
  isAdmin: true, token: 'tok-admin',
  staff: { hasTimesheets: false, role: 'Managing Director', isAdmin: true }
}

const signedIn = (who = ADMIN) => {
  localStorage.setItem('tm_user', JSON.stringify(who))
  localStorage.setItem('tm_login_time', String(Date.now()))
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  supports.mockReturnValue(true)
  authenticate.mockReset()
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ events: [] }) }))
})

afterEach(() => vi.restoreAllMocks())

describe('opening the app', () => {
  it('goes straight in, with no prompt', () => {
    // The whole complaint.
    signedIn()
    render(<App />)
    expect(screen.queryByText(/Welcome back/)).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it('still expires the session a month out', () => {
    localStorage.setItem('tm_user', JSON.stringify(ADMIN))
    localStorage.setItem('tm_login_time', String(Date.now() - 31 * 24 * 60 * 60 * 1000))
    render(<App />)
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })
})

describe('opening the admin portal', () => {
  // "Get rid of the log in for the admin portal for now, it's really
  // annoying." — 5 October 2026.
  //
  // What that removed is the second prompt for the two people who are already
  // admins. It did not open the portal to anybody else: requireAdmin() in
  // api/_auth.js re-reads isAdmin from the roster on every request and does
  // not care what the browser believes. The tests that used to live here
  // described the prompt; these describe what is true without it.
  const goAdmin = async () => {
    signedIn()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Me' }))
    fireEvent.click(screen.getByText('Admin portal'))
  }

  it('goes straight in', async () => {
    authenticate.mockImplementation(() => new Promise(() => {}))
    await goAdmin()
    await waitFor(() =>
      expect(screen.queryByText(/Welcome back, Brent/)).not.toBeInTheDocument())
  })

  it('does not ask for Face ID on the way', async () => {
    // The prompt was a WebAuthn call. Not reaching for it at all is the
    // difference between "turned off" and "turned off but still asking".
    await goAdmin()
    await waitFor(() => expect(screen.queryByText('Admin portal')).not.toBeInTheDocument())
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('keeps the whole step-up behind one switch', async () => {
    // Everything it needs — the LockScreen, the 15-minute window, the unlock
    // state — is left in place deliberately, so turning it back on is one
    // line rather than a rebuild of a security control.
    const app = readFileSync(join(__dirname, '..', 'App.jsx'), 'utf8')
    expect(app).toMatch(/const ADMIN_STEP_UP = (true|false)/)
    expect(app).toMatch(/if \(!ADMIN_STEP_UP\) return true/)
    expect(app).toMatch(/ADMIN_UNLOCK_MS/)
    expect(app).toMatch(/LockScreen/)
  })
})

describe('what actually guards the admin portal', () => {
  // With the prompt gone this is the only control left, so it is worth a test
  // that fails loudly rather than an assumption. Every admin route has to go
  // through requireAdmin, which checks the roster server-side — the browser
  // deciding it is allowed in counts for nothing.
  const admin = ['action.js', 'applications.js']

  it.each(admin)('api/admin/%s requires an admin session', file => {
    const source = readFileSync(join(__dirname, '..', '..', 'api', 'admin', file), 'utf8')
    expect(source).toMatch(/requireAdmin\(req, res\)/)
    // Not requireSession: that is "signed in", which everybody is.
    expect(source).not.toMatch(/await requireSession\(/)
  })
})

describe('the admin prompt never costs a sign-in', () => {
  // "It's still asking for passcode." It was, and this is why.
  //
  // The lock screen's "Use my PIN instead" called handleLogout(), so reaching
  // for the gentler option destroyed the thirty-day session. The app then
  // dropped to the PIN screen, which auto-fires the passkey — the iOS
  // passcode sheet. Turning the prompt off stopped new instances; it could
  // not give back a session already thrown away.
  //
  // Guarded at the source: the step-up is off, so there is no way to drive
  // this through the UI, and a behavioural test would pass against the bug.
  it('offers the PIN without signing anybody out', () => {
    const app = readFileSync(join(__dirname, '..', 'App.jsx'), 'utf8')
    const onUsePin = /onUsePin=\{([^}]*(?:\{[^}]*\})?[^}]*)\}/.exec(app)
    expect(onUsePin, 'the lock screen still takes an onUsePin').toBeTruthy()
    expect(onUsePin[1]).not.toMatch(/handleLogout/)
  })

  it('only clears the session where somebody asked to sign out', () => {
    const app = readFileSync(join(__dirname, '..', 'App.jsx'), 'utf8')
    // The Me hub's sign-out button, the expiry check, and nothing else.
    const calls = [...app.matchAll(/handleLogout\b/g)]
    expect(calls.length).toBeLessThanOrEqual(4)
    expect(app).toMatch(/onLogout=\{handleLogout\}/)
  })
})
