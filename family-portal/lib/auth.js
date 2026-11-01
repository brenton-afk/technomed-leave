// One family passcode, checked on the server. A successful login gets a signed
// cookie that lasts 90 days, so nobody has to type it often on their phone.
// No database: the cookie carries its own expiry and an HMAC signature.

import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'family_session';
const MAX_AGE_S = 90 * 24 * 60 * 60;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET must be set (16+ characters)');
  return s;
}

const sign = (payload) => createHmac('sha256', secret()).update(payload).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function passcodeMatches(attempt) {
  const real = process.env.FAMILY_PASSCODE;
  if (!real) throw new Error('FAMILY_PASSCODE is not set');
  // Compare HMACs so differing lengths do not leak through timing.
  return safeEqual(sign(`pc|${attempt}`), sign(`pc|${real}`));
}

export function makeSessionCookie(name) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  const payload = Buffer.from(JSON.stringify({ name, exp })).toString('base64url');
  const value = `${payload}.${sign(payload)}`;
  return `${COOKIE}=${value}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; Secure; SameSite=Lax`;
}

export const clearSessionCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

export function readSession(req) {
  const header = req.headers.cookie || '';
  const raw = header.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
