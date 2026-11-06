import { describe, it, expect, vi, beforeEach } from 'vitest'

// Signing in (review, 6 Nov 2026): PINs hashed, five wrong tries lock it, a
// first PIN needs the code emailed to that person, and a reset ends every
// session and passkey. Invented staff only — the roster is mocked.

const store = new Map()
const sets = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, key, ...rest) => {
    if (cmd === 'get') return store.get(key) ?? null
    if (cmd === 'set') {
      if (rest.includes('NX') && store.has(key)) return null
      store.set(key, rest[0]); return 'OK'
    }
    if (cmd === 'del') { store.delete(key); sets.delete(key); return 1 }
    if (cmd === 'incr') { const n = (Number(store.get(key)) || 0) + 1; store.set(key, String(n)); return n }
    if (cmd === 'expire') return 1
    if (cmd === 'ttl') return 600
    if (cmd === 'sadd') { if (!sets.has(key)) sets.set(key, new Set()); sets.get(key).add(rest[0]); return 1 }
    if (cmd === 'smembers') return [...(sets.get(key) || [])]
    return null
  })
}))
vi.mock('../src/staffConfig.js', () => ({
  STAFF: [
    { name: 'Pat Example', firstName: 'Pat', email: 'pat@example.test' },
    { name: 'Alex Admin', firstName: 'Alex', email: 'alex@example.test', isAdmin: true }
  ]
}))
const sentCodes = []
vi.mock('./_email.js', () => ({
  sendPinResetRequestEmail: vi.fn(),
  sendSignInCodeEmail: vi.fn(async (staff, code) => { sentCodes.push({ to: staff.email, code }) })
}))
const removed = []
vi.mock('./_passkeys.js', () => ({
  beginRegistration: vi.fn(), finishRegistration: vi.fn(), beginAuthentication: vi.fn(),
  finishAuthentication: vi.fn(), listPasskeys: vi.fn(), hasPasskeys: vi.fn(), removePasskey: vi.fn(),
  removeAllPasskeys: vi.fn(async email => { removed.push(email) })
}))

const { hashPin, pinMatches, isHashed, maskEmail } = await import('./_pinSecurity.js')
const { default: handler } = await import('./auth/pin.js')
const { createSession } = await import('./_auth.js')

function call(body, headers = {}) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this },
      json(data) { resolve({ status: this.statusCode, data }) }
    }
    handler({ method: 'POST', body, headers, query: {} }, res)
  })
}

beforeEach(() => { store.clear(); sets.clear(); sentCodes.length = 0; removed.length = 0 })

describe('PIN hashing', () => {
  it('stores no PIN in the clear and still recognises it', () => {
    const h = hashPin('4821')
    expect(isHashed(h)).toBe(true)
    expect(h).not.toContain('4821')
    expect(pinMatches(h, '4821')).toBe(true)
    expect(pinMatches(h, '4822')).toBe(false)
  })

  it('signs in with an old plain PIN once and re-stores it hashed', async () => {
    store.set('pin:pat@example.test', '1234')
    const r = await call({ action: 'verify', email: 'pat@example.test', pin: '1234' })
    expect(r.data.valid).toBe(true)
    expect(isHashed(store.get('pin:pat@example.test'))).toBe(true)
  })
})

describe('wrong PINs', () => {
  it('lock the PIN after five, even for the right one', async () => {
    store.set('pin:pat@example.test', hashPin('1234'))
    for (let i = 0; i < 5; i++) {
      const r = await call({ action: 'verify', email: 'pat@example.test', pin: '0000' })
      expect(r.data.valid).toBe(false)
    }
    const locked = await call({ action: 'verify', email: 'pat@example.test', pin: '1234' })
    expect(locked.status).toBe(429)
    expect(locked.data.locked).toBe(true)
    expect(locked.data.token).toBeUndefined()
  })

  it('say how many tries are left', async () => {
    store.set('pin:pat@example.test', hashPin('1234'))
    const r = await call({ action: 'verify', email: 'pat@example.test', pin: '0000' })
    expect(r.data.triesLeft).toBe(4)
  })

  it('are forgotten after a right one', async () => {
    store.set('pin:pat@example.test', hashPin('1234'))
    await call({ action: 'verify', email: 'pat@example.test', pin: '0000' })
    await call({ action: 'verify', email: 'pat@example.test', pin: '1234' })
    expect(store.has('pinfail:pat@example.test')).toBe(false)
  })
})

describe('a first PIN', () => {
  it('cannot be set without the code emailed to that person', async () => {
    const first = await call({ action: 'set', email: 'pat@example.test', newPin: '2468' })
    expect(first.data.needsCode).toBe(true)
    expect(first.data.token).toBeUndefined()
    expect(store.has('pin:pat@example.test')).toBe(false)
    expect(sentCodes).toEqual([{ to: 'pat@example.test', code: expect.stringMatching(/^\d{6}$/) }])
    expect(first.data.sentTo).toBe(maskEmail('pat@example.test'))
    expect(first.data.sentTo).not.toBe('pat@example.test')
  })

  it('is set, hashed, with the right code', async () => {
    await call({ action: 'set', email: 'pat@example.test', newPin: '2468' })
    const { code } = sentCodes[0]
    const wrong = await call({ action: 'set', email: 'pat@example.test', newPin: '2468', code: code === '000000' ? '111111' : '000000' })
    expect(wrong.data.wrongCode).toBe(true)
    const ok = await call({ action: 'set', email: 'pat@example.test', newPin: '2468', code })
    expect(ok.data.success).toBe(true)
    expect(ok.data.token).toBeTruthy()
    expect(pinMatches(store.get('pin:pat@example.test'), '2468')).toBe(true)
  })

  it('does not email a new code more than once a minute', async () => {
    await call({ action: 'set', email: 'pat@example.test', newPin: '2468' })
    await call({ action: 'set', email: 'pat@example.test', newPin: '2468' })
    expect(sentCodes).toHaveLength(1)
  })

  it('throws the code away after five wrong guesses', async () => {
    await call({ action: 'set', email: 'pat@example.test', newPin: '2468' })
    const { code } = sentCodes[0]
    const bad = code === '999999' ? '888888' : '999999'
    for (let i = 0; i < 5; i++) await call({ action: 'set', email: 'pat@example.test', newPin: '2468', code: bad })
    const late = await call({ action: 'set', email: 'pat@example.test', newPin: '2468', code })
    expect(late.data.codeExpired).toBe(true)
    expect(store.has('pin:pat@example.test')).toBe(false)
  })
})

describe('an admin reset', () => {
  it('signs that person out everywhere and removes their passkeys', async () => {
    store.set('pin:pat@example.test', hashPin('1234'))
    const a = await createSession('pat@example.test')
    const b = await createSession('pat@example.test')
    const admin = await createSession('alex@example.test')
    const r = await call({ action: 'reset', targetEmail: 'pat@example.test' }, { authorization: `Bearer ${admin.token}` })
    expect(r.data.success).toBe(true)
    expect(r.data.signedOut).toBe(2)
    expect(store.has(`session:${a.token}`)).toBe(false)
    expect(store.has(`session:${b.token}`)).toBe(false)
    expect(store.has(`session:${admin.token}`)).toBe(true)
    expect(removed).toEqual(['pat@example.test'])
  })
})

describe('the session token', () => {
  it('is never read from a web address', async () => {
    const admin = await createSession('alex@example.test')
    const r = await new Promise(resolve => {
      const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json(d) { resolve({ status: this.statusCode, data: d }) } }
      handler({ method: 'GET', query: { action: 'roster', token: admin.token }, headers: {} }, res)
    })
    expect(r.status).toBe(401)
  })
})
