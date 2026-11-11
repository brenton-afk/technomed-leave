import { describe, it, expect, vi, afterEach } from 'vitest'

// Brent, 11 Nov 2026: speed and the Upstash free-tier limit. A session is
// read from Redis once a minute per instance, not on every request.
const calls = []
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, key) => { calls.push(cmd); return cmd === 'get' ? JSON.stringify({ email: 'mat@technomed.com.au' }) : 1 })
}))
vi.mock('./_pinSecurity.js', () => ({ trackSession: vi.fn() }))

describe('sessions are remembered for a minute', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('asks Redis once, then answers from memory until signed out', async () => {
    vi.stubEnv('SESSION_MEMO', 'on')
    const { getSession, destroySession, forgetSessions } = await import('./_auth.js')
    forgetSessions(); calls.length = 0
    expect((await getSession('tok')).email).toBe('mat@technomed.com.au')
    await getSession('tok'); await getSession('tok')
    expect(calls.filter(c => c === 'get')).toHaveLength(1)
    expect(calls.filter(c => c === 'expire')).toHaveLength(1)
    await destroySession('tok')
    await getSession('tok')
    expect(calls.filter(c => c === 'get')).toHaveLength(2)
  })
})
