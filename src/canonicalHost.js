// ─── Being on the right copy of the app ──────────────────────────────────────
// Vercel gives every deployment its own hostname as well as the project one:
//
//   technomed-leave.vercel.app                 ← the app, always current
//   technomed-leave-abc123-brenton.vercel.app  ← one build, frozen forever
//
// A deployment URL keeps working, keeps showing bookings, and keeps running
// the build it was born with. Nothing on the screen says so. Somebody who
// bookmarked one in March is still using March's app, and every change since
// is invisible to them — which reads as "the feature you added isn't there"
// rather than as "you are on the wrong address".
//
// This has already cost this team twice. Once when a sign-in appeared to be
// broken, and the real cause was a different origin with its own empty
// storage; and again when a rep's name was added to the week and one person
// could see it and another could not.
//
// The two are indistinguishable from the inside, so the app has to say which
// one it is on.

/** Where the app really lives. Add a custom domain here if one is set up. */
export const CANONICAL_HOSTS = ['technomed-leave.vercel.app']

/** Hosts that are meant to be different, and must never be nagged about. */
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/

/**
 * Whether this page is a frozen copy of the app.
 *
 * Deliberately narrow: it only says yes for a hostname that is recognisably a
 * Vercel deployment URL. A future custom domain, an IP on the office network,
 * a tunnel for testing — none of those should raise a banner telling somebody
 * their perfectly good URL is wrong.
 */
export function isFrozenCopy(host = globalThis.location?.hostname || '') {
  const name = String(host).toLowerCase()
  if (!name || LOCAL.test(name)) return false
  if (CANONICAL_HOSTS.includes(name)) return false
  // Only Vercel's per-deployment hostnames. Everything else is somebody's own
  // domain and none of our business.
  return name.endsWith('.vercel.app')
}

/** The same page, on the address that keeps up. */
export function canonicalUrl(location = globalThis.location) {
  const path = `${location?.pathname || '/'}${location?.search || ''}${location?.hash || ''}`
  return `https://${CANONICAL_HOSTS[0]}${path}`
}
