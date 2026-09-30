import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { pushPossible, installed, turnOnPush, pushIsOn } from './push.js'

// Notifications are the whole reason the channels are worth having: a message
// that waits in an app until somebody thinks to look is not a message, which is
// why nine people kept using WhatsApp for the running order.
//
// The parts iOS insists on are what these cover — that the app never asks for
// permission on its own, and that a Safari tab is told to install rather than
// told it is unsupported.

const noSupport = () => {
  delete global.Notification
  delete navigator.serviceWorker
  delete window.PushManager
}

beforeEach(() => {
  global.Notification = { permission: 'default', requestPermission: vi.fn(async () => 'granted') }
  window.PushManager = function PushManager() {}
  navigator.serviceWorker = {
    register: vi.fn(async () => ({ pushManager: {} })),
    getRegistration: vi.fn(async () => null),
    ready: Promise.resolve()
  }
})

afterEach(() => { vi.restoreAllMocks(); noSupport() })

describe('whether this device could ever buzz', () => {
  it('says yes when everything is there', () => {
    expect(pushPossible()).toBe(true)
  })

  it('says no when the browser has no push at all', () => {
    noSupport()
    expect(pushPossible()).toBe(false)
  })
})

describe('telling a Safari tab from an installed app', () => {
  it('knows it is installed when the display mode says so', () => {
    window.matchMedia = vi.fn(() => ({ matches: true }))
    expect(installed()).toBe(true)
  })

  it('knows it is a plain tab', () => {
    window.matchMedia = vi.fn(() => ({ matches: false }))
    expect(installed()).toBe(false)
  })
})

describe('turning them on', () => {
  it('says to install first, rather than saying the device cannot do it', async () => {
    // On an iPhone in Safari there is no push. "Not supported" is discouraging
    // and untrue — it is one step away, and that step is the whole message.
    noSupport()
    window.matchMedia = vi.fn(() => ({ matches: false }))
    await expect(turnOnPush('t')).resolves.toBe('not-installed')
  })

  it('reports a refusal as an answer, not an error', async () => {
    // Somebody declining is ordinary. Throwing would put an error banner in
    // front of a decision they just made on purpose.
    global.Notification.requestPermission = vi.fn(async () => 'denied')
    await expect(turnOnPush('t')).resolves.toBe('denied')
  })

  it('never asks for permission without being told to', async () => {
    // iOS silently refuses a prompt that did not come from a tap, and a refusal
    // cannot be asked for again — it has to be undone in Settings. So nothing
    // may ask on load; importing this module must not prompt.
    expect(global.Notification.requestPermission).not.toHaveBeenCalled()
  })

  it('registers the device against the signed-in person', async () => {
    const subscription = {
      endpoint: 'https://push.example/abc',
      toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } })
    }
    navigator.serviceWorker.register = vi.fn(async () => ({
      pushManager: {
        getSubscription: async () => null,
        subscribe: vi.fn(async () => subscription)
      }
    }))
    global.fetch = vi.fn(async url => (
      String(url).includes('action=key')
        ? { ok: true, json: async () => ({ key: 'BLd3_test-key_' }) }
        : { ok: true, json: async () => ({ ok: true }) }
    ))

    await expect(turnOnPush('tok')).resolves.toBe('on')
    const saved = global.fetch.mock.calls.find(([u]) => String(u).includes('action=subscribe'))
    expect(JSON.parse(saved[1].body).subscription.endpoint).toBe('https://push.example/abc')
    expect(saved[1].headers.Authorization).toBe('Bearer tok')
  })

  it('reuses a subscription this device already has', async () => {
    // Subscribing twice with a different key throws, and a phone that has been
    // through this before still has one.
    const existing = {
      endpoint: 'https://push.example/old',
      toJSON: () => ({ endpoint: 'https://push.example/old', keys: { p256dh: 'p', auth: 'a' } })
    }
    const subscribe = vi.fn()
    navigator.serviceWorker.register = vi.fn(async () => ({
      pushManager: { getSubscription: async () => existing, subscribe }
    }))
    global.fetch = vi.fn(async url => (
      String(url).includes('action=key')
        ? { ok: true, json: async () => ({ key: 'BLd3_test-key_' }) }
        : { ok: true, json: async () => ({ ok: true }) }
    ))

    await expect(turnOnPush('tok')).resolves.toBe('on')
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('will not pretend to work when the server has no keys', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ key: null }) }))
    await expect(turnOnPush('tok')).rejects.toThrow(/not configured/i)
  })
})

describe('whether this device is signed up', () => {
  it('is not, when permission was never granted', async () => {
    global.Notification.permission = 'default'
    await expect(pushIsOn()).resolves.toBe(false)
  })

  it('is not, when granted but never subscribed', async () => {
    global.Notification.permission = 'granted'
    navigator.serviceWorker.getRegistration = vi.fn(async () => ({
      pushManager: { getSubscription: async () => null }
    }))
    await expect(pushIsOn()).resolves.toBe(false)
  })

  it('is, when granted and subscribed', async () => {
    global.Notification.permission = 'granted'
    navigator.serviceWorker.getRegistration = vi.fn(async () => ({
      pushManager: { getSubscription: async () => ({ endpoint: 'x' }) }
    }))
    await expect(pushIsOn()).resolves.toBe(true)
  })
})
