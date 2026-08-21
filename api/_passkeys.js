// ─── Passkeys (Face ID / Touch ID / device passcode) ──────────────────────────
// A second way in alongside the PIN, not a replacement: the PIN always still
// works, so losing a device never locks anyone out.
//
// WebAuthn binds a credential to an origin, so the relying-party ID is derived
// from the request host rather than hardcoded — that way it keeps working on
// the vercel.app domain and on a custom domain later, without a code change.
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server'
import { redis, redisSetBody } from './_redis.js'

const RP_NAME = 'TechnoMed Staff Portal'
const CHALLENGE_TTL_SECONDS = 300

// Vercel puts the public host in x-forwarded-host; host is the fallback for
// local and direct requests.
export function relyingParty(req) {
  const raw = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '')
  const host = raw.split(',')[0].trim()
  if (!host) throw new Error('Cannot determine the request host for WebAuthn')
  const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https'
  return { rpID: host.split(':')[0], origin: `${proto}://${host}` }
}

// Stored credentials, with the public key kept as base64url because Redis holds
// strings and the library hands us a Uint8Array.
async function loadCredentials(email) {
  const raw = await redis('get', `passkey:${email}`)
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

async function saveCredentials(email, credentials) {
  await redisSetBody(`passkey:${email}`, JSON.stringify(credentials))
}

export async function listPasskeys(email) {
  const creds = await loadCredentials(email)
  return creds.map(c => ({
    id: c.id,
    label: c.label || 'This device',
    createdAt: c.createdAt,
    lastUsedAt: c.lastUsedAt || null
  }))
}

export async function hasPasskeys(email) {
  return (await loadCredentials(email)).length > 0
}

export async function removePasskey(email, credentialId) {
  const creds = await loadCredentials(email)
  const next = creds.filter(c => c.id !== credentialId)
  await saveCredentials(email, next)
  return { removed: creds.length - next.length }
}

export async function removeAllPasskeys(email) {
  await redis('del', `passkey:${email}`)
}

async function putChallenge(email, kind, challenge) {
  await redis('set', `passkeychal:${kind}:${email}`, challenge, 'EX', String(CHALLENGE_TTL_SECONDS))
}

// Single-use: a challenge is deleted the moment it is read, so a captured
// response cannot be replayed.
async function takeChallenge(email, kind) {
  const key = `passkeychal:${kind}:${email}`
  const challenge = await redis('get', key)
  if (challenge) await redis('del', key)
  return challenge
}

// ─── Enrolment (requires an already-authenticated session) ───

export async function beginRegistration(req, staff) {
  const { rpID } = relyingParty(req)
  const existing = await loadCredentials(staff.email)

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: staff.email,
    userDisplayName: staff.name,
    // Buffer is a Uint8Array, which is what the library expects.
    userID: Buffer.from(staff.email, 'utf8'),
    attestationType: 'none',
    // Don't offer to enrol a device that is already enrolled.
    excludeCredentials: existing.map(c => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: {
      // platform => the built-in authenticator, i.e. Face ID / Touch ID rather
      // than a roaming security key.
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      userVerification: 'required'
    }
  })

  await putChallenge(staff.email, 'reg', options.challenge)
  return options
}

export async function finishRegistration(req, staff, response, label) {
  const { rpID, origin } = relyingParty(req)
  const expectedChallenge = await takeChallenge(staff.email, 'reg')
  if (!expectedChallenge) throw new Error('That enrolment attempt expired. Please try again.')

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true
  })

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('That device could not be verified')
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
  const creds = await loadCredentials(staff.email)
  const stored = {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports || [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    label: String(label || '').slice(0, 40) || 'This device',
    createdAt: new Date().toISOString()
  }

  // Re-enrolling the same credential replaces it rather than duplicating.
  await saveCredentials(staff.email, [...creds.filter(c => c.id !== stored.id), stored])
  return { id: stored.id, label: stored.label }
}

// ─── Sign-in ────────────────────────────────────────────────

export async function beginAuthentication(req, email) {
  const { rpID } = relyingParty(req)
  const creds = await loadCredentials(email)
  if (creds.length === 0) throw new Error('No passkey is set up for this account')

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map(c => ({ id: c.id, transports: c.transports })),
    userVerification: 'required'
  })

  await putChallenge(email, 'auth', options.challenge)
  return options
}

// Returns true only if the device proved possession of the private key AND the
// user verified themselves (Face ID / Touch ID / passcode).
export async function finishAuthentication(req, email, response) {
  const { rpID, origin } = relyingParty(req)
  const expectedChallenge = await takeChallenge(email, 'auth')
  if (!expectedChallenge) throw new Error('That sign-in attempt expired. Please try again.')

  const creds = await loadCredentials(email)
  const match = creds.find(c => c.id === response?.id)
  if (!match) throw new Error('That device is not registered for this account')

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: match.id,
      publicKey: Buffer.from(match.publicKey, 'base64url'),
      counter: match.counter,
      transports: match.transports
    }
  })

  if (!verification.verified) throw new Error('That device could not be verified')

  // Persisting the counter is what makes a cloned authenticator detectable.
  match.counter = verification.authenticationInfo.newCounter
  match.lastUsedAt = new Date().toISOString()
  await saveCredentials(email, creds)

  return true
}
