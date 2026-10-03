import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
import LockScreen from './LockScreen.jsx'

// The session lasts a month and lives on the device now, so the thing between
// a picked-up phone and a list of patients is the phone's own biometric. That
// trade is what makes a month-long session reasonable at all, and it is the
// arrangement every banking app on the same phone already uses.

const BEN = {
  name: 'Ben Cassidy', email: 'ben@technomed.com.au',
  isAdmin: false, token: 'tok-ben',
  staff: { hasTimesheets: true, role: 'Clinical Support Specialist' }
}

const storedSession = (ageMs = 0) => {
  localStorage.setItem('tm_user', JSON.stringify(BEN))
  localStorage.setItem('tm_login_time', String(Date.now() - ageMs))
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  supports.mockReturnValue(true)
  authenticate.mockReset()
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ events: [] }) }))
})

afterEach(() => vi.restoreAllMocks())

describe('the session surviving the app being closed', () => {
  it('is kept where closing the app does not wipe it', () => {
    // sessionStorage is emptied when an installed web app is closed, and iOS
    // closes one whenever it wants the memory. That — not the expiry — was
    // why every open asked for a PIN.
    storedSession()
    expect(localStorage.getItem('tm_user')).toBeTruthy()
    render(<App />)
    expect(screen.queryByText(/Enter your PIN|Staff Portal/i)).not.toBeTruthy()
  })

  it('still expires, a month out', () => {
    storedSession(31 * 24 * 60 * 60 * 1000)
    render(<App />)
    // Back to signing in properly.
    expect(screen.queryByText(/Welcome back/)).not.toBeInTheDocument()
  })
})

describe('unlocking on open', () => {
  it('asks for Face ID before showing anything', async () => {
    storedSession()
    authenticate.mockImplementation(() => new Promise(() => {}))  // still prompting
    render(<App />)
    expect(await screen.findByText(/Welcome back, Ben/)).toBeInTheDocument()
    // The app behind it is not on screen yet.
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })

  it('goes straight in once it takes', async () => {
    storedSession()
    authenticate.mockResolvedValue({ id: 'cred' })
    global.fetch = vi.fn(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}')
      if (body.action === 'passkey-login-options') return { ok: true, json: async () => ({ options: {} }) }
      if (body.action === 'passkey-login') return { ok: true, json: async () => ({ valid: true }) }
      return { ok: true, json: async () => ({ events: [] }) }
    })
    render(<App />)
    await waitFor(() =>
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument())
  })

  it('offers another go when it does not', async () => {
    storedSession()
    authenticate.mockRejectedValue(new Error('cancelled'))
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Unlock' })).toBeInTheDocument()
  })

  it('is never a dead end', async () => {
    // A face it will not take, or a device that cannot. The PIN is always
    // there.
    storedSession()
    authenticate.mockRejectedValue(new Error('no'))
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Use my PIN instead' })).toBeInTheDocument()
  })

  it('does not lock a device that has no biometrics at all', () => {
    // There would be nothing to unlock it with but the PIN, and demanding the
    // PIN on every open is the friction being removed.
    supports.mockReturnValue(false)
    storedSession()
    render(<App />)
    expect(screen.queryByText(/Welcome back/)).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })
})

describe('what the lock screen says', () => {
  it('does not say why the unlock failed', async () => {
    // The difference between "no passkey here" and "that is not your face" is
    // not actionable, and spelling it out is a hint to somebody holding a
    // phone that is not theirs.
    authenticate.mockRejectedValue(new Error('InvalidStateError: no credential'))
    render(<LockScreen user={BEN} onUnlock={() => {}} onUsePin={() => {}} />)
    await screen.findByRole('button', { name: 'Unlock' })
    expect(screen.queryByText(/InvalidStateError|credential/i)).not.toBeInTheDocument()
  })
})
