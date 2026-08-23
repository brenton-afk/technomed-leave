import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import PinScreen from './PinScreen.jsx'

// jsdom has no authenticator, so without this the screen correctly decides Face
// ID is unavailable and never asks for it.
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => true,
  startAuthentication: async () => ({ id: 'stub' }),
  startRegistration: async () => ({ id: 'stub' }),
  platformAuthenticatorIsAvailable: async () => true
}))
import { rememberedUser, rememberUser, forgetUser } from '../lastUser.js'

// Nine people, and every one of them was picking their own name off a roster on
// their own phone before typing a PIN. The passkey login already existed and
// already fired on its own — the only thing in the way was that the app threw
// away who you were the moment it closed.

const BRENT = 'brenton@technomed.com.au'

/** The two lookups the sign-in screen makes before it can show a keypad. */
function server({ hasPin = true, passkey = false, fail = false } = {}) {
  return vi.fn(async (url, init) => {
    if (fail) throw new Error('offline')
    const { action } = JSON.parse(init.body)
    if (action === 'check') return json({ hasPin, name: 'Brenton Lovering' })
    if (action === 'passkey-available') return json({ available: passkey })
    if (action === 'passkey-login-options') return json({ options: {} })
    if (action === 'passkey-login') return json({ valid: true, name: 'Brenton Lovering', token: 't' })
    return json({})
  })
}
const json = body => ({ ok: true, json: async () => body })

beforeEach(() => {
  localStorage.clear()
  global.fetch = server()
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

const noop = () => {}
const show = (props = {}) => render(<PinScreen onLogin={noop} {...props} />)

describe('remembering the device\'s person', () => {
  it('remembers nobody until someone signs in', () => {
    expect(rememberedUser()).toBeNull()
  })

  it('keeps the person across the app closing', () => {
    rememberUser(BRENT)
    expect(rememberedUser()).toBe(BRENT)
  })

  it('ignores an email that is not on the roster', () => {
    // Someone who has left, or an address that changed. Resuming a sign-in that
    // can no longer succeed would strand them on a screen with no way forward.
    localStorage.setItem('tm_last_user', 'someone@elsewhere.com')
    expect(rememberedUser()).toBeNull()
  })

  it('forgets on request', () => {
    rememberUser(BRENT)
    forgetUser()
    expect(rememberedUser()).toBeNull()
  })

  it('is recorded by the one place every sign-in arrives', () => {
    // PIN, first-time setup and passkey all end at App's handleLogin, so that is
    // where this belongs — a per-route call would miss one.
    const app = readFileSync(join(process.cwd(), 'src/App.jsx'), 'utf8')
    const handler = app.slice(app.indexOf('function handleLogin'), app.indexOf('function handleLogout'))
    expect(handler).toMatch(/rememberUser\(userData\.email\)/)
  })

  it('is identity and not authorisation', () => {
    // The session stays in sessionStorage with its one-hour life. If this ever
    // held a token, closing the app would stop expiring the session.
    const stored = Object.keys(localStorage).map(k => localStorage.getItem(k))
    rememberUser(BRENT)
    expect(localStorage.getItem('tm_last_user')).toBe(BRENT)
    expect(stored.join()).not.toMatch(/token/)
  })
})

describe('signing in on a phone the app has seen before', () => {
  it('asks the roster when it has never seen this device', async () => {
    show()
    expect(await screen.findByText(/Select your name to sign in/)).toBeInTheDocument()
  })

  it('skips the roster and goes to the keypad', async () => {
    rememberUser(BRENT)
    show()
    // Not "select your name" — straight to their own keypad, which is where the
    // Face ID prompt fires from.
    await waitFor(() => expect(screen.getByText(/Enter your 4-digit PIN|Type your 4-digit PIN/)).toBeInTheDocument())
    expect(screen.queryByText(/Select your name to sign in/)).not.toBeInTheDocument()
  })

  it('greets them by the name the team actually uses', async () => {
    rememberUser(BRENT)
    show()
    // Brenton is Brent and Matthew is Mat — no rule gets from one to the other,
    // which is why the roster writes firstName down. Splitting the full name
    // said "Hi, Brenton" to someone nobody calls Brenton.
    await waitFor(() => expect(screen.getByText('Hi, Brent')).toBeInTheDocument())
    expect(screen.queryByText('Hi, Brenton')).not.toBeInTheDocument()
  })

  it('offers Face ID without a tap where it is enrolled', async () => {
    global.fetch = server({ passkey: true })
    rememberUser(BRENT)
    show()
    // The whole point of remembering: open the app, glance at it, in. The
    // passkey call is attempted on its own once the keypad step is reached.
    await waitFor(() => {
      const actions = global.fetch.mock.calls.map(c => JSON.parse(c[1].body).action)
      expect(actions).toContain('passkey-login-options')
    })
  })

  it('falls back to the roster when the check cannot be made', async () => {
    global.fetch = server({ fail: true })
    rememberUser(BRENT)
    show()
    // A resume that cannot reach the server must not leave "Signing you in…" on
    // screen for ever — the roster is the only screen with a way forward.
    expect(await screen.findByText(/Select your name to sign in/)).toBeInTheDocument()
    expect(screen.queryByText(/Signing you in/)).not.toBeInTheDocument()
  })

  it('sends a first-time person to the welcome screen, not a keypad', async () => {
    // Remembered, but their PIN has since been reset. Asking for a PIN they do
    // not have would just tell them it was wrong.
    global.fetch = server({ hasPin: false })
    rememberUser(BRENT)
    show()
    await waitFor(() => expect(screen.queryByText(/Signing you in/)).not.toBeInTheDocument())
    expect(screen.queryByText(/Enter your 4-digit PIN/)).not.toBeInTheDocument()
  })

  it('lets someone say it is not them, and means it', async () => {
    rememberUser(BRENT)
    show()
    // Waiting for the keypad first, because "Not Brent?" is on the resuming
    // screen too and that button is detached the moment the lookup lands.
    await waitFor(() => expect(screen.getByText(/4-digit PIN/)).toBeInTheDocument())
    screen.getByText(/^Not Brent\?$/).click()

    expect(await screen.findByText(/Select your name to sign in/)).toBeInTheDocument()
    // Has to stick, or the next launch resumes the same person again.
    expect(rememberedUser()).toBeNull()
  })

  it('does not reinstate a name that has just been rejected', async () => {
    // Tapping "Not Brent?" while the resume's lookup was still in flight looked
    // like it had done nothing: the reply landed afterwards and set the step
    // straight back to Brent's keypad.
    let land
    global.fetch = vi.fn(() => new Promise(resolve => { land = resolve }))
    rememberUser(BRENT)
    show()

    const not = await screen.findByText(/^Not Brent\?$/)   // the resuming screen's
    not.click()
    expect(await screen.findByText(/Select your name to sign in/)).toBeInTheDocument()

    // The lookup they abandoned now answers.
    land(json({ hasPin: true, name: 'Brenton Lovering' }))
    await new Promise(r => setTimeout(r, 20))
    expect(screen.getByText(/Select your name to sign in/)).toBeInTheDocument()
    expect(screen.queryByText('Hi, Brent')).not.toBeInTheDocument()
  })
})
