import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'

// Brent, 11 Nov 2026: slow loading. The Google sign-in is kept for its hour
// instead of being signed and fetched on every request.
describe('the Google sign-in is reused', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('asks Google once, then reuses the token until near its end', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    vi.stubEnv('GOOGLE_TOKEN_CACHE', 'on')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.test')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'x')
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_JSON', JSON.stringify({
      client_email: 'sa@test.iam', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
    }))
    let googleCalls = 0
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (String(url).includes('oauth2.googleapis.com')) {
        googleCalls += 1
        return { json: async () => ({ access_token: `tok-${googleCalls}`, expires_in: 3599 }) }
      }
      return { json: async () => ({ result: null }) } // Redis: nothing kept yet
    }))
    vi.resetModules()
    const { getGoogleToken, forgetGoogleTokens } = await import('./_googleCalendar.js')
    forgetGoogleTokens()
    expect(await getGoogleToken('scope-a')).toBe('tok-1')
    expect(await getGoogleToken('scope-a')).toBe('tok-1')
    expect(googleCalls).toBe(1)
    // A different permission is a different token.
    expect(await getGoogleToken('scope-b')).toBe('tok-2')
    expect(googleCalls).toBe(2)
  })
})
