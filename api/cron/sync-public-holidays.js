import {
  listCalendarEvents, createCalendarEventWithId, updateCalendarEvent
} from '../_googleCalendar.js'
import { mayWriteToSharedCalendar, whyNoCalendarWrites } from '../_environment.js'
import { requireSession } from '../_auth.js'
import { STAFF } from '../../src/staffConfig.js'
import {
  hobartHolidays, holidayEventId, holidayTitle, dayAfter
} from '../../lib/publicHolidays.js'

// Vercel cron, 15:00 UTC daily = 02:00 next day in Hobart during daylight
// saving (AEDT, UTC+11), which Tasmania keeps from October to April. For the
// rest of the year (AEST, UTC+10) the same line lands at 01:00 local instead.
//
// The schedule is held in UTC because that is what Vercel accepts, and the
// caveat is written here rather than in vercel.json because that file is
// strict JSON and will not take a comment — the timesheet reminder does the
// same thing for the same reason. An hour either way does not matter for a
// nightly sync of dates that change a few times a year; it is recorded so the
// next person does not read "0 15" and think somebody meant three in the
// afternoon.

// ─── Putting the public holidays on the calendar ─────────────────────────────
// "The portal adds Hobart public holidays to the bookings calendar
// automatically, so nobody has to ask for them."
//
// This year and next, every night. Next year as well as this one because the
// useful question about a public holiday is asked months ahead — a January
// booking is taken in November — and a sync that only kept the current year
// would leave the calendar blank for exactly the stretch somebody is planning.
//
// ── Why it is safe to run again ──
//
// Each holiday gets an id made from its date, so creating the same day twice
// is a 409 from Google rather than a second entry. A 409 means it is already
// there, which is the ordinary case on every night after the first, and the
// entry is patched instead so a renamed or re-dated holiday corrects itself.
//
// Nothing is deleted. A holiday that is withdrawn — it happens; a one-off
// public holiday gets gazetted and moved — would be left behind, and that is
// deliberate: deleting from a shared calendar on a schedule is how somebody's
// hand-made entry disappears at two in the morning with nobody to ask.

/** Tomato. See the note in the PR: no existing holidays were found to match. */
const DEFAULT_COLOUR = '11'

/** Entries this has made before, and the ones made by hand before it existed. */
const LOOKS_LIKE_A_HOLIDAY = /public\s*holiday/i

/** The prefix on every id this sync writes. See holidayEventId. */
const OUR_IDS = 'tmph'

/** How much of one colour makes it the house style rather than a tendency. */
const CLEAR_MAJORITY = 0.7

/**
 * The colour the calendar already uses for public holidays.
 *
 * Asked rather than decided. Somebody has been putting these in by hand for
 * years and will have picked a colour; matching it means the automatic ones do
 * not look like a different kind of thing sitting next to the old ones.
 *
 * Two years back, because a holiday is annual and one year could be a year
 * nobody got round to it.
 */
async function colourAlreadyUsed(today) {
  const year = Number(today.slice(0, 4))
  try {
    const events = await listCalendarEvents({
      from: `${year - 2}-01-01`,
      to: `${today}`,
      query: 'Public Holiday'
    })
    const counts = new Map()
    for (const e of events) {
      if (!LOOKS_LIKE_A_HOLIDAY.test(e.summary || '')) continue
      // Only ones somebody chose. An event with no colorId is inheriting the
      // calendar's default, which says nothing about what a holiday should be.
      if (!e.colorId) continue
      counts.set(e.colorId, (counts.get(e.colorId) || 0) + 1)
    }
    if (!counts.size) return { colorId: DEFAULT_COLOUR, matched: false }

    // A convention, or a coin toss?
    //
    // The calendar's own public holidays are a mix — some Graphite, some
    // Tangerine, several with no colour at all — so "the commonest" would pick
    // between two near-equal piles and call the winner a house style. It is
    // not one. Where there is no clear majority this keeps its own colour and
    // says it did not match, which is the honest answer and is also the one
    // that is easiest to correct once somebody decides.
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
    const coloured = ranked.reduce((n, [, count]) => n + count, 0)
    const [colorId, top] = ranked[0]
    if (top / coloured < CLEAR_MAJORITY) return { colorId: DEFAULT_COLOUR, matched: false }
    return { colorId, matched: true }
  } catch {
    // A calendar that cannot be read is not a reason to skip the sync; it is a
    // reason not to know the colour.
    return { colorId: DEFAULT_COLOUR, matched: false }
  }
}

/**
 * The days somebody has already put a public holiday on by hand.
 *
 * "Skip."
 *
 * The bookings calendar already carries some of these, entered by whoever
 * thought of it first — "PUBLIC HOLIDAY - AUSTRALIA DAY" on 26 January 2026,
 * a plain "PUBLIC HOLIDAY" on the Regatta and on Eight Hours Day. They are not
 * ours and have no id of ours, so nothing about the upsert would recognise
 * them: it would add its own beside each and leave two entries on the day.
 *
 * So the sync fills the gaps and leaves what is already there alone. Theirs
 * wins. Nothing is deleted and nothing is overwritten, which is the only
 * arrangement that is safe to run unattended against a calendar nine people
 * write to.
 *
 * Only entries that are not ours count. A day this sync wrote last night is
 * not somebody's hand-made note, and treating it as one would mean never
 * correcting a holiday after the first time it was written.
 */
async function daysAlreadyWrittenByHand(from, to) {
  const taken = new Map()
  try {
    const events = await listCalendarEvents({ from, to, query: 'Public Holiday', max: 250 })
    for (const event of events) {
      const summary = String(event.summary || '')
      // "Public School Holidays" is not a public holiday, and the calendar has
      // several. The pattern wants the two words together.
      if (!LOOKS_LIKE_A_HOLIDAY.test(summary)) continue
      if (String(event.id || '').startsWith(OUR_IDS)) continue
      const day = (event.start?.date || event.start?.dateTime || '').slice(0, 10)
      if (day) taken.set(day, summary)
    }
  } catch {
    // A calendar that cannot be read is a reason to write nothing rather than
    // to write everything twice: an empty answer here would duplicate every
    // holiday somebody had already put in.
    throw new Error('Could not read the calendar to see what is already on it')
  }
  return taken
}

/** Today in Hobart, whatever zone the server thinks it is in. */
function todayInHobart() {
  return new Date(Date.now() + 10 * 3600 * 1000).toISOString().slice(0, 10)
}

/**
 * Writes one holiday, whether or not it is already there.
 *
 * All-day, and transparent: a public holiday does not make anybody busy, it
 * means the hospitals are not running lists. No description — the title says
 * the whole of it, and a description is a thing somebody then has to maintain.
 */
async function upsert(holiday, colorId) {
  const id = holidayEventId(holiday.date)
  const body = {
    summary: holidayTitle(holiday),
    start: { date: holiday.date },
    end: { date: dayAfter(holiday.date) },
    transparency: 'transparent',
    colorId
  }

  const made = await createCalendarEventWithId(id, body)
  if (!made.existed) return { date: holiday.date, action: 'created' }

  // Already there. Patched rather than left, so a holiday whose name or
  // colour changed is corrected without anybody noticing it was wrong.
  await updateCalendarEvent(id, body)
  return { date: holiday.date, action: 'updated' }
}

/**
 * The sync, as a function, so the cron and the admin button are the same code.
 *
 * Returns what it did rather than logging it and returning nothing: the admin
 * card shows this, and "which source answered" is the thing most worth seeing
 * given the national dataset has stopped at 2025.
 */
export async function syncPublicHolidays({ dryRun = false } = {}) {
  const today = todayInHobart()
  const thisYear = Number(today.slice(0, 4))
  const years = [thisYear, thisYear + 1]

  const found = []
  const sources = []
  for (const year of years) {
    const answer = await hobartHolidays(year)
    sources.push({
      year,
      source: answer.source,
      ...(answer.apiError ? { apiError: answer.apiError } : {})
    })
    found.push(...answer.holidays)
  }

  if (dryRun) {
    return {
      ran: false, dryRun: true, years, sources,
      reason: whyNoCalendarWrites(),
      holidays: found
    }
  }

  const colour = await colourAlreadyUsed(today)
  const byHand = await daysAlreadyWrittenByHand(
    `${years[0]}-01-01`, `${years[years.length - 1]}-12-31`)

  const created = []
  const updated = []
  const skipped = []
  const failed = []

  for (const holiday of found) {
    if (byHand.has(holiday.date)) {
      skipped.push({ date: holiday.date, because: byHand.get(holiday.date) })
      continue
    }
    try {
      const result = await upsert(holiday, colour.colorId)
      ;(result.action === 'created' ? created : updated).push(result.date)
    } catch (err) {
      failed.push({ date: holiday.date, error: err.message })
    }
  }

  return {
    ran: true,
    years,
    sources,
    colour: { colorId: colour.colorId, matchedExisting: colour.matched },
    created,
    updated,
    // Days that already had one somebody put there. Reported rather than
    // silent: "it added nothing" and "there was nothing to add" are different
    // answers, and only one of them means it is working.
    skipped,
    failed,
    holidays: found
  }
}

export default async function handler(req, res) {
  // Two ways in, and they are not the same door.
  //
  // Vercel signs cron invocations with CRON_SECRET. As in the timesheet
  // reminder: an unset secret is a refusal rather than a waiver, because
  // checking a signature only when one happens to be configured means a
  // missing environment variable silently opens the endpoint.
  //
  // The admin portal arrives with a staff session instead, for "Sync now".
  const secret = process.env.CRON_SECRET
  const signed = Boolean(secret)
    && (req.headers?.authorization || '') === `Bearer ${secret}`

  let who = 'cron'
  if (!signed) {
    const session = await requireSession(req, res)
    if (!session) return
    const staff = STAFF.find(s => s.email === session.email)
    if (!staff?.isAdmin) return res.status(403).json({ error: 'Admins only' })
    who = staff.firstName
  }

  // Three ways this gets called, and only one of them should write.
  //
  //   · the cron, signed, by GET — Vercel invokes crons with GET, so method
  //     cannot be the test; the signature is
  //   · the admin card opening, by GET — it wants the list, not the write, so
  //     that looking at the card cannot put entries on a shared calendar as a
  //     side effect
  //   · "Sync now", by POST
  const asked = signed
    || (req.method === 'POST' && req.query?.preview !== '1')

  // And then: writing to the shared calendar is production's job. A preview
  // deployment shares production's environment variables and the admin portal
  // is reachable on one, so a preview would otherwise fill the real bookings
  // calendar with entries somebody has to delete out of Google by hand.
  const dryRun = !asked || !mayWriteToSharedCalendar()

  try {
    const result = await syncPublicHolidays({ dryRun })
    // Which source answered, said out loud. The national dataset is inactive
    // and ends at 2025, so this is expected to read "checked-in file" — and
    // the day it starts reading "data.gov.au" is worth noticing.
    for (const s of result.sources) {
      console.log(`Public holidays ${s.year}: ${s.source}`
        + (s.apiError ? ` (data.gov.au: ${s.apiError})` : ''))
    }
    return res.status(200).json({ ...result, by: who })
  } catch (err) {
    console.error('Public holidays:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
