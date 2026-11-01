// Reads every family calendar feed and merges them into one list of events.
//
// Every calendar app can publish a read-only "iCal" (.ics) address:
//   - Apple / iCloud: Calendar → (i) next to the calendar → Public Calendar → Share Link
//   - Google: Settings → the calendar → "Secret address in iCal format"
//   - Outlook: Settings → Shared calendars → Publish a calendar → ICS link
// The portal never writes to anyone's calendar. Each person keeps adding events
// in whatever app they already use, and the next refresh picks them up.

import ICAL from 'ical.js';

export const HOME_TZ = process.env.FAMILY_TIMEZONE || 'Australia/Hobart';

// Outlook sometimes names zones the Windows way and leaves out the definition.
const WINDOWS_ZONES = {
  'Tasmania Standard Time': 'Australia/Hobart',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'W. Australia Standard Time': 'Australia/Perth',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'UTC': 'UTC',
};

const PALETTE = ['#2f7de1', '#d6457a', '#2a9d6f', '#e08a1e', '#7b5cd6', '#1f9fb5'];

/**
 * FAMILY_CALENDARS is a JSON list, one entry per calendar:
 *   [{ "person": "Brent", "url": "https://calendar.google.com/...basic.ics" },
 *    { "person": "Kate",  "url": "webcal://p52-caldav.icloud.com/published/2/..." },
 *    { "person": "Brent", "label": "Work", "url": "..." }]
 * A person may have several calendars; they share that person's colour.
 * "color" is optional on any entry.
 */
export function readConfig(raw = process.env.FAMILY_CALENDARS) {
  if (!raw) throw new Error('FAMILY_CALENDARS is not set');
  let list;
  try {
    list = JSON.parse(raw);
  } catch {
    throw new Error('FAMILY_CALENDARS is not valid JSON');
  }
  if (!Array.isArray(list) || list.length === 0) throw new Error('FAMILY_CALENDARS must be a non-empty list');

  const colours = new Map();
  return list.map((c, i) => {
    if (!c || !c.person || !c.url) throw new Error(`Calendar ${i + 1} needs a "person" and a "url"`);
    const person = String(c.person).trim();
    if (c.color) colours.set(person, c.color);
    if (!colours.has(person)) colours.set(person, PALETTE[colours.size % PALETTE.length]);
    return {
      id: `cal${i + 1}`,
      person,
      label: c.label ? String(c.label) : '',
      url: String(c.url).trim().replace(/^webcals?:\/\//i, 'https://'),
      color: c.color || colours.get(person),
    };
  });
}

// ---- time handling ---------------------------------------------------------

function validZone(tz) {
  if (!tz) return null;
  const mapped = WINDOWS_ZONES[tz] || tz;
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: mapped });
    return mapped;
  } catch {
    return null;
  }
}

// Offset (ms) of `tz` from UTC at the given instant.
function zoneOffset(tz, utcMs) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}

// Wall-clock time in `tz` → UTC milliseconds.
function wallToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let utc = guess - zoneOffset(tz, guess);
  utc = guess - zoneOffset(tz, utc); // second pass settles daylight-saving edges
  return utc;
}

function toInstant(t) {
  const zone = t.zone;
  if (zone && zone.tzid !== 'floating') return t.toJSDate().getTime();
  // Floating, or named a zone the feed never defined: read it in that zone
  // if we know it, otherwise as home time.
  const tz = validZone(t.timezone) || HOME_TZ;
  return wallToUtc(t.year, t.month, t.day, t.hour, t.minute, t.second, tz);
}

const pad = (n) => String(n).padStart(2, '0');
const dateStr = (t) => `${t.year}-${pad(t.month)}-${pad(t.day)}`;

// ---- parsing ---------------------------------------------------------------

const MAX_OCCURRENCES = 1000;

/**
 * Parse one .ics text into plain events overlapping [fromMs, toMs).
 * All-day events carry `start`/`end` as YYYY-MM-DD (end exclusive);
 * timed events carry ISO UTC strings.
 */
export function parseIcs(text, fromMs, toMs) {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(tz); } catch { /* a broken zone definition falls back to home time */ }
  }

  const vevents = root.getAllSubcomponents('vevent');
  const masters = new Map();
  const exceptions = [];
  for (const v of vevents) {
    if (v.hasProperty('recurrence-id')) exceptions.push(v);
    else masters.set(v.getFirstPropertyValue('uid') || Symbol('no-uid'), new ICAL.Event(v));
  }
  const orphans = [];
  for (const v of exceptions) {
    const ex = new ICAL.Event(v);
    const master = masters.get(ex.uid);
    if (master) master.relateException(ex);
    else orphans.push(ex); // a moved occurrence of a series we were not sent
  }

  const out = [];
  const push = (ev, start, end) => {
    if (!start) return;
    if (ev.component.getFirstPropertyValue('status') === 'CANCELLED') return;
    const allDay = start.isDate;
    if (!end) {
      end = start.clone();
      if (allDay) end.adjust(1, 0, 0, 0);
      else if (ev.duration) end.addDuration(ev.duration);
    }
    let s, e;
    if (allDay) {
      const sMs = Date.UTC(start.year, start.month - 1, start.day);
      const eMs = Date.UTC(end.year, end.month - 1, end.day);
      // Compare whole days against the window loosely; the client trims by home date.
      if (eMs <= fromMs - 86400000 || sMs >= toMs + 86400000) return;
      s = dateStr(start);
      if (eMs > sMs) e = dateStr(end);
      else { const next = start.clone(); next.adjust(1, 0, 0, 0); e = dateStr(next); }
    } else {
      const sMs = toInstant(start);
      let eMs = toInstant(end);
      if (eMs < sMs) eMs = sMs;
      if (eMs <= fromMs || sMs >= toMs) return;
      s = new Date(sMs).toISOString();
      e = new Date(eMs).toISOString();
    }
    out.push({
      uid: ev.uid || '',
      title: (ev.summary || '').trim() || '(No title)',
      start: s,
      end: e,
      allDay,
      location: (ev.location || '').trim(),
      notes: (ev.description || '').trim().slice(0, 2000),
    });
  };

  for (const ev of masters.values()) {
    if (!ev.startDate) continue;
    if (!ev.isRecurring()) {
      push(ev, ev.startDate, ev.endDate);
      continue;
    }
    const it = ev.iterator();
    let next;
    let n = 0;
    while ((next = it.next()) && n < MAX_OCCURRENCES) {
      n += 1;
      // Occurrences before the window are skipped cheaply; stop once past it.
      if (next.isDate ? Date.UTC(next.year, next.month - 1, next.day) >= toMs + 86400000 : toInstant(next) >= toMs) break;
      const d = ev.getOccurrenceDetails(next);
      push(d.item, d.startDate, d.endDate);
    }
  }
  for (const ex of orphans) push(ex, ex.startDate, ex.endDate);
  return out;
}

// ---- fetching and merging --------------------------------------------------

async function fetchText(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'text/calendar, */*', 'User-Agent': 'FamilyPortal/1.0' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`the calendar address answered ${res.status}`);
    const text = await res.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('the address did not return a calendar');
    return text;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('the calendar took too long to answer');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The same event often sits in two people's calendars (an invite, or a shared
 * family calendar). Show it once, with everyone it belongs to.
 */
export function mergeDuplicates(events) {
  const byKey = new Map();
  const result = [];
  for (const ev of events) {
    const keys = [
      ev.uid && `uid|${ev.uid}|${ev.start}`,
      `t|${ev.title.toLowerCase()}|${ev.start}|${ev.end}`,
    ].filter(Boolean);
    const hit = keys.map((k) => byKey.get(k)).find(Boolean);
    if (hit) {
      for (const p of ev.people) if (!hit.people.some((x) => x.name === p.name)) hit.people.push(p);
      if (!hit.location && ev.location) hit.location = ev.location;
      if (!hit.notes && ev.notes) hit.notes = ev.notes;
      for (const k of keys) byKey.set(k, hit);
      continue;
    }
    for (const k of keys) byKey.set(k, ev);
    result.push(ev);
  }
  return result;
}

const sortKey = (ev) => (ev.allDay ? `${ev.start}T00:00:00.000Z#0` : `${ev.start}#1`);

export async function loadFamilyCalendar({ config, fromMs, toMs, fetcher = fetchText }) {
  const results = await Promise.all(config.map(async (cal) => {
    try {
      const text = await fetcher(cal.url);
      const events = parseIcs(text, fromMs, toMs);
      return { cal, events, error: null };
    } catch (err) {
      // Never pass the address itself back — it is the key to that calendar.
      return { cal, events: [], error: String(err && err.message ? err.message : err).replace(/https?:\/\/\S+/g, '[address]') };
    }
  }));

  const all = [];
  for (const { cal, events } of results) {
    for (const ev of events) {
      all.push({ ...ev, people: [{ name: cal.person, color: cal.color, label: cal.label }] });
    }
  }
  all.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
  const events = mergeDuplicates(all).map(({ uid, ...rest }, i) => ({ id: `e${i}`, ...rest }));

  return {
    events,
    sources: results.map(({ cal, events: evs, error }) => ({
      person: cal.person, label: cal.label, color: cal.color, ok: !error, error, count: evs.length,
    })),
  };
}
