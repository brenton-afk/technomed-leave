import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { pushPossible, installed, turnOnPush, pushIsOn, platform, installHint } from './push.js'

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

describe('rotating the VAPID keys', () => {
  // Prompted by `npx web-push generate-vapid-keys` being run against a project
  // that already had keys. Rotating them is a one-line change in Vercel and it
  // used to break notifications permanently and invisibly.
  //
  // Every existing subscription is bound to the key that created it. After a
  // rotation the push service rejects each one with 403; the server kept them,
  // because it only cleaned up 404 and 410; and the client handed back the same
  // stale subscription whenever anybody turned notifications off and on again.
  // There was no way out from inside the app.
  const KEY_A = 'BKfJUOBrtAsoQBf15-Ix7NvZHWgkq7QygdS7nE9Z-fK6x6f6Cf2No7zGG6gyIGj7fdF2t_-LFrN7NYizgmwc8dg'
  const KEY_B = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'

  const bytesOf = k => {
    const padded = (k + '='.repeat((4 - (k.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(padded)
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
  }

  const setUp = ({ subscribedWith }) => {
    const unsubscribe = vi.fn(async () => true)
    const subscribe = vi.fn(async () => ({ toJSON: () => ({ endpoint: 'new' }) }))
    const existing = subscribedWith
      ? { options: { applicationServerKey: bytesOf(subscribedWith).buffer },
        toJSON: () => ({ endpoint: 'old' }), unsubscribe }
      : null

    global.Notification = { requestPermission: async () => 'granted', permission: 'granted' }
    navigator.serviceWorker = {
      register: async () => ({ pushManager: { getSubscription: async () => existing, subscribe } }),
      ready: Promise.resolve(),
      getRegistration: async () => ({ pushManager: { getSubscription: async () => existing, subscribe } })
    }
    global.fetch = vi.fn(async url => String(url).includes('action=key')
      ? { ok: true, json: async () => ({ key: KEY_A }) }
      : { ok: true, json: async () => ({ ok: true }) })
    return { unsubscribe, subscribe }
  }

  it('reuses a subscription made with the key in force', async () => {
    const { unsubscribe, subscribe } = setUp({ subscribedWith: KEY_A })
    expect(await turnOnPush('tok')).toBe('on')
    expect(unsubscribe).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('replaces one made with a key that has been rotated away', async () => {
    // The whole point: without this, turning notifications off and on again
    // hands back the same dead subscription and nothing ever recovers.
    const { unsubscribe, subscribe } = setUp({ subscribedWith: KEY_B })
    expect(await turnOnPush('tok')).toBe('on')
    expect(unsubscribe).toHaveBeenCalled()
    expect(subscribe).toHaveBeenCalled()
  })

  it('subscribes from nothing, as it always did', async () => {
    const { subscribe } = setUp({ subscribedWith: null })
    expect(await turnOnPush('tok')).toBe('on')
    expect(subscribe).toHaveBeenCalled()
  })
})

describe('telling somebody how to install, on the phone they are holding', () => {
  // The guidance said "the share button, then Add to Home Screen". That is
  // right on an iPhone and describes a control Android does not have — so an
  // Android user following it went hunting for something that was not there.
  it('names the iPhone route on an iPhone', () => {
    expect(platform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios')
    expect(installHint('ios')).toMatch(/share button/)
    expect(installHint('ios')).toMatch(/Add to Home Screen/)
  })

  it('names the Android route on Android', () => {
    expect(platform('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android')
    expect(installHint('android')).toMatch(/Install app/)
    expect(installHint('android')).not.toMatch(/share button/)
  })

  it('warns that Add to Home screen is not the same thing on Android', () => {
    // The distinction that matters: it can produce a shortcut that opens in a
    // browser tab rather than the installed app.
    expect(installHint('android')).toMatch(/shortcut/)
  })

  it('recognises an iPad, which reports itself as a Mac', () => {
    const was = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints')
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true })
    expect(platform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('ios')
    if (was) Object.defineProperty(navigator, 'maxTouchPoints', was)
  })

  it('does not mistake a desktop Mac for an iPad', () => {
    const was = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints')
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true })
    expect(platform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('other')
    if (was) Object.defineProperty(navigator, 'maxTouchPoints', was)
  })

  it('names both routes when it cannot tell', () => {
    // A wrong instruction is worse than a general one.
    const hint = installHint('other')
    expect(hint).toMatch(/Install app/)
    expect(hint).toMatch(/Add to Home Screen/)
  })

  it('never leaves somebody without a next step', () => {
    for (const which of ['ios', 'android', 'other', undefined]) {
      expect(installHint(which).length, String(which)).toBeGreaterThan(30)
    }
  })
})
