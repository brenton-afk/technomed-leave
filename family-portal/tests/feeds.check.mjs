import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs, readConfig, loadFamilyCalendar } from '../lib/feeds.js';

const crlf = (s) => s.trim().split('\n').map((l) => l.trimStart()).join('\r\n');

// Shaped like an iCloud public calendar: Hobart zone defined, weekly netball
// with one week skipped (EXDATE) and one week moved (RECURRENCE-ID).
const ICLOUD = crlf(`
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Apple Inc.//macOS 15//EN
BEGIN:VTIMEZONE
TZID:Australia/Hobart
BEGIN:DAYLIGHT
TZOFFSETFROM:+1000
TZOFFSETTO:+1100
DTSTART:20071007T020000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU
TZNAME:AEDT
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+1100
TZOFFSETTO:+1000
DTSTART:20080406T030000
RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU
TZNAME:AEST
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:netball-1
DTSTART;TZID=Australia/Hobart:20261103T160000
DTEND;TZID=Australia/Hobart:20261103T170000
RRULE:FREQ=WEEKLY;COUNT=5
EXDATE;TZID=Australia/Hobart:20261110T160000
SUMMARY:Netball
LOCATION:Kingborough Sports Centre
END:VEVENT
BEGIN:VEVENT
UID:netball-1
RECURRENCE-ID;TZID=Australia/Hobart:20261117T160000
DTSTART;TZID=Australia/Hobart:20261118T170000
DTEND;TZID=Australia/Hobart:20261118T180000
SUMMARY:Netball (moved)
END:VEVENT
BEGIN:VEVENT
UID:dinner-1
DTSTART;TZID=Australia/Hobart:20261107T183000
DTEND;TZID=Australia/Hobart:20261107T210000
SUMMARY:Family dinner
END:VEVENT
END:VCALENDAR`);

// Shaped like a Google secret iCal address: UTC times, all-day event, cancelled event.
const GOOGLE = crlf(`
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
BEGIN:VEVENT
UID:abc@google.com
DTSTART:20261107T073000Z
DTEND:20261107T100000Z
SUMMARY:Family Dinner
END:VEVENT
BEGIN:VEVENT
UID:trip@google.com
DTSTART;VALUE=DATE:20261120
DTEND;VALUE=DATE:20261123
SUMMARY:Melbourne trip
END:VEVENT
BEGIN:VEVENT
UID:gone@google.com
DTSTART:20261108T000000Z
DTEND:20261108T010000Z
STATUS:CANCELLED
SUMMARY:Cancelled thing
END:VEVENT
BEGIN:VEVENT
UID:floating@x
DTSTART;TZID=Tasmania Standard Time:20261109T090000
DTEND;TZID=Tasmania Standard Time:20261109T093000
SUMMARY:Dentist
END:VEVENT
END:VCALENDAR`);

const FROM = Date.UTC(2026, 9, 25);
const TO = Date.UTC(2027, 0, 1);

test('recurring series honours skipped and moved weeks, in Hobart summer time', () => {
  const evs = parseIcs(ICLOUD, FROM, TO).filter((e) => e.title.startsWith('Netball'));
  assert.deepEqual(evs.map((e) => [e.title, e.start]), [
    ['Netball', '2026-11-03T05:00:00.000Z'], // 4pm AEDT = 05:00 UTC
    ['Netball (moved)', '2026-11-18T06:00:00.000Z'],
    ['Netball', '2026-11-24T05:00:00.000Z'],
    ['Netball', '2026-12-01T05:00:00.000Z'],
  ]);
  assert.equal(evs[0].location, 'Kingborough Sports Centre');
});

test('all-day events keep their dates; cancelled events are dropped', () => {
  const evs = parseIcs(GOOGLE, FROM, TO);
  const trip = evs.find((e) => e.title === 'Melbourne trip');
  assert.deepEqual([trip.allDay, trip.start, trip.end], [true, '2026-11-20', '2026-11-23']);
  assert.ok(!evs.some((e) => e.title === 'Cancelled thing'));
});

test('a Windows zone name with no definition is still read as Hobart time', () => {
  const d = parseIcs(GOOGLE, FROM, TO).find((e) => e.title === 'Dentist');
  assert.equal(d.start, '2026-11-08T22:00:00.000Z'); // 9am AEDT on the 9th
});

test('events outside the window are left out', () => {
  assert.equal(parseIcs(GOOGLE, Date.UTC(2027, 0, 1), Date.UTC(2027, 1, 1)).length, 0);
});

test('webcal links are converted and people share a colour', () => {
  const cfg = readConfig(JSON.stringify([
    { person: 'Kate', url: 'webcal://p1-caldav.icloud.com/published/2/x' },
    { person: 'Brent', url: 'https://g/x.ics' },
    { person: 'Kate', label: 'Work', url: 'https://k/y.ics' },
  ]));
  assert.equal(cfg[0].url, 'https://p1-caldav.icloud.com/published/2/x');
  assert.equal(cfg[0].color, cfg[2].color);
  assert.notEqual(cfg[0].color, cfg[1].color);
});

test('the simple "Name: link" form works, curly-quoted JSON too', () => {
  const cfg = readConfig(`
Brent: https://calendar.google.com/calendar/ical/abc/private-1/basic.ics
Kate:webcal://p52-caldav.icloud.com/published/2/XYZ

Brent (Work): https://outlook.office365.com/owa/calendar/x/calendar.ics
`);
  assert.deepEqual(cfg.map((c) => [c.person, c.label, c.url]), [
    ['Brent', '', 'https://calendar.google.com/calendar/ical/abc/private-1/basic.ics'],
    ['Kate', '', 'https://p52-caldav.icloud.com/published/2/XYZ'],
    ['Brent', 'Work', 'https://outlook.office365.com/owa/calendar/x/calendar.ics'],
  ]);
  assert.equal(cfg[0].color, cfg[2].color);
  const curly = readConfig('[ { \u201Cperson\u201D: \u201CKate\u201D, \u201Curl\u201D: \u201Cwebcal://a/b\u201D }, ]');
  assert.equal(curly[0].url, 'https://a/b');
  assert.throws(() => readConfig('Brent https://x'), /line 1/);
});

test('the same event in two calendars shows once with both people; a broken feed is reported', async () => {
  const config = readConfig(JSON.stringify([
    { person: 'Kate', url: 'https://icloud/a' },
    { person: 'Brent', url: 'https://google/b' },
    { person: 'Olivia', url: 'https://bad/c?token=secret' },
  ]));
  const fetcher = async (url) => {
    if (url.includes('icloud')) return ICLOUD;
    if (url.includes('google')) return GOOGLE;
    throw new Error(`could not reach ${url}`);
  };
  const { events, sources } = await loadFamilyCalendar({ config, fromMs: FROM, toMs: TO, fetcher });
  const dinners = events.filter((e) => e.title.toLowerCase() === 'family dinner');
  assert.equal(dinners.length, 1);
  assert.deepEqual(dinners[0].people.map((p) => p.name), ['Kate', 'Brent']);
  const bad = sources.find((s) => s.person === 'Olivia');
  assert.equal(bad.ok, false);
  assert.ok(!bad.error.includes('secret'), 'the private address must not leak');
  // sorted by start
  const starts = events.filter((e) => !e.allDay).map((e) => e.start);
  assert.deepEqual(starts, [...starts].sort());
});
