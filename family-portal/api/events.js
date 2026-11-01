import { readSession } from '../lib/auth.js';
import { readConfig, loadFamilyCalendar } from '../lib/feeds.js';

const DAY = 86400000;
const PAST_DAYS = 31;
const FUTURE_DAYS = 365;
const CACHE_MS = 60 * 1000; // feeds are re-read at most once a minute per server instance

let cache = null;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: 'Please sign in.' });

  let config;
  try {
    config = readConfig();
  } catch (err) {
    console.error('calendar config error:', err.message);
    return res.status(500).json({ error: 'No calendars are set up yet — add FAMILY_CALENDARS in Vercel.' });
  }

  const force = req.query && req.query.refresh === '1';
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return res.status(200).json(cache.data);
  }

  const now = Date.now();
  const data = await loadFamilyCalendar({
    config,
    fromMs: now - PAST_DAYS * DAY,
    toMs: now + FUTURE_DAYS * DAY,
  });
  for (const s of data.sources) if (!s.ok) console.error(`feed failed for ${s.person}${s.label ? ` (${s.label})` : ''}: ${s.error}`);

  const payload = { ...data, timezone: process.env.FAMILY_TIMEZONE || 'Australia/Hobart', fetchedAt: new Date(now).toISOString() };
  cache = { at: now, data: payload };
  return res.status(200).json(payload);
}
