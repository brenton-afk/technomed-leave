import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── Why a finished feature sat dark for weeks ──────────────────────────────
// Push was built, worked, and silently did nothing, because without both VAPID
// keys every send returns {sent: 0, configured: false} — no error, no log, no
// difference on screen. Three places could have said so and none did: the
// environment example did not mention the variables, the server said nothing
// at startup, and the admin screen that answers "what is this deploy missing"
// did not consider notifications a thing that could be missing.
//
// These are the three.

const KEYS = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']
const kept = {}

beforeEach(() => {
  vi.resetModules()
  for (const k of KEYS) { kept[k] = process.env[k]; delete process.env[k] }
})
afterEach(() => {
  for (const [k, v] of Object.entries(kept)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  vi.restoreAllMocks()
})

const load = async () => import('./_push.js?' + Math.random().toString(36).slice(2))

describe('the environment example', () => {
  it('names all three variables', () => {
    // The first place anybody looks for "what does this app need". Its silence
    // is the root cause, so it is tested like one.
    const example = readFileSync(join(__dirname, '..', '.env.example'), 'utf8')
    for (const key of KEYS) expect(example, key).toContain(key)
  })

  it('says what happens without them', () => {
    const example = readFileSync(join(__dirname, '..', '.env.example'), 'utf8')
    expect(example).toMatch(/push is switched off|silently|no-op/i)
  })

  it('does not invite the private key into the bundle', () => {
    // Anything VITE_ prefixed is compiled into the client and published.
    const example = readFileSync(join(__dirname, '..', '.env.example'), 'utf8')
    expect(example).not.toMatch(/VITE_VAPID_PRIVATE/)
  })
})

describe('saying out loud that push is off', () => {
  it('warns once at startup when there are no keys', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const push = await load()
    expect(push.pushConfigured()).toBe(false)
    expect(warn).toHaveBeenCalled()
    expect(warn.mock.calls[0][0]).toMatch(/\[push\].*OFF/)
  })

  it('names which variable is at fault, and no key material', async () => {
    process.env.VAPID_PUBLIC_KEY = 'public-key-value'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const push = await load()
    expect(push.pushFault()).toMatch(/VAPID_PRIVATE_KEY is missing/)
    // The value of a key that *is* set must not travel in a log line.
    expect(push.pushFault()).not.toContain('public-key-value')
  })

  it('catches a subject that is not a URL, rather than letting it 500', async () => {
    // setVapidDetails throws on a bare email address, and it runs at module
    // load — so this would not have disabled push, it would have taken the
    // whole endpoint down on every request, notifications or not.
    process.env.VAPID_PUBLIC_KEY = 'k'
    process.env.VAPID_PRIVATE_KEY = 'k'
    process.env.VAPID_SUBJECT = 'brenton@technomed.com.au'   // no mailto:
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const push = await load()
    expect(push.pushConfigured()).toBe(false)
    expect(push.pushFault()).toMatch(/mailto:/)
  })

  it('accepts a proper mailto: or https: subject', async () => {
    for (const subject of ['mailto:a@b.com', 'https://technomed.com.au']) {
      vi.resetModules()
      process.env.VAPID_PUBLIC_KEY = 'BKfJUOBrtAsoQBf15'
      process.env.VAPID_PRIVATE_KEY = 'VFemVQzjTYQTG3du'
      process.env.VAPID_SUBJECT = subject
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const push = await load()
      // Either it is on, or web-push rejected the (deliberately short) test
      // keys — but never because of the subject.
      expect(push.pushFault() || '', subject).not.toMatch(/mailto:/)
    }
  })

  it('stays quiet, and on, when everything is set', async () => {
    process.env.VAPID_PUBLIC_KEY = 'BKfJUOBrtAsoQBf15-Ix7NvZHWgkq7QygdS7nE9Z-fK6x6f6Cf2No7zGG6gyIGj7fdF2t_-LFrN7NYizgmwc8dg'
    process.env.VAPID_PRIVATE_KEY = 'VFemVQzjTYQTG3duLndUqr8uBYH5hn0S7BP24sHW4c0'
    process.env.VAPID_SUBJECT = 'mailto:brenton@technomed.com.au'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const push = await load()
    expect(push.pushConfigured()).toBe(true)
    expect(push.pushFault()).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('still sends nothing rather than throwing when off', async () => {
    // An unconfigured deploy has to keep working. Push is a convenience; the
    // case list is not.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const push = await load()
    await expect(push.notify(['a@b.com'], { title: 'x' }))
      .resolves.toEqual({ sent: 0, configured: false })
  })

  it('hands out no public key while push is off', async () => {
    // The browser would subscribe against a key the server cannot sign with.
    process.env.VAPID_PUBLIC_KEY = 'k'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const push = await load()
    expect(push.publicKey()).toBeNull()
  })
})

describe('the admin deployment check', () => {
  it('counts push among the things that can be missing', () => {
    const source = readFileSync(join(__dirname, 'xero', 'info.js'), 'utf8')
    for (const key of KEYS) expect(source, key).toContain(key)
  })

  it('reports whether push is on, why not, and how many devices', () => {
    const source = readFileSync(join(__dirname, 'xero', 'info.js'), 'utf8')
    expect(source).toMatch(/push:\s*\{/)
    expect(source).toMatch(/pushFault\(\)/)
    expect(source).toMatch(/registeredDeviceCount/)
  })
})
