import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'

// ─── Treasury encryption at rest ─────────────────────────────────────────────
// Everything the Treasury section writes to Redis goes through here, Xero
// tokens included. Upstash is shared with the rest of the portal, and anyone
// with its console — or a future bug in another route that lists keys — would
// otherwise read the company's cash position in plain text.
//
// AES-256-GCM: authenticated, so a value that has been tampered with fails to
// decrypt rather than decrypting to something plausible. A fresh 12-byte IV per
// write. The key is TREASURY_ENC_KEY, 32 random bytes, base64 — generate one
// with `openssl rand -base64 32`. It lives only in Vercel's environment.
//
// Format: "t1.<iv>.<tag>.<ciphertext>", each part base64url. The prefix is a
// version, so a key rotation can be added later without guessing what an old
// value is.

const PREFIX = 't1'

export class TreasuryKeyMissing extends Error {
  constructor() {
    super('TREASURY_ENC_KEY is not set, or is not 32 bytes of base64')
    this.name = 'TreasuryKeyMissing'
  }
}

/** The 32-byte key, or a TreasuryKeyMissing. Never logged, never returned. */
export function treasuryKey(env = process.env) {
  const raw = env.TREASURY_ENC_KEY || ''
  let key
  try { key = Buffer.from(raw.trim(), 'base64') } catch { key = null }
  if (!key || key.length !== 32) throw new TreasuryKeyMissing()
  return key
}

export function encrypt(value, key = treasuryKey()) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plain = Buffer.from(JSON.stringify(value), 'utf8')
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), body.toString('base64url')].join('.')
}

export function decrypt(sealed, key = treasuryKey()) {
  if (sealed == null) return null
  const parts = String(sealed).split('.')
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error('Not a treasury value')
  const [, iv, tag, body] = parts
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  const plain = Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()])
  return JSON.parse(plain.toString('utf8'))
}

/** A one-way name for a session token, so the raw token never becomes a key. */
export function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex').slice(0, 40)
}
