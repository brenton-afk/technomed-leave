import { TZ, zonedCivil, addCivilDays, zonedToInstant, toDateStr } from '../../src/clinicalPlan/week.js'
import { getGoogleToken, getCalendarId, CALENDAR_SCOPE_READONLY } from '../_googleCalendar.js'
import { requireSession } from '../_auth.js'
import {
  updateCalendarEvent, getCalendarEvent, createBookingEvent, deleteCalendarEvent
} from '../_googleCalendar.js'
import {
  setLabelledValue, replaceSurname, labelledFieldSpans,
  parseLabelledDescription, descriptionNotes
} from '../../src/clinicalPlan/labelledFields.js'
import { readBooking, normaliseSurgeon, extractRep } from '../../src/clinicalPlan/parse.js'
import { guideColorIdFor } from '../../src/clinicalPlan/colours.js'
import {
  getRunsheet, tickRunsheetItem, untickRunsheetItem,
  bookingEmailSeen, markBookingEmailSeen, markBookingEmailFailed, saveBookingCandidate,
  getBookingCandidate, getBookingQueue, updateBookingCandidate
} from '../_redis.js'
import { searchMailbox, readMessage, addressOf } from '../_gmail.js'
import { parseTheatreList } from '../../src/clinicalPlan/parseTheatreList.js'
import { readBookingDocument } from '../_readBookingDocument.js'
import { sourceOf, isSameBooking, mergeBookings } from '../../src/clinicalPlan/bookingSources.js'
import { systemsInKit } from '../../src/clinicalPlan/systems.js'
import { firstNameFor } from '../../src/staffConfig.js'

// The Staff Leave sub-calendar. Read alongside bookings for the clinical plan
// so leave shows up in the week without a second round trip.
const LEAVE_CALENDAR_ID = process.env.GOOGLE_LEAVE_CALENDAR_ID
  || 'c_3221a8751df15d78f4d747cffc90ab6b78e3218d70151dfaaf22f639f2c95639@group.calendar.google.com'

// Google's API is queried with this zone; Hobart keeps the same wall clock.
const QUERY_TZ = 'Australia/Melbourne'

export default async function handler(req, res) {
  // The case plan polls this so the app tracks the calendar as it is edited. A
  // cached response would make those edits invisible for as long as the cache
  // lived, which is the one thing the polling exists to prevent.
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  // ?action=week backs the Clinical Plan tab. It lives here rather than in its
  // own file because Vercel's Hobby plan caps a deployment at 12 serverless
  // functions and the app is at that ceiling — same reason the meetings, usage
  // and timesheet features are single functions routed by action.
  if (req.query.action === 'week') return handleWeek(req, res)
  // The team leader's daily run-sheet. Here for the same reason as ?action=week
  // — the deployment is at the 12-function ceiling — and it is a fair fit: the
  // run-sheet is a property of a calendar day.
  if (req.query.action === 'runsheet') return handleRunsheet(req, res)
  // Amending a booking from the portal. Same file for the same reason as the
  // others — the deployment is at the 12-function ceiling.
  if (req.query.action === 'save') return handleSave(req, res)
  // One booking, read fresh when the edit sheet opens.
  if (req.query.action === 'booking') return handleBooking(req, res)
  if (req.query.action === 'create') return handleCreate(req, res)
  if (req.query.action === 'delete') return handleDelete(req, res)
  // The booking review queue. Bookings read out of bookings@ wait here for a
  // person before they reach the calendar — see api/_redis.js for why.
  if (req.query.action === 'queue') return handleQueue(req, res)
  if (req.query.action === 'ingest') return handleIngest(req, res)
  if (req.query.action === 'accept') return handleAccept(req, res)
  if (req.query.action === 'dismiss') return handleDismiss(req, res)

  // Everything below this line is the bookings calendar in full: surgeons,
  // patient surnames, hospitals, procedures, kit. It was served to anyone who
  // knew the URL — every ?action= handler above checks a session and this path,
  // the oldest one, never did. Nothing in the app calls it without an action, so
  // requiring a session here costs nothing and closes it.
  const session = await requireSession(req, res)
  if (!session) return

  try {
    const token = await getGoogleToken(CALENDAR_SCOPE_READONLY)
    const calendarId = getCalendarId()

    // The UI navigates a few weeks either side of today, so fetch a window wide
    // enough to cover it.
    //
    // Anchored to Australia/Hobart through the same helpers the week plan uses,
    // rather than by adding ten hours. Tasmania observes daylight saving, so a
    // fixed +10 is an hour out from October to April; and `setHours` on the
    // shifted date resolved against whatever timezone the server happened to be
    // in, which on Vercel is UTC. Neither could move the window by a whole day
    // given how wide it is, but both were quietly wrong and this is exactly the
    // kind of arithmetic that had the day view showing the wrong date.
    const todayCivil = zonedCivil(new Date(), TZ)

    // The window used to be -7/+28 days, which meant a booking more than four
    // weeks out was invisible in the app while sitting on the calendar — and
    // gave no hint that anything had been cut off. Overridable per request so a
    // caller can ask for exactly what it needs.
    const daysBack = Math.min(Math.max(parseInt(req.query.back || '14', 10) || 14, 0), 90)
    const daysForward = Math.min(Math.max(parseInt(req.query.forward || '120', 10) || 120, 1), 400)

    // Calendar days are stepped as calendar days and only then turned into
    // instants, so a DST change cannot gain or lose an hour at the boundary.
    const from = addCivilDays(todayCivil, -daysBack)
    const to = addCivilDays(todayCivil, daysForward)
    const timeMin = zonedToInstant({ ...from, hour: 0, minute: 0, second: 0, ms: 0 }, TZ).toISOString()
    const timeMax = zonedToInstant({ ...to, hour: 23, minute: 59, second: 59, ms: 999 }, TZ).toISOString()

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
      + `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`
      + '&singleEvents=true&orderBy=startTime&maxResults=2500'

    const eventsRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const data = await eventsRes.json()
    if (data.error) throw new Error(data.error.message)

    const events = (data.items || []).map(e => ({
      id: e.id,
      title: e.summary || 'No title',
      // The day view reads the system and supply out of this. Without it the only
      // thing it could show was the title exactly as typed.
      description: e.description || '',
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      location: e.location || null,
      allDay: !e.start?.dateTime,
      colorId: e.colorId || null
    }))

    res.status(200).json({
      events,
      today: toDateStr(todayCivil),
      window: { from: timeMin, to: timeMax, daysBack, daysForward },
      // If Google paginated, say so rather than quietly returning a partial week.
      truncated: Boolean(data.nextPageToken)
    })
  } catch (err) {
    console.error('Calendar error:', err)
    res.status(500).json({ error: err.message })
  }
}

// ─── Clinical Plan: one week, both calendars ─────────────────
// Read-only. Returns raw events and lets the client derive the plan, so the
// view, the text copy and the .docx all come from one pure function.
async function handleWeek(req, res) {
  const session = await requireSession(req, res)
  if (!session) return

  const { start, end } = req.query
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) {
    return res.status(400).json({ error: 'start and end must be YYYY-MM-DD' })
  }

  try {
    const token = await getGoogleToken(CALENDAR_SCOPE_READONLY)
    // Hobart is +10/+11; the window is widened by a day either side and then
    // filtered client-side, so a DST shift cannot clip an edge event.
    // Hobart is +10 (AEST) or +11 (AEDT). Widening by a day either side and
    // letting the client filter is safe; mixing the two offsets was not — a
    // +11:00 timeMax on an AEST week excluded the last hour of Sunday.
    const timeMin = `${start}T00:00:00+11:00`
    const timeMax = `${end}T23:59:59+10:00`

    const calendars = [
      { id: getCalendarId(), source: 'bookings' },
      { id: LEAVE_CALENDAR_ID, source: 'leave' }
    ]

    const results = await Promise.all(calendars.map(async cal => {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`
        + `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`
        + `&singleEvents=true&orderBy=startTime&maxResults=2500`
        + `&timeZone=${encodeURIComponent(QUERY_TZ)}`
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      const data = await r.json()
      // A missing or unshared sub-calendar must not fail the whole week.
      if (data.error) return { source: cal.source, events: [], error: data.error.message }
      return {
        source: cal.source,
        truncated: Boolean(data.nextPageToken),
        events: (data.items || []).map(e => ({
          id: e.id, summary: e.summary || '', description: e.description || '',
          location: e.location || '', colorId: e.colorId || null,
          // Google's version marker, carried so an edit can be rejected when
          // somebody else changed the booking in between.
          etag: e.etag || null,
          start: e.start, end: e.end, source: cal.source
        }))
      }
    }))

    const events = results.flatMap(r => r.events)
    const sourceErrors = results.filter(r => r.error).map(r => ({ source: r.source, error: r.error }))

    return res.status(200).json({
      events,
      window: { start, end, timeMin, timeMax },
      syncedAt: new Date().toISOString(),
      sourceErrors,
      truncated: results.some(r => r.truncated)
    })
  } catch (err) {
    console.error('calendar/week failed:', err.message)
    return res.status(500).json({ error: err.message })
  }
}


// ─── The team leader's run-sheet ──────────────────────────────────────────────
// Shared rather than private. The role runs on a weekly duty rotation and the
// point of the checklist is that the team can see the day's duties are done —
// that the evening sweep happened, that tomorrow's lists went out — so the ticks
// carry who made them.

async function handleRunsheet(req, res) {
  const session = await requireSession(req, res)
  if (!session) return

  try {
    // The Hobart day, from the server, and never from the client. A phone in a
    // different timezone — or one whose clock is simply wrong — would otherwise
    // tick a different day's sheet, and the tick would vanish from the day it
    // was meant for.
    const date = toDateStr(zonedCivil(new Date(), TZ))

    if (req.method === 'GET') {
      return res.status(200).json({ date, ticks: await getRunsheet(date) })
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      const itemId = String(body.itemId || '').trim()
      if (!itemId || itemId.length > 80) {
        return res.status(400).json({ error: 'itemId is required' })
      }

      if (body.done === false) {
        await untickRunsheetItem(date, itemId)
      } else {
        await tickRunsheetItem(date, itemId, firstNameFor(session.email) || 'Someone')
      }
      // The whole day's state comes back, not just this item, so a second person
      // ticking at the same moment shows up immediately rather than on the next
      // poll.
      return res.status(200).json({ date, ticks: await getRunsheet(date) })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}


/**
 * One booking, as the calendar has it right now.
 *
 * The edit sheet loads this rather than editing the case object the week plan
 * built, for two reasons. The plan holds *derived* values — the system
 * uppercased, the supply lifted out of the kit line — and editing those would
 * write the app's rendering back over what the team typed. And the version
 * marker returned here is seconds old rather than however long the screen has
 * been open, which is the difference between a conflict check that fires on real
 * collisions and one that fires constantly.
 */
async function handleBooking(req, res) {
  const session = await requireSession(req, res)
  if (!session) return

  try {
    const eventId = String(req.query.id || '').trim()
    if (!eventId) return res.status(400).json({ error: 'id is required' })

    const event = await getCalendarEvent(eventId)
    const description = event.description || ''
    const labelled = parseLabelledDescription(description)

    return res.status(200).json({
      id: event.id,
      etag: event.etag || null,
      summary: event.summary || '',
      // Who attended, from the bracketed suffix on the title. The calendar
      // carries it and the sheet has to show it back, or an edit would quietly
      // drop the reps somebody recorded.
      reps: extractRep(event.summary || '').reps,
      description,
      start: event.start?.dateTime || event.start?.date || null,
      end: event.end?.dateTime || event.end?.date || null,
      allDay: !event.start?.dateTime,
      colorId: event.colorId || null,
      // The labelled values exactly as written, for the form to edit. The
      // patient's is trimmed to a surname on the way out — the portal shows
      // surnames only, and the rest is preserved on save rather than displayed.
      fields: {
        ...labelled,
        patient: surnameOf(labelled.patient)
      },
      notes: descriptionNotes(description).join('\n')
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

/** The first token of a patient value: "Mitchell (Donna)" → "Mitchell". */
function surnameOf(value) {
  const match = /^\S+/.exec(String(value || '').trim())
  return match ? match[0] : ''
}

// ─── Amending a booking ───────────────────────────────────────────────────────
// The portal writes to the calendar the team relies on, so this is deliberately
// narrow: it changes the fields it was given and nothing else.
//
// The alternative — rebuild the description from what the portal knows — would
// lose whatever the app does not model. The clearest example is a patient's
// first name: the portal holds surnames only by policy, so regenerating would
// delete a "(Donna)" somebody recorded on purpose. The app has also simply been
// wrong about what a booking contains more than once, and a writer that touches
// only what it was asked to cannot lose the parts it still misunderstands.

const EDITABLE = ['patient', 'surgeon', 'procedure', 'kit', 'hospital']

async function handleSave(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const eventId = String(body.eventId || '').trim()
    if (!eventId) return res.status(400).json({ error: 'eventId is required' })

    const current = await getCalendarEvent(eventId)
    let description = current.description || ''
    let summary = current.summary || ''

    for (const field of EDITABLE) {
      if (!Object.prototype.hasOwnProperty.call(body.fields || {}, field)) continue
      const value = String(body.fields[field] ?? '')
      description = setLabelledValue(
        description,
        field,
        // A surname replaces only the first token, so anything after it — a
        // first name, a note — stays exactly where the team put it.
        field === 'patient'
          ? replaceSurname((labelledFieldSpans(description).patient?.value || '').trim(), value)
          : value)
    }

    // Free notes are the unlabelled remainder, so they are rewritten wholesale:
    // there is no label to patch and the client edited the whole block.
    if (typeof body.notes === 'string') {
      description = replaceFreeNotes(description, body.notes)
    }

    // The title is only ever changed when the client asks explicitly, with the
    // text it showed the user. Nothing is reformatted behind anyone's back.
    if (typeof body.summary === 'string' && body.summary.trim()) {
      summary = body.summary.trim().slice(0, 300)
    }

    const patch = { description }
    if (summary !== (current.summary || '')) patch.summary = summary

    // Naive local times plus the zone, never an offset computed on the client.
    // A phone in another timezone — or one whose clock is simply wrong — would
    // otherwise move a booking to the wrong hour, which is the class of bug that
    // had the day view a day out for the first ten hours of every morning.
    if (body.start && body.end) {
      patch.start = { dateTime: body.start, timeZone: TZ }
      patch.end = { dateTime: body.end, timeZone: TZ }
    }

    // The colour follows the surgeon, without anybody choosing it.
    //
    // It is a function of who is operating — the guide says Ibbett is Banana —
    // so asking a person to pick it is asking them to look up a table and get it
    // right, which is exactly how bookings ended up uncoloured or wrong in the
    // first place. Derived from the surgeon on every save instead, so any edit to
    // a booking also puts its colour right.
    //
    // An explicit choice still wins. The picker is there for a booking the guide
    // has no opinion about, and for the day somebody genuinely wants a different
    // colour — deriving it is a default, not a lock.
    if (Object.prototype.hasOwnProperty.call(body, 'colorId')) {
      patch.colorId = body.colorId ? String(body.colorId) : null
    } else {
      const read = readBooking(summary, description)
      const guide = guideColorIdFor(normaliseSurgeon(read?.surgeon || '') || '')
      if (guide && String(current.colorId || '') !== guide) patch.colorId = guide
    }

    patch.description = withAttribution(patch.description, firstNameFor(session.email))
    const saved = await updateCalendarEvent(eventId, patch, { etag: body.etag || current.etag })
    return res.status(200).json({
      ok: true,
      event: {
        id: saved.id, summary: saved.summary || '', description: saved.description || '',
        etag: saved.etag || null, start: saved.start, end: saved.end
      }
    })
  } catch (err) {
    if (err.code === 'conflict') {
      return res.status(409).json({ error: err.message, code: 'conflict' })
    }
    return res.status(500).json({ error: err.message })
  }
}

/**
 * Swaps the unlabelled prose, keeping every labelled line where it is.
 *
 * Rebuilt rather than patched because the notes are whatever is left over, and
 * "left over" has no offsets to write into once the user has rewritten it.
 */
function replaceFreeNotes(description, notes) {
  const text = String(description || '').replace(/\r\n?/g, '\n')
  const spans = Object.values(labelledFieldSpans(text))
  if (!spans.length) return String(notes || '').trim()

  const claimed = new Array(text.length).fill(false)
  for (const span of spans) for (let i = span.at; i < span.to; i++) claimed[i] = true

  const kept = []
  let line = '', touched = false
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      if (touched) kept.push(line)
      line = ''; touched = false
      continue
    }
    if (claimed[i]) touched = true
    if (claimed[i]) line += text[i]
  }
  const trimmed = String(notes || '').trim()
  return trimmed ? `${kept.join('\n')}\n\n${trimmed}` : kept.join('\n')
}


// ─── Creating a booking ───────────────────────────────────────────────────────

/**
 * The title, in the convention the team already writes by hand.
 *
 * "Marsh DIPLOMAT - Ibbett". The title is what shows in Google's month view and
 * in every other calendar app the team opens, so a booking made in the portal
 * has to be indistinguishable from one typed by a person.
 */
function bookingTitle({ patient, system, surgeon, rep }) {
  const parts = [patient, system ? system.toUpperCase() : null].filter(Boolean).join(' ')
  const head = parts || patient || 'Booking'
  const tail = surgeon ? ` - ${surgeon}` : ''
  return `${head}${tail}${rep ? ` (${rep})` : ''}`.replace(/\s{2,}/g, ' ').trim()
}

/**
 * Writes one booking to the calendar.
 *
 * Shared by the +Booking sheet and by accepting something out of the review
 * queue, so a booking that arrived by email is indistinguishable from one the
 * team typed — same title convention, same labelled notes, same colour rule.
 * Two writers would drift apart within a month.
 */
async function writeBooking({ fields = {}, date, notes, rep, colorId }, enteredBy) {
  const patient = String(fields.patient || '').trim()
  const surgeon = String(fields.surgeon || '').trim()
  const day = String(date || '').trim()
  if (!patient) throw Object.assign(new Error('A patient surname is needed'), { status: 400 })
  if (!surgeon) throw Object.assign(new Error('A surgeon is needed'), { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw Object.assign(new Error('A date is needed'), { status: 400 })
  }

  // Built through the same writer the edit sheet uses, so a booking created
  // here reads back exactly like one the team typed.
  let description = ''
  for (const field of ['surgeon', 'patient', 'procedure', 'kit', 'hospital']) {
    const value = String(fields[field] || '').trim()
    if (value) description = setLabelledValue(description, field, value)
  }
  for (const line of String(notes || '').split('\n').map(l => l.trim()).filter(Boolean)) {
    description += `\n\n${line}`
  }

  const kitField = parseLabelledDescription(description).kit || ''
  const summary = bookingTitle({
    patient,
    system: String(kitField).replace(/\s*[([{].*$/, '').trim(),
    surgeon,
    rep: String(rep || '').trim() || null
  })

  // The colour follows the surgeon, exactly as it does on every save.
  const colour = colorId || guideColorIdFor(normaliseSurgeon(surgeon) || '') || null

  return createBookingEvent({
    summary,
    description: withAttribution(description.trim(), enteredBy, { created: true }),
    date: day,
    colorId: colour,
    location: String(fields.hospital || '').trim() || undefined
  })
}

async function handleCreate(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const created = await writeBooking(body, firstNameFor(session.email))
    return res.status(200).json({
      ok: true,
      event: { id: created.id, summary: created.summary || '', etag: created.etag || null }
    })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message })
  }
}


/**
 * Who entered the booking, and who has touched it since.
 *
 * Google records the service account as the creator, which tells nobody
 * anything — every booking made through the portal would look like it came from
 * "Calendar". The team already solved this by hand: real bookings carry lines
 * like "Entered/amended by Brent" at the foot of the notes, so this writes the
 * same thing rather than inventing a new convention.
 *
 * One line, rewritten rather than appended, so a booking edited five times does
 * not end up with five lines of signature. Who entered it is kept; who last
 * amended it replaces the previous amender.
 */
const BY_LINE = /^Entered by [^\n]*$/mi

function withAttribution(description, name, { created = false } = {}) {
  const who = String(name || '').trim()
  if (!who) return description
  const text = String(description || '').replace(/\r\n?/g, '\n').trimEnd()

  if (created || !BY_LINE.test(text)) {
    return `${text}${text ? '\n\n' : ''}Entered by ${who}`
  }
  return text.replace(BY_LINE, line => {
    const enteredBy = /^Entered by ([^·\n]+)/i.exec(line)?.[1]?.trim() || who
    // Somebody amending their own booking is not two people.
    return enteredBy.toLowerCase() === who.toLowerCase()
      ? `Entered by ${enteredBy}`
      : `Entered by ${enteredBy} · amended by ${who}`
  })
}

async function handleDelete(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const eventId = String(body.eventId || '').trim()
    if (!eventId) return res.status(400).json({ error: 'eventId is required' })

    await deleteCalendarEvent(eventId, { etag: body.etag })
    return res.status(200).json({ ok: true })
  } catch (err) {
    if (err.code === 'conflict') {
      return res.status(409).json({ error: err.message, code: 'conflict' })
    }
    return res.status(500).json({ error: err.message })
  }
}

// ─── The booking review queue ────────────────────────────────────────────────
// Bookings arrive at bookings@technomed.com.au from three places in a dozen
// shapes: a pasted RHH theatre table, a PDF from the spine service, a photo of a
// printed list, a sentence in an email. They are read here, held as candidates,
// and written to the calendar only when somebody taps accept.
//
// Nothing in this path replies to, acknowledges, or otherwise writes back to a
// booking source. See the note in src/clinicalPlan/bookingSources.js — it is a
// relationship, not a technical constraint, and it matters more than the code.

/** A stable id for a candidate, so reading the same email twice cannot double it. */
function candidateId({ date, patient, surgeon }) {
  const slug = [date, patient, surgeon].map(v =>
    String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '')).join('-')
  return `bk_${slug || Math.random().toString(36).slice(2, 10)}`
}

async function handleQueue(req, res) {
  const session = await requireSession(req, res)
  if (!session) return

  try {
    const all = await getBookingQueue()
    // Accepted and dismissed candidates stay in storage but not in the team's
    // face. The queue is a to-do list; a cleared one should look cleared.
    const pending = all.filter(c => c.status === 'pending')
    return res.status(200).json({
      ok: true,
      pending,
      recent: all.filter(c => c.status !== 'pending').slice(0, 20),
      count: pending.length
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * Reads unread bookings out of the mailbox and queues what it finds.
 *
 * The RHH weekly table is parsed deterministically — it is well formed, it is
 * the highest volume by far, and there is no sense paying a model to read a
 * table. Everything else goes to the vision reader, which handles PDFs, photos
 * and freeform text alike.
 */
// How many new emails one run will read. A booking that arrives as a photo
// costs a model call to read, and a mailbox with a fortnight of backlog would
// otherwise run past the function's time limit and return nothing at all. Five
// at a time finishes well inside it; the response says how many are left so the
// team can tap again rather than wonder.
const PER_RUN = 5

async function handleIngest(req, res) {
  const session = await requireSession(req, res)
  if (!session) return

  try {
    // A fortnight back is enough to catch up after a quiet week without trawling
    // the whole mailbox on every run.
    const messageIds = await searchMailbox('newer_than:14d -in:spam', { max: 60 })
    const existing = await getBookingQueue()

    let read = 0
    let skipped = 0
    let remaining = 0
    let unreadable = 0
    const queued = []

    for (const messageId of messageIds) {
      if (await bookingEmailSeen(messageId)) continue
      if (read >= PER_RUN) { remaining += 1; continue }

      const email = await readMessage(messageId)
      const source = sourceOf(addressOf(email.from))

      // Only the addresses bookings actually come from are read. Everything else
      // in the mailbox — a newsletter, a delivery receipt, a reply to one of our
      // own emails — is not worth a model call, and worse, asking a model to
      // find surgical cases in a newsletter invites it to find some. Skipped
      // emails are counted and reported rather than quietly dropped: a booking
      // from a domain nobody has told the app about would otherwise vanish.
      if (!source) {
        skipped += 1
        await markBookingEmailSeen(messageId, 0)
        continue
      }
      read += 1

      let found = []
      try {
        if (source.id === 'rhh') found = parseTheatreList(email)
        // Either it is not the RHH table, or the table was unreadable. Both are
        // reasons to let the model look rather than to give up on the email.
        if (!found.length) found = await readBookingDocument(email)
      } catch (err) {
        // One email that cannot be read must not cost the other four. It is
        // retried on the next run and reported meanwhile — an email that fails
        // quietly is a booking nobody knows was missed.
        unreadable += 1
        await markBookingEmailFailed(messageId, err.message)
        continue
      }

      for (const booking of found) {
        if (!booking.patient && !booking.surgeon) continue

        const candidate = {
          ...booking,
          systems: booking.systems || systemsInKit(booking.kit || ''),
          hospital: booking.hospital || source.hospital || '',
          id: candidateId(booking),
          status: 'pending',
          messageId,
          subject: email.subject || '',
          receivedAt: email.receivedAt,
          sources: [source.id],
          createdAt: new Date().toISOString()
        }

        // The same case from CNS and from Calvary is one booking. Merging keeps
        // whichever copy said more, field by field, and — deliberately — never
        // tells either sender that the other got in first.
        const twin = [...existing, ...queued].find(
          c => c.status !== 'dismissed' && isSameBooking(c, candidate))
        if (twin) {
          const merged = mergeBookings(twin, candidate)
          await saveBookingCandidate(merged)
          Object.assign(twin, merged)
          continue
        }

        // A case already dismissed stays dismissed: re-reading the email that
        // carried it must not resurrect it.
        const buried = existing.find(c => c.status === 'dismissed' && isSameBooking(c, candidate))
        if (buried) continue

        await saveBookingCandidate(candidate)
        queued.push(candidate)
      }

      await markBookingEmailSeen(messageId, found.length)
    }

    const pending = (await getBookingQueue()).filter(c => c.status === 'pending')
    return res.status(200).json({
      ok: true, read, skipped, remaining, unreadable,
      found: queued.length, count: pending.length, pending
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

/** Accept: the candidate, as edited on screen, goes to the calendar. */
async function handleAccept(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const id = String(body.id || '').trim()
    const candidate = await getBookingCandidate(id)
    if (!candidate) return res.status(404).json({ error: 'That booking is no longer in the queue' })
    if (candidate.status === 'accepted') {
      // Two taps on a slow connection must not make two bookings.
      return res.status(200).json({ ok: true, alreadyAccepted: true, candidate })
    }

    // What the screen shows is what gets written — the team corrects the reading
    // in front of them, and those corrections are the point of the queue.
    const fields = body.fields || {
      patient: candidate.patient,
      surgeon: candidate.surgeon,
      procedure: candidate.procedure,
      kit: candidate.kit,
      hospital: candidate.hospital
    }
    const created = await writeBooking({
      fields,
      date: body.date || candidate.date,
      notes: body.notes ?? candidate.note,
      rep: body.rep,
      colorId: body.colorId
    }, firstNameFor(session.email))

    const accepted = await updateBookingCandidate(id, {
      status: 'accepted',
      acceptedBy: firstNameFor(session.email),
      acceptedAt: new Date().toISOString(),
      eventId: created.id
    })

    return res.status(200).json({
      ok: true,
      candidate: accepted,
      event: { id: created.id, summary: created.summary || '', etag: created.etag || null }
    })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message })
  }
}

/** Dismiss: not a case, already on the calendar, or cancelled before it started. */
async function handleDismiss(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const id = String(body.id || '').trim()
    const dismissed = await updateBookingCandidate(id, {
      status: 'dismissed',
      dismissedBy: firstNameFor(session.email),
      dismissedAt: new Date().toISOString(),
      reason: String(body.reason || '').trim() || null
    })
    return res.status(200).json({ ok: true, candidate: dismissed })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
