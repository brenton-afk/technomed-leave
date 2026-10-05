import { describe, it, expect } from 'vitest'
import { isFrozenCopy, canonicalUrl, CANONICAL_HOSTS } from './canonicalHost.js'

// ─── "Toni can't see the names in her portal, but I can on desktop" ─────────
// There is no code path that shows a rep to one person and hides it from
// another: the server sends the same events, the parser reads the same roster,
// and nothing is gated on a role. Two people seeing different apps means they
// are running different builds.
//
// Vercel gives every deployment its own permanent hostname. One of those keeps
// working, keeps showing bookings, and keeps running the build it was born
// with — so it looks exactly like the app, forever. This team has lost time to
// it twice now.

describe('isFrozenCopy', () => {
  it('says no on the real app', () => {
    expect(isFrozenCopy('technomed-leave.vercel.app')).toBe(false)
  })

  it('says yes on a deployment URL', () => {
    // The shape Vercel hands out, and the shape that gets bookmarked.
    expect(isFrozenCopy('technomed-leave-abc123-brenton.vercel.app')).toBe(true)
    expect(isFrozenCopy('technomed-leave-git-main-brenton.vercel.app')).toBe(true)
  })

  it('leaves local development alone', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(isFrozenCopy(host), host).toBe(false)
    }
  })

  it('does not nag about a domain that is not ours to judge', () => {
    // A custom domain, an office IP, a tunnel. Telling somebody their
    // perfectly good URL is wrong is worse than saying nothing.
    for (const host of ['portal.technomed.com.au', '192.168.1.14', 'example.com']) {
      expect(isFrozenCopy(host), host).toBe(false)
    }
  })

  it('says nothing where there is no host at all', () => {
    expect(isFrozenCopy('')).toBe(false)
    expect(isFrozenCopy(undefined)).toBe(false)
  })
})

describe('canonicalUrl', () => {
  it('keeps you where you were on the page that updates', () => {
    expect(canonicalUrl({ pathname: '/', search: '', hash: '' }))
      .toBe(`https://${CANONICAL_HOSTS[0]}/`)
    expect(canonicalUrl({ pathname: '/', search: '?tab=cases', hash: '#x' }))
      .toBe(`https://${CANONICAL_HOSTS[0]}/?tab=cases#x`)
  })

  it('copes with a location that tells it nothing', () => {
    expect(canonicalUrl({})).toBe(`https://${CANONICAL_HOSTS[0]}/`)
  })
})
