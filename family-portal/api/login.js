import { passcodeMatches, makeSessionCookie, clearSessionCookie, readJsonBody } from '../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.status(200).json({ ok: true });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ error: 'Something went wrong — please try again.' });
  }
  const name = String(body.name || '').trim().slice(0, 40);
  const passcode = String(body.passcode || '');

  try {
    if (!passcodeMatches(passcode)) {
      // A pause on every wrong guess makes guessing slow.
      await new Promise((r) => setTimeout(r, 1200));
      return res.status(401).json({ error: 'That passcode isn’t right.' });
    }
    res.setHeader('Set-Cookie', makeSessionCookie(name));
    return res.status(200).json({ ok: true, name });
  } catch (err) {
    console.error('login setup error:', err.message);
    return res.status(500).json({ error: 'The portal isn’t set up yet — check the settings in Vercel.' });
  }
}
