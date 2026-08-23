import { STAFF } from './staffConfig.js'

// ─── Who last signed in on this device ───────────────────────────────────────
// So the app opens at the keypad — and therefore at the Face ID prompt, which
// fires on its own — instead of asking a nine-person roster which one you are on
// your own phone.
//
// This is deliberately *not* part of the session. The session is authorisation:
// it lives in sessionStorage, lasts an hour, and is matched by a Redis TTL on the
// server. This is only identity — a work email, which is not a credential and
// proves nothing. Signing in still needs the PIN or the passkey, and the server
// still mints the token. So remembering it cannot weaken the sign-in; the worst a
// stolen value can do is pre-fill a name.
//
// It survives the app closing, which is the entire point and the reason it cannot
// live beside the session.

const KEY = 'tm_last_user'

/**
 * The remembered person, or null.
 *
 * Checked against the roster rather than trusted, so a staff member who has left
 * — or an email that changed — falls back to the picker instead of resuming a
 * sign-in that can no longer succeed.
 */
export function rememberedUser() {
  try {
    const email = localStorage.getItem(KEY)
    if (!email) return null
    return STAFF.some(s => s.email === email) ? email : null
  } catch {
    // Private browsing, or storage disabled. The picker still works.
    return null
  }
}

/** Called on every successful sign-in, whichever way it happened. */
export function rememberUser(email) {
  try {
    if (email) localStorage.setItem(KEY, email)
  } catch { /* nothing to do; the app simply asks again next time */ }
}

/**
 * Forgets the device's person.
 *
 * Reached from the sign-in screen's Back, which on a resumed sign-in means "I am
 * not this person" — so it has to stick, or the next launch resumes the same
 * name again. Not called on sign-out: the phone is still yours, and the PIN or
 * Face ID is required either way.
 */
export function forgetUser() {
  try { localStorage.removeItem(KEY) } catch { /* already gone */ }
}
