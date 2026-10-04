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
  const goAdmin = async () => {
    signedIn()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Me' }))
    fireEvent.click(screen.getByText('Admin portal'))
  }

  it('asks before showing it', async () => {
    authenticate.mockImplementation(() => new Promise(() => {}))
    await goAdmin()
    expect(await screen.findByText(/Welcome back, Brent/)).toBeInTheDocument()
  })

  it('says why it is asking', async () => {
    authenticate.mockRejectedValue(new Error('cancelled'))
    await goAdmin()
    expect(await screen.findByText(/everybody's pay and PINs/)).toBeInTheDocument()
  })

  it('lets you in once it takes', async () => {
    authenticate.mockResolvedValue({ id: 'cred' })
    global.fetch = vi.fn(async (url, opts) => {
      const body = JSON.parse(opts?.body || '{}')
      if (body.action === 'passkey-login-options') return { ok: true, json: async () => ({ options: {} }) }
      if (body.action === 'passkey-login') return { ok: true, json: async () => ({ valid: true }) }
      return { ok: true, json: async () => ({ events: [] }) }
    })
    await goAdmin()
    await waitFor(() => expect(screen.queryByText(/Welcome back, Brent/)).not.toBeInTheDocument())
  })

  it('has a way out that is not signing out', async () => {
    // Somebody who tapped Admin by mistake should not have to
    // re-authenticate to get back to the cases.
    authenticate.mockRejectedValue(new Error('cancelled'))
    await goAdmin()
    const notNow = await screen.findByRole('button', { name: 'Not now' })
    fireEvent.click(notNow)
    await waitFor(() => expect(screen.queryByText(/Welcome back, Brent/)).not.toBeInTheDocument())
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it('always offers the PIN', async () => {
    authenticate.mockRejectedValue(new Error('no'))
    await goAdmin()
    expect(await screen.findByRole('button', { name: 'Use my PIN instead' })).toBeInTheDocument()
  })
})
