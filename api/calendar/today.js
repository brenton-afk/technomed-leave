import { settleTask } from '../_taskDone.js'
import {
  TZ, zonedCivil, addCivilDays, zonedToInstant, toDateStr, parseDateStr
} from '../../src/clinicalPlan/week.js'
import {
  getGoogleToken, getCalendarId, CALENDAR_SCOPE_READONLY, CALENDAR_SCOPE_WRITE,
  serviceAccountEmail
} from '../_googleCalendar.js'
import { requireSession, requireAdmin } from '../_auth.js'
import {
  getNoticeSettings, saveNoticeSettings, noticesFor, describeBooking,
  holdNotice, takeNotice, restoreNotice, previewOf, loanRequestsFor, loanStateFor, recordLoanRequest, loanLogFor,
  hospitalLoanNoticesFor, DEFAULT_HOSPITAL_LOAN_NOTICES
} from '../_bookingNotices.js'
import { sendBookingNotice, escapeHtml } from '../_email.js'
import { cachedLoanTrail, attachmentFor } from '../_loanTrail.js'
import { markNoUsage, isMarkedNoUsage } from '../_usageReminders.js'
import {
  taskSummary, taskDescription, kindFor, isTask, doneLine, TASK_PREFIX, readTask
} from '../../src/clinicalPlan/tasks.js'

/**
 * Tomato — the eleventh Google colour, and the only one no surgeon owns.
 *
 * colours.js already calls it "General alerts", so a task is not borrowing a
 * meaning; it is the thing that meaning was for. A task in a surgeon's colour
 * would read as that surgeon having a case.
 */
const TASK_COLOR_ID = '11'
import {
  updateCalendarEvent, getCalendarEvent, createBookingEvent, createTaskEvent,
  deleteCalendarEvent, BOOKING_TZ
} from '../_googleCalendar.js'
import {
  setLabelledValue, replaceSurname, labelledFieldSpans,
  parseLabelledDescription, descriptionNotes, withDateFollowing, removeLabelledLine
} from '../../src/clinicalPlan/labelledFields.js'
import {
  readBooking, normaliseSurgeon, extractRep, stripIdentifiers,
  markCancelled, stripCancellation, isCancelled
} from '../../src/clinicalPlan/parse.js'
import { guideColorIdFor } from '../../src/clinicalPlan/colours.js'
import {
  getRunsheet, tickRunsheetItem, untickRunsheetItem,
  bookingEmailRecord, markBookingEmailSeen, markBookingEmailFailed, saveBookingCandidate,
  getBookingCandidate, getBookingQueue, updateBookingCandidate,
  setTeamLeaderFor, setDayLeader, getWorklist, redis,
  getUsageHistory, getRecentResupplies
} from '../_redis.js'
import { listKits } from '../_kits.js'
import { getPreferences } from '../_preferences.js'
import { searchPortal } from '../_portalSearch.js'
import { searchChat } from '../_chatSearch.js'
import { searchMailbox, readMessage, addressOf, headersOf } from '../_gmail.js'
import { parseTheatreList } from '../../src/clinicalPlan/parseTheatreList.js'
import { readBookingDocument } from '../_readBookingDocument.js'
import { readDictatedBooking } from '../_readDictatedBooking.js'
import { readVoiceCommand } from '../_voiceCommand.js'
import {
  sourceOf, isSameBooking, mergeBookings, isDistributorEmail, alreadyInCalendar, asksForCover, DISTRIBUTOR_REQUEST,
  movedOnCalendar, loanLogisticsTwin
} from '../../src/clinicalPlan/bookingSources.js'
import { systemsInKit, resolveKit } from '../../src/clinicalPlan/systems.js'
import {
  hourForNewCase, layOutDay, hourToTime, inPreferredOrder
} from '../../src/clinicalPlan/dayLayout.js'
import { cleanListPlace, withListPlace, bySession } from '../../src/clinicalPlan/listPlace.js'
import { weekOf, cleanLeader, turnOf } from '../../src/clinicalPlan/teamLeader.js'
import { leadersOn, turnLeader, leaderEmailOn } from '../_leaders.js'
import { dropboxConfigured, searchUsage } from '../_dropbox.js'
import {
  readFiledCase, priorImplantsFor, describePrior
} from '../../src/clinicalPlan/priorImplants.js'
import { firstNameFor, getStaffByEmail as STAFF_BY_EMAIL, parseRepNames } from '../../src/staffConfig.js'
import { sanitisePatient } from '../../src/clinicalPlan/parse.js'
import { withAttribution, creatorTag } from '../../src/clinicalPlan/attribution.js'

/**
 * Whether this person may allocate reps to a case on this day (Task 10).
 *
 * "Team leader does the allocation." The leader for that week — the set cover
 * if there is one, otherwise the rota — plus Brent and Erin, so a week whose
 * leader is away is not a week nobody can allocate.
 */
async function canAllocate(session, day) {
  if (STAFF_BY_EMAIL(session.email)?.isAdmin) return true
  const date = String(day || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  // That day's leader: a one-day change, else the turn's (Friday to Thursday).
  let email = null
  try { email = await leaderEmailOn(date) } catch { email = null }
  return Boolean(email) && email.toLowerCase() === String(session.email).toLowerCase()
}

/** A YYYY-MM-DD date `n` days on, by the calendar rather than the clock. */
function addDaysTo(date, n) {
  return toDateStr(addCivilDays(parseDateStr(date), n))
}

/** Today in Hobart, YYYY-MM-DD — on the real zone, so daylight saving holds. */
function hobartToday() {
  return toDateStr(zonedCivil(new Date(), TZ))
}

/** Who the portal recorded as entering this booking, if it did. */
function knownCreatorOf(event) {
  return event?.extendedProperties?.private?.tmEnteredBy || null
}

/**
 * The patient's surname as somebody typed it into the portal.
 *
 * Written to the event's private extendedProperties on every create and every
 * save that changes the surname, because a title cannot say where a two-word
 * surname ends and the parser had been cutting them to one. Private
 * properties are visible only to this calendar's own API callers, never shown
 * in Google's UI, and hold nothing the title does not already.
 */
export function knownPatientOf(event) {
  return event?.extendedProperties?.private?.tmPatient || null
}

/** The structured properties a patient surname is stored under. */
function patientProperties(surname, extra = {}) {
  const clean = sanitisePatient(surname, { known: surname })
  const props = { ...(clean ? { tmPatient: clean } : {}), ...extra }
  return Object.keys(props).length ? { private: props } : null
}

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
  if (req.query.action === 'loantrail') return handleLoanTrail(req, res)
  if (req.query.action === 'loanattachment') return handleLoanAttachment(req, res)
  if (req.query.action === 'create') return handleCreate(req, res)
  // Kit to move, a tray to get back, something to restock. Not an operation,
  // and the part of a week that actually goes wrong.
  if (req.query.action === 'task') return handleTask(req, res)
  if (req.query.action === 'taskdone') return handleTaskDone(req, res)
  if (req.query.action === 'delete') return handleDelete(req, res)
  // The booking review queue. Bookings read out of bookings@ wait here for a
  // person before they reach the calendar — see api/_redis.js for why.
  if (req.query.action === 'queue') return handleQueue(req, res)
  if (req.query.action === 'ingest') return handleIngest(req, res)
  if (req.query.action === 'accept') return handleAccept(req, res)
  if (req.query.action === 'dismiss') return handleDismiss(req, res)
  // A booking spoken into the phone. Fills the form; does not make the booking.
  if (req.query.action === 'dictate') return handleDictate(req, res)
  // One button, four things. See _voiceCommand.js — it reads and routes, and
  // writes nothing: the app does that only after somebody has tapped.
  if (req.query.action === 'voice') return handleVoice(req, res)
  // The running order of a theatre list, taken on the evening ring-round.
  // Nothing in the app calls this any more — the arrows that drove it are
  // gone, because the number they moved counted only our cases and disagreed
  // with the hospital's list whenever anybody else had one on. Left in place
  // rather than deleted: it moves real calendar entries, and removing a
  // working endpoint is a separate decision from removing the buttons.
  if (req.query.action === 'reorder') return handleReorder(req, res)
  if (req.query.action === 'listplace') return handleListPlace(req, res)
  if (req.query.action === 'leader') return handleTeamLeader(req, res)
  // Calling a case off, and putting it back on.
  if (req.query.action === 'cancel') return handleCancel(req, res)
  // What this patient already has in, for a revision or a removal.
  if (req.query.action === 'prior') return handlePrior(req, res)
  if (req.query.action === 'search') return handleSearch(req, res)
  if (req.query.action === 'find') return handleFind(req, res)
  if (req.query.action === 'notify') return handleNotify(req, res)
  if (req.query.action === 'nousage') return handleNoUsage(req, res)
  if (req.query.action === 'noticesettings') return handleNoticeSettings(req, res)

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

    const events = (data.items || [])
      .filter(e => !isDistributorEmail(e.organizer?.email))
      .map(e => ({
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
      if (data.error) {
        // Named, so the fix is a paste rather than a hunt through Vercel's
        // settings for the service account's address.
        const who = serviceAccountEmail()
        return {
          source: cal.source,
          events: [],
          error: data.error.message,
          calendarId: cal.id,
          shareWith: who || null
        }
      }
      return {
        source: cal.source,
        truncated: Boolean(data.nextPageToken),
        events: (data.items || [])
          // A distributor's confirmation invite is our own booking coming back
          // to us. Google adds it to this calendar unasked because bookings@ is
          // an attendee, and shown in the app it reads as a second, separate
          // case for the same patient. See bookingSources.js.
          .filter(e => !isDistributorEmail(e.organizer?.email))
          .map(e => ({
          id: e.id, summary: e.summary || '', description: e.description || '',
          location: e.location || '', colorId: e.colorId || null,
          // Google's version marker, carried so an edit can be rejected when
          // somebody else changed the booking in between.
          etag: e.etag || null,
          start: e.start, end: e.end, source: cal.source,
          // The surname as typed into the portal — see knownSurnameLength.
          knownPatient: knownPatientOf(e)
        }))
      }
    }))

    const events = results.flatMap(r => r.events)
    const sourceErrors = results.filter(r => r.error).map(r => ({
      source: r.source, error: r.error, calendarId: r.calendarId, shareWith: r.shareWith
    }))

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
/**
 * The loan sets on a booking, with the email trail behind each one.
 * See api/_loanTrail.js for where it looks and why that is narrow.
 */
async function handleLoanTrail(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  try {
    const eventId = String(req.query.id || '').trim()
    if (!eventId) return res.status(400).json({ error: 'id is required' })
    const event = await getCalendarEvent(eventId)
    const booking = describeBooking(event)
    const result = await cachedLoanTrail(eventId, booking, await loanLogFor(eventId).catch(() => []),
      { fresh: req.query.fresh === '1' })
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json(result)
  } catch (err) {
    // No email content or names in the error: only what failed.
    return res.status(500).json({ error: 'The loan set emails could not be read just now.', detail: String(err?.status || '') })
  }
}

/** One attachment from a loan set's trail, by the token handed out with it. */
async function handleLoanAttachment(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  try {
    const found = await attachmentFor(String(req.query.t || ''))
    if (!found) return res.status(404).json({ error: 'That attachment link has expired — reopen the booking.' })
    res.setHeader('Content-Type', found.mediaType)
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Disposition', `inline; filename="${String(found.filename).replace(/[^\w.\- ]/g, '_')}"`)
    return res.status(200).send(Buffer.from(found.data, 'base64'))
  } catch {
    return res.status(500).json({ error: 'The attachment could not be opened just now.' })
  }
}

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
        // The whole surname, however many words it is. This used to take the
        // first word, so "Van der Berg" opened as "Van" — and saving that
        // back would have cut the name on the calendar too.
        patient: surnameOf(labelled.patient, knownPatientOf(event)
          || readBooking(event.summary || '', description)?.patient)
      },
      notes: descriptionNotes(description).join('\n'),
      // Task 10: who is allocated, and whether this person may change it.
      planned: parseRepNames(labelled.planned),
      // Marked as having no usage, which stops the 6pm reminder (Task 11).
      noUsage: await isMarkedNoUsage(event.id),
      // Every loan set requested, changed or called off for this case, and who
      // sent it when — shown in the booking.
      loanLog: await loanLogFor(event.id).catch(() => []),
      canAllocate: await canAllocate(session, event.start?.dateTime || event.start?.date)
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * The surname out of a patient value: "Mitchell (Donna)" → "Mitchell".
 *
 * As written — not re-cased — because the edit form sends a field back only
 * when it differs from this, and a value tidied on the way out would look
 * changed on the way back in. The word count comes from the shared reader, so
 * the form and the case card agree on where the name ends.
 */
function surnameOf(value, known) {
  const words = String(value || '').trim().split(',')[0].trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  const read = sanitisePatient(words.join(' '), { known })
  const take = read ? read.split(/\s+/).length : 1
  return words.slice(0, take).join(' ')
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
          ? replaceSurname(
            (labelledFieldSpans(description).patient?.value || '').trim(), value,
            surnameOf(labelledFieldSpans(description).patient?.value, knownPatientOf(current)
              || readBooking(current.summary || '', current.description || '')?.patient))
          : value)
    }

    // Who is allocated (Task 10). Only the week's team leader, or an admin.
    if (Object.prototype.hasOwnProperty.call(body.fields || {}, 'planned')) {
      if (!(await canAllocate(session, current.start?.dateTime || current.start?.date))) {
        return res.status(403).json({ error: 'Only the team leader for that week can allocate reps' })
      }
      const names = parseRepNames(body.fields.planned)
      description = names.length
        ? setLabelledValue(description, 'planned', names.join(' / '))
        : removeLabelledLine(description, 'planned')
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

    // The hospital is also the event's location — it is what Google shows and
    // what a phone's map opens. Written on create and never on an edit, so a
    // booking moved from RHH to Calvary still said RHH under its title.
    if (Object.prototype.hasOwnProperty.call(body.fields || {}, 'hospital')) {
      const site = String(body.fields.hospital || '').trim()
      if (site && site !== (current.location || '')) patch.location = site
    }

    // The surname, recorded as a fact rather than left to be re-read from the
    // title. Patched as a map, so any other private property is kept.
    if (Object.prototype.hasOwnProperty.call(body.fields || {}, 'patient')) {
      const props = patientProperties(body.fields.patient)
      if (props) patch.extendedProperties = props
    }

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

    // The written date follows the booking. "When a booking is moved in the
    // portal and the calendar entry follows it, we need to ensure that the
    // date in the description gets altered, so that the information is
    // accurate" — the entry moved to Tuesday 13 October and the notes under
    // it still said 08/10/2026.
    //
    // Checked on every save, not only on a move. The ones that are already
    // out of step were put that way by moves that happened before this
    // existed, and they do not fix themselves by being moved again. Any edit
    // to the booking now straightens it out, and a description that already
    // agrees is left untouched.
    const wasOn = (current.start?.dateTime || current.start?.date || '').slice(0, 10)
    const onDay = (patch.start?.dateTime || '').slice(0, 10) || wasOn
    patch.description = withDateFollowing(patch.description, onDay)

    patch.description = withAttribution(patch.description, firstNameFor(session.email),
      { knownCreator: knownCreatorOf(current), today: hobartToday() })
    const saved = await updateCalendarEvent(eventId, patch, { etag: body.etag || current.etag })

    // A move is only reported once Google says the event is on the new day.
    if (patch.start) {
      const landed = (saved.start?.dateTime || saved.start?.date || '').slice(0, 10)
      if (landed !== patch.start.dateTime.slice(0, 10)) {
        return res.status(502).json({
          error: `The calendar did not take the new date (it still says ${landed || 'nothing'})`
        })
      }
    }

    // Both days, when a booking moves: the one it left has a hole and the one it
    // arrived on has two cases in one hour. Tidying only the destination leaves
    // the gap behind it, which is how a calendar drifts back to needing a person.
    const nowOn = (saved.start?.dateTime || saved.start?.date || '').slice(0, 10)
    for (const day of [...new Set([wasOn, nowOn].filter(Boolean))]) {
      await tidyDay(day).catch(() => {})
    }

    const notices = await prepareNotices({
      kind: nowOn && wasOn && nowOn !== wasOn ? 'moved' : 'changed',
      beforeEvent: current, afterEvent: saved, eventId, session
    })

    return res.status(200).json({
      ok: true,
      ...notices,
      event: {
        id: saved.id, summary: saved.summary || '', description: saved.description || '',
        etag: saved.etag || null,
        // Strings, in the same shape as action=booking. These went back as
        // Google's {dateTime, timeZone} objects, the edit sheet merged them
        // over the booking it had loaded, and the date it compared against
        // then read as empty — so every save that rewrote the title announced
        // "Moving this booking to…" and sent the times again.
        start: saved.start?.dateTime || saved.start?.date || null,
        end: saved.end?.dateTime || saved.end?.date || null
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
function bookingTitle({ patient, system, surgeon, rep, noF2F }) {
  // "BRAINLAB (No F2F)" — said in the title because the title is what the
  // whole team reads in Google's month view, and whether anybody goes is the
  // first thing to know about a navigation-only case.
  const named = system ? `${system.toUpperCase()}${noF2F ? ' (No F2F)' : ''}` : (noF2F ? '(No F2F)' : null)
  const parts = [patient, named].filter(Boolean).join(' ')
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
async function writeBooking({ fields: given = {}, date, notes, rep, colorId, attendance }, enteredBy, { source } = {}) {
  let fields = given
  const patient = String(fields.patient || '').trim()
  const surgeon = String(fields.surgeon || '').trim()
  const day = String(date || '').trim()
  if (!patient) throw Object.assign(new Error('A patient surname is needed'), { status: 400 })
  if (!surgeon) throw Object.assign(new Error('A surgeon is needed'), { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw Object.assign(new Error('A date is needed'), { status: 400 })
  }

  // Aliases and a bare E4 resolved once more on the way to the calendar. The
  // sheet and the queue both resolve before showing, but a booking can be
  // written from a stale candidate or from a route that never drew a card, and
  // what lands in Google has to name a system somebody can bring.
  if (fields.kit) fields = { ...fields, kit: resolveKit(fields.kit, fields.procedure || '') }

  // Built through the same writer the edit sheet uses, so a booking created
  // here reads back exactly like one the team typed.
  //
  // The date is written into the notes along with everything else. The event
  // already carries its own start time, so as data this repeats itself — but a
  // booking is read as a block of text, in an email, in a screenshot, pasted
  // into a message, and a block that names the surgeon and the patient and not
  // the day is missing the thing it is most often being checked for. The team
  // writes it by hand for exactly that reason, which is why the parser already
  // knows to consume the line and not report it as a note.
  //
  // The order is the order it is read in: who, whom, when, where, what.
  const written = {
    ...fields,
    date: `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`
  }
  let description = ''
  for (const field of ['surgeon', 'patient', 'date', 'hospital', 'procedure', 'kit']) {
    const value = String(written[field] || '').trim()
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
    rep: String(rep || '').trim() || null,
    noF2F: attendance === 'No F2F'
  })

  // The colour follows the surgeon, exactly as it does on every save.
  const colour = colorId || guideColorIdFor(normaliseSurgeon(surgeon) || '') || null

  // An hour of its own, after this surgeon's other cases where there is room.
  // A calendar that cannot be read is no reason to refuse the booking; it only
  // means this one starts the day.
  let hour = 8
  try {
    const sameDay = (await bookingsOnCalendar(day, day)).filter(c => !c.cancelled)
    hour = hourForNewCase(sameDay, surgeon)
  } catch {
    hour = 8
  }

  const created = await createBookingEvent({
    summary,
    description: withAttribution(description.trim(), enteredBy, { created: true, source }),
    date: day,
    colorId: colour,
    location: String(fields.hospital || '').trim() || undefined,
    hour,
    // Who entered it, kept apart from the notes so a line tidied away in
    // Google cannot lose it. See attribution.js.
    extendedProperties: patientProperties(patient,
      enteredBy ? { tmEnteredBy: creatorTag(enteredBy, { source }) } : {}) || undefined
  })

  // Packed here rather than in each handler, so every route that makes a
  // booking — the sheet, dictation, accepting one out of the queue — leaves the
  // day tidy without having to remember to.
  await tidyDay(day).catch(() => {})
  return created
}

async function handleCreate(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const created = await writeBooking(body, firstNameFor(session.email))
    const notices = await prepareNotices({ kind: 'new', afterEvent: created, eventId: created.id, session })
    return res.status(200).json({
      ok: true,
      event: { id: created.id, summary: created.summary || '', etag: created.etag || null },
      ...notices
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
// withAttribution lives in src/clinicalPlan/attribution.js, where it is
// tested on its own.

/**
 * Adds a task to a day.
 *
 * "These reminders are important and need to be really easy to add to the day
 * so everyone can see them. It needs to be easier than adding a task in Google
 * Calendar, which is a bit clunky and relies on a lot of text entry."
 *
 * So the body is a handful of chosen values rather than prose, and the wording
 * is composed here from them. Nothing a phone keyboard has to produce.
 */
async function handleTask(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const date = String(body.date || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'A date is needed' })
    }
    if (!kindFor(body.kind)) return res.status(400).json({ error: 'Pick what kind of task' })

    // The one free-text field there is, held to the same rule as every other
    // string that reaches this calendar.
    const task = {
      kind: body.kind,
      thing: stripIdentifiers(String(body.thing || '')).trim().slice(0, 120),
      from: stripIdentifiers(String(body.from || '')).trim().slice(0, 40),
      to: stripIdentifiers(String(body.to || '')).trim().slice(0, 40),
      who: stripIdentifiers(String(body.who || '')).trim().slice(0, 40),
      note: stripIdentifiers(String(body.note || '')).trim().slice(0, 200),
      // The case a kit move is for: surgeon, hospital and day, never the
      // patient (see casesUsingKit in tasks.js), and the booking's id.
      forCase: stripIdentifiers(String(body.forCase || '')).trim().slice(0, 80),
      addedBy: firstNameFor(session.email)
    }
    const caseId = /^[A-Za-z0-9_]{1,200}$/.test(String(body.caseId || '')) ? String(body.caseId) : ''
    const summary = taskSummary(task)
    if (!summary || summary === TASK_PREFIX) {
      return res.status(400).json({ error: 'Say what the task is' })
    }

    const created = await createTaskEvent({
      summary,
      description: taskDescription(task),
      date,
      colorId: TASK_COLOR_ID,
      ...(caseId && task.forCase ? { extendedProperties: { private: { tmCaseId: caseId } } } : {})
    })

    return res.status(200).json({
      ok: true,
      event: { id: created.id, summary: created.summary || '', date }
    })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message })
  }
}

/**
 * Ticks a task off, or puts it back.
 *
 * Appended to the notes rather than deleted, and the entry stays on the day
 * greyed out. A task that vanishes when it is done leaves nobody able to answer
 * "did anybody actually fetch that tray" — which is the question the task was
 * written to prevent in the first place.
 */
async function handleTaskDone(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const eventId = String(body.eventId || '').trim()
    if (!eventId) return res.status(400).json({ error: 'eventId is required' })
    const done = body.done !== false

    const current = await getCalendarEvent(eventId)
    if (!isTask(current.summary || '')) {
      return res.status(400).json({ error: 'That is not a task' })
    }

    const without = String(current.description || '')
      .replace(/^\s*Done by [^\n]*$/gmi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd()

    const description = done
      ? `${without}\n\n${doneLine(firstNameFor(session.email), todayInHobart())}`.trim()
      : without

    const saved = await updateCalendarEvent(eventId, {
      description,
      // Grey once it is done, so the calendar says so too and not only the app.
      colorId: done ? '8' : TASK_COLOR_ID
    }, { etag: body.etag })

    // Its copies on other days, and the project list. See api/_taskDone.js.
    const settled = await settleTask({
      event: { ...current, description }, done,
      who: firstNameFor(session.email), when: todayInHobart(), taskColour: TASK_COLOR_ID
    })

    return res.status(200).json({
      ok: true, done,
      event: { id: saved.id, summary: saved.summary || '', etag: saved.etag || null },
      copies: settled.copies,
      projectItems: settled.projectItems
    })
  } catch (err) {
    if (err.code === 'conflict') {
      return res.status(409).json({ error: err.message, code: 'conflict' })
    }
    return res.status(err.status || 500).json({ error: err.message })
  }
}

async function handleDelete(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const eventId = String(body.eventId || '').trim()
    if (!eventId) return res.status(400).json({ error: 'eventId is required' })

    // Read before it goes, so the day it was on can be closed up after.
    let wasOn = null
    let doomed = null
    try {
      doomed = await getCalendarEvent(eventId)
      wasOn = (doomed?.start?.dateTime || doomed?.start?.date || '').slice(0, 10) || null
    } catch {
      wasOn = null
    }

    await deleteCalendarEvent(eventId, { etag: body.etag })
    // Otherwise the day keeps the hole where the case was.
    if (wasOn) await tidyDay(wasOn).catch(() => {})
    // Deleted is cancelled, as far as a supplier is concerned.
    const notices = doomed
      ? await prepareNotices({ kind: 'cancelled', beforeEvent: doomed, eventId, session })
      : {}
    return res.status(200).json({ ok: true, ...notices })
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

/**
 * Bookings already on the calendar over a span of days.
 *
 * The queue used to compare a new candidate only against other candidates, so
 * it caught the same case arriving twice by email and missed the far commoner
 * thing: a case somebody already entered. The first real mailbox check offered
 * a queue of bookings that were, all but one, already on the calendar.
 *
 * Read once for the whole span rather than per candidate — a theatre list is a
 * week of cases and that would be a week of round trips.
 */
async function bookingsOnCalendar(from, to) {
  const token = await getGoogleToken(CALENDAR_SCOPE_READONLY)
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(getCalendarId())}/events`
    + `?timeMin=${encodeURIComponent(`${from}T00:00:00+11:00`)}`
    + `&timeMax=${encodeURIComponent(`${to}T23:59:59+10:00`)}`
    + '&singleEvents=true&orderBy=startTime&maxResults=2500'
    + `&timeZone=${encodeURIComponent(QUERY_TZ)}`

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)

  return (data.items || [])
    .filter(e => !isDistributorEmail(e.organizer?.email))
    .map(e => {
      const read = readBooking(e.summary || '', e.description || '', { knownPatient: knownPatientOf(e) })
      if (!read?.patient) return null
      const start = e.start?.dateTime || e.start?.date || ''
      return {
        id: e.id,
        summary: e.summary || '',
        patient: read.patient,
        surgeon: read.surgeon || '',
        // The operation, so an email for a different operation on the same
        // surname is not mistaken for this one having moved.
        procedure: read.operation || '',
        date: start.slice(0, 10),
        // The hour it occupies, for laying out a new case beside it. All-day
        // entries have no hour and are not part of the column.
        hour: e.start?.dateTime ? Number(e.start.dateTime.slice(11, 13)) : null,
        cancelled: Boolean(read.cancelled)
      }
    })
    .filter(Boolean)
}

/**
 * Re-lays a day's cases into consecutive one-hour blocks.
 *
 * Run after anything that changes a day. Placing a *new* booking well is not
 * enough to keep a calendar tidy: delete the 9am case and there is a hole;
 * move one to another day and there is a hole behind it and a collision in
 * front. The admin assistant was going through afterwards and packing them by
 * hand, which is the app's job and the reason this exists.
 *
 * Only cases are touched. Leave, office days, the run-sheet reminder and the
 * distributors' own invites are not part of the column and are left exactly as
 * they are. Nothing is moved that is already where it should be, so a day that
 * is already tidy costs one read and no writes.
 *
 * Times here mean nothing about when anyone operates — they did not before
 * either, when every booking claimed 08:00 to 17:00. See dayLayout.js.
 */
async function tidyDay(date, preferred = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return { moved: 0 }

  const token = await getGoogleToken(CALENDAR_SCOPE_WRITE)
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(getCalendarId())}/events`
    + `?timeMin=${encodeURIComponent(`${date}T00:00:00+11:00`)}`
    + `&timeMax=${encodeURIComponent(`${date}T23:59:59+10:00`)}`
    + '&singleEvents=true&orderBy=startTime&maxResults=250'
    + `&timeZone=${encodeURIComponent(QUERY_TZ)}`

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)

  const cases = (data.items || [])
    // All-day entries are leave, office days and reminders — not a column.
    .filter(e => e.start?.dateTime)
    .filter(e => !isDistributorEmail(e.organizer?.email))
    .map(e => {
      const read = readBooking(e.summary || '', e.description || '', { knownPatient: knownPatientOf(e) })
      // A cancelled case keeps its place in the calendar but not in the
      // running order — the day should close up around it, the same as if it
      // had been deleted.
      // A booking the hospital has not named yet still holds a slot, and the
      // day has to close up around it like any other.
      return (read?.patient || read?.awaitingName)
        && !isCancelled(e.summary || '', e.description || '')
        ? {
          id: e.id,
          etag: e.etag,
          surgeon: read.surgeon || '',
          // Where the hospital said we sit. The day is packed in that order
          // where anybody has recorded one — that is the whole point of having
          // rung them — and in the order it already held where nobody has.
          listPlace: read.listPlace,
          from: e.start.dateTime.slice(11, 16)
        }
        : null
    })
    .filter(Boolean)

  // A running order, when the team has just set one. Anything the order does
  // not name keeps its place behind what it does — a case booked after the
  // hospital rang should not shove the list about on its way in.
  const ordered = inPreferredOrder(bySession(cases), preferred)

  const slots = layOutDay(ordered)
  let moved = 0
  for (let i = 0; i < ordered.length; i++) {
    const want = String(slots[i].hour).padStart(2, '0')
    if (ordered[i].from === `${want}:00`) continue
    try {
      await updateCalendarEvent(ordered[i].id, {
        start: { dateTime: `${date}T${hourToTime(slots[i].hour)}`, timeZone: BOOKING_TZ },
        end: { dateTime: `${date}T${hourToTime(slots[i].hour + 1)}`, timeZone: BOOKING_TZ }
      })
      moved += 1
    } catch {
      // One event that will not move is not a reason to leave the rest ragged.
    }
  }
  return { moved }
}

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
    // Accepted, dismissed and already-booked candidates stay in storage but not
    // in the team's face. The queue is a to-do list; a cleared one should look
    // cleared, and a case already on the calendar is not a thing to do.
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
const PER_RUN = 8
// How many of those are read at once. Reading one email is mostly waiting on
// the model; four at a time takes a run from about a minute and a half to
// about twenty seconds without asking the API for more than it will give.
const READ_AT_ONCE = 4

/** Runs `work` over `items`, `limit` at a time, keeping the order of results. */
async function inBatches(items, limit, work) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await work(items[i], i)
    }
  }))
  return out
}

async function handleIngest(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  // background=1: the app's quiet check on opening (Brent, 6 Nov 2026: "add
  // the bookings so Mat can just log in and check them"). It skips if another
  // check ran in the last ten minutes, and never fails loudly.
  if (req.query.background) {
    if (await redis('SET', INGEST_RECENT, '1', 'NX', 'EX', '600').catch(() => null) !== 'OK') {
      return res.status(200).json({ ok: true, skipped: 'checked recently' })
    }
  }
  try {
    return res.status(200).json(await ingestBookings())
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

const INGEST_RECENT = 'bookings:ingest:recent'

/**
 * One pass over bookings@: new booking emails read and queued as cards in
 * Cases → Inbox, waiting for a person to accept. Nothing reaches the
 * calendar from here. Used by the Inbox, the app's background check on
 * opening, and both daily jobs.
 */
const INGEST_LOCK = 'bookings:ingest:lock'

export async function ingestBookings() {
  // One pass at a time. The two crons, the Inbox and the background check on
  // opening can all start one, and two passes over the same new email both
  // found it unseen and queued it twice — two cards for one case. A second
  // pass just answers with the queue as it stands.
  if (await redis('SET', INGEST_LOCK, '1', 'NX', 'EX', '90').catch(() => 'OK') !== 'OK') {
    const pending = (await getBookingQueue()).filter(c => c.status === 'pending')
    return { ok: true, skipped: 'another check is running', found: 0, count: pending.length, pending }
  }
  try {
    return await ingestPass()
  } finally {
    await redis('DEL', INGEST_LOCK).catch(() => {})
  }
}

async function ingestPass() {
  {
    // A fortnight back is enough to catch up after a quiet week without trawling
    // the whole mailbox on every run.
    const messageIds = await searchMailbox('newer_than:14d -in:spam', { max: 60 })
    const existing = await getBookingQueue()

    let read = 0
    let skipped = 0
    let remaining = 0
    let unreadable = 0
    let echoes = 0
    let already = 0
    const queued = []
    // Filled lazily, once something with a date is actually found. Most runs
    // read nothing new and should not touch the calendar at all.
    let onCalendar = null
    let span = null
    const calendarFor = async date => {
      // Four weeks either side: theatre lists arrive well ahead, a case
      // already entered may sit anywhere in that span, and a case that has
      // moved may have moved by weeks. Re-read when a later candidate falls
      // outside what was read — the window used to be fixed by whichever
      // booking happened to come first, so a week's list starting on Monday
      // could not see the calendar past the Monday after next.
      if (!onCalendar || date < span.from || date > span.to) {
        const from = toDateStr(addCivilDays(parseDateStr(date), -28))
        const to = toDateStr(addCivilDays(parseDateStr(date), 28))
        span = { from: span && span.from < from ? span.from : from, to: span && span.to > to ? span.to : to }
        try {
          onCalendar = await bookingsOnCalendar(span.from, span.to)
        } catch {
          // A calendar that cannot be read is a reason to show the candidate,
          // not to hide it. Better a duplicate somebody can dismiss than a
          // booking nobody ever sees.
          onCalendar = []
        }
      }
      return onCalendar
    }

    // ── Faster, and nothing else changed ──
    // It used to take one message at a time: ask whether it had been seen,
    // download it whole, and only then find it was a newsletter. Now the
    // seen-checks run together, the sender is read from one header, and only
    // booking emails are downloaded — several at once. What happens to each
    // booking afterwards is exactly as before, in the same order.
    const records = await Promise.all(messageIds.map(id => bookingEmailRecord(id).catch(() => null)))
    // Unseen, or seen before cover requests were read and nothing came of it —
    // those are looked at once more (see asksForCover). Anything that produced
    // a booking, or is mid-retry, is settled as it was.
    const recheck = r => r && !r.failed && !r.rule && !r.count
    const unseen = messageIds.filter((_, i) => !records[i] || records[i].failed || recheck(records[i]))
    const wasSeen = new Set(messageIds.filter((_, i) => recheck(records[i])))
    const heads = await inBatches(unseen, 8, id => headersOf(id).catch(() => ({ from: '', subject: '', snippet: '' })))

    const toRead = []
    for (let i = 0; i < unseen.length; i++) {
      const { from: rawFrom, subject, snippet } = heads[i]
      const from = addressOf(rawFrom)
      let source = sourceOf(from)
      if (isDistributorEmail(from)) {
        if (asksForCover(subject, snippet)) {
          source = DISTRIBUTOR_REQUEST
        } else {
          echoes += 1
          await markBookingEmailSeen(unseen[i], 0, { echo: true })
          continue
        }
      }
      if (!source) {
        if (!wasSeen.has(unseen[i])) skipped += 1
        await markBookingEmailSeen(unseen[i], 0)
        continue
      }
      // Read once already, from a booking source, and nothing in it: only the
      // record is brought up to date — it is not read a second time.
      if (wasSeen.has(unseen[i]) && source !== DISTRIBUTOR_REQUEST) {
        await markBookingEmailSeen(unseen[i], 0)
        continue
      }
      if (toRead.length >= PER_RUN) { remaining += 1; continue }
      toRead.push({ messageId: unseen[i], source })
    }

    const readings = await inBatches(toRead, READ_AT_ONCE, async ({ messageId, source }) => {
      try {
        const email = await readMessage(messageId)
        let found = []
        if (source.id === 'rhh') found = parseTheatreList(email)
        if (!found.length) found = await readBookingDocument(email)
        return { messageId, source, email, found }
      } catch (err) {
        return { messageId, source, error: err }
      }
    })

    for (const reading of readings) {
      const { messageId, source } = reading
      if (reading.error) {
        unreadable += 1
        await markBookingEmailFailed(messageId, reading.error.message)
        continue
      }
      read += 1
      const { email, found } = reading
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
          from: addressOf(email.from),
          receivedAt: email.receivedAt,
          sources: [source.id],
          createdAt: new Date().toISOString(),
          // What the reader actually worked from.
          //
          // Without this there is no way to tell a misreading from a badly
          // written email. A booking came back naming a system we do not carry
          // and nobody could say whether the surgeon had written it or the
          // model had invented it — the email was in a mailbox only the app can
          // see, and the app had thrown the text away.
          //
          // Identifiers stripped, like everything else that is stored, and
          // capped: this is for checking a reading, not for keeping a copy of
          // the correspondence.
          excerpt: stripIdentifiers(String(email.text || '')).slice(0, 900),
          // A booking that came in as a photograph or a PDF has little or no
          // text, and "the email said nothing" should not read as a fault.
          attachments: (email.attachments || []).map(a => a.filename).filter(Boolean)
        }

        // Already on the calendar. This is the ordinary case, not the rare one:
        // the team enters bookings as they hear about them, and the email
        // confirming a case usually arrives after somebody has already put it
        // in. Offering it again is how the app would create the second booking.
        //
        // Kept rather than dropped, marked as already booked, so a run can say
        // what it saw and nothing disappears without trace.
        if (candidate.date) {
          // alreadyInCalendar, not isSameBooking.
          //
          // isSameBooking requires the surgeon to match exactly, which is
          // right for comparing two emails and wrong for comparing an email
          // to the calendar: the entry there has been through the team's own
          // hands, and an email that names no surgeon at all failed the test
          // outright. So this check existed and kept missing, and the case
          // was offered a second time — reported as the app wanting to book
          // cases twice.
          const onDays = (await calendarFor(candidate.date)).filter(c => !c.cancelled)
          const twinOnCalendar = alreadyInCalendar(candidate, onDays) || loanLogisticsTwin(candidate, onDays)
          if (twinOnCalendar) {
            already += 1
            await saveBookingCandidate({
              ...candidate,
              status: 'onCalendar',
              matchedEventId: twinOnCalendar.id,
              matchedSummary: twinOnCalendar.summary
            })
            continue
          }

          // Not on its own day, but on another one: the case has moved. Still
          // queued — a person confirms a move like anything else read out of
          // an email — but the card offers to move the existing entry rather
          // than add a second one beside it.
          const movedFrom = movedOnCalendar(
            candidate, (await calendarFor(candidate.date)).filter(c => !c.cancelled))
          if (movedFrom) {
            candidate.moves = { eventId: movedFrom.id, from: movedFrom.date, summary: movedFrom.summary }
          }
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

    const settled = await reconcileQueue(await getBookingQueue(), todayInHobart())
    const pending = (await getBookingQueue()).filter(c => c.status === 'pending')
    return {
      ok: true, read, skipped, remaining, unreadable, echoes, already,
      returned: settled.returned, nowBooked: settled.nowBooked,
      found: queued.length, count: pending.length, pending
    }
  }
}

// ─── Every booking email, checked against the calendar as it is now ──────────
// "I want the portal to scan the bookings email, and KNOW whether it needs to
// alert the user to the booking based on if it is already in the portal OR
// not." — Brent, 2 Nov 2026, after removing Allen from the calendar: the email
// was still in the mailbox and the inbox said nothing, because an email is
// read once and its booking was marked added at the time.
//
// Re-reading every email on every check would mean a model call per email per
// tap. The reading is already stored, so it is the *comparison* that is redone:
// each upcoming booking the app added, or matched to the calendar itself, is
// looked for again, and one that is no longer there comes back to be confirmed.
// The other way round too — a waiting booking somebody has since entered by
// hand is taken off the list.
//
// Left alone: anything a person dismissed ("Not a booking"), and anything a
// person marked "Already in the calendar" — they said so because the app could
// not find it, often a surname spelt differently, and re-checking would bring
// it back on every tap. A cancelled entry still counts as on the calendar: the
// portal knows about that case, struck through.
export async function reconcileQueue(queue, today, readCalendar = bookingsOnCalendar) {
  const out = { returned: 0, nowBooked: 0 }
  const upcoming = queue.filter(c => c.date && c.date >= today && (
    c.status === 'pending'
    || c.status === 'accepted'
    || (c.status === 'onCalendar' && !c.dismissedBy)))
  if (!upcoming.length) return out

  const dates = upcoming.map(c => c.date).sort()
  let events
  try {
    events = await readCalendar(toDateStr(addCivilDays(parseDateStr(dates[0]), -28)),
      toDateStr(addCivilDays(parseDateStr(dates[dates.length - 1]), 28)))
  } catch {
    // A calendar that cannot be read changes nothing either way.
    return out
  }
  const ids = new Set(events.map(e => e.id))
  const live = events.filter(e => !e.cancelled)

  for (const c of upcoming) {
    if (c.status === 'pending') {
      const twin = alreadyInCalendar(c, live) || loanLogisticsTwin(c, live)
      if (twin) {
        await updateBookingCandidate(c.id, { status: 'onCalendar', matchedEventId: twin.id, matchedSummary: twin.summary })
        out.nowBooked += 1
      }
      continue
    }
    const eventId = c.eventId || c.matchedEventId
    if ((eventId && ids.has(eventId)) || alreadyInCalendar(c, events)) continue
    const movedFrom = movedOnCalendar(c, live)
    await updateBookingCandidate(c.id, {
      status: 'pending',
      returned: { was: c.status, by: c.acceptedBy || null, at: new Date().toISOString() },
      eventId: null, matchedEventId: null,
      moves: movedFrom ? { eventId: movedFrom.id, from: movedFrom.date, summary: movedFrom.summary } : null
    })
    out.returned += 1
  }
  return out
}

/**
 * Moves an existing booking to another day, keeping its hours.
 *
 * One event, patched in place — never a second event and a deletion, which
 * would lose the booking's history, thread and attendance, and leave both if
 * the second step failed. The written date in the notes follows (see
 * withDateFollowing), the hospital and its location follow when given, and
 * both days are tidied.
 *
 * The result is checked against what was asked for, so "moved" is only ever
 * reported once Google says the event is on the new day.
 */
export async function moveBooking(eventId, day, { hospital, by, etag } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) {
    throw Object.assign(new Error('A date is needed to move the booking'), { status: 400 })
  }
  const current = await getCalendarEvent(eventId)
  const from = (current.start?.dateTime || current.start?.date || '').slice(0, 10)
  if (!current.start?.dateTime) {
    throw Object.assign(new Error('That booking is an all-day entry and cannot be moved from here'), { status: 400 })
  }
  const clock = iso => {
    const c = zonedCivil(new Date(iso), TZ)
    return `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}:00`
  }
  const patch = {
    start: { dateTime: `${day}T${clock(current.start.dateTime)}`, timeZone: TZ },
    end: { dateTime: `${day}T${clock(current.end?.dateTime || current.start.dateTime)}`, timeZone: TZ }
  }
  let description = withDateFollowing(current.description || '', day)
  const site = String(hospital || '').trim()
  if (site && site !== String(parseLabelledDescription(description).hospital || '').trim()) {
    description = setLabelledValue(description, 'hospital', site)
    patch.location = site
  }
  patch.description = withAttribution(description, by,
    { knownCreator: knownCreatorOf(current), today: hobartToday() })

  const saved = await updateCalendarEvent(eventId, patch, { etag: etag || current.etag })
  const to = (saved.start?.dateTime || saved.start?.date || '').slice(0, 10)
  if (to !== day) throw new Error(`The calendar did not take the new date (it says ${to || 'nothing'})`)

  for (const d of [...new Set([from, to].filter(Boolean))]) await tidyDay(d).catch(() => {})
  return { id: saved.id, from, to, summary: saved.summary || '', etag: saved.etag || null,
    beforeEvent: current, afterEvent: saved }
}

/** Accept: the candidate, as edited on screen, goes to the calendar. */
async function handleAccept(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let claim = null
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const id = String(body.id || '').trim()
    const candidate = await getBookingCandidate(id)
    if (!candidate) return res.status(404).json({ error: 'That booking is no longer in the queue' })
    if (candidate.status === 'accepted') {
      // Two taps on a slow connection must not make two bookings.
      return res.status(200).json({ ok: true, alreadyAccepted: true, candidate })
    }
    // The status check alone let two taps that arrive together both pass it
    // and both write a booking. The claim is what makes it once; it is let
    // go if the write fails, so Accept can be tried again.
    claim = `bookingcand:accepting:${id}`
    if (await redis('SET', claim, '1', 'NX', 'EX', '90') !== 'OK') {
      claim = null
      return res.status(409).json({ error: 'That booking is already being accepted — it will be on the calendar in a moment.', inProgress: true })
    }

    // A booking that has moved: the existing entry is moved, not copied.
    if (body.move && candidate.moves?.eventId) {
      const day = String(body.date || candidate.date || '')
      const result = await moveBooking(candidate.moves.eventId, day, {
        hospital: body.fields?.hospital ?? candidate.hospital,
        by: firstNameFor(session.email)
      })
      const accepted = await updateBookingCandidate(id, {
        status: 'accepted',
        acceptedBy: firstNameFor(session.email),
        acceptedAt: new Date().toISOString(),
        eventId: result.id,
        movedFrom: result.from
      })
      const notices = await prepareNotices({
        kind: 'moved', beforeEvent: result.beforeEvent, afterEvent: result.afterEvent, eventId: result.id, session
      })
      return res.status(200).json({
        ok: true, moved: true, from: result.from, to: result.to, candidate: accepted,
        event: { id: result.id, summary: result.summary, etag: result.etag },
        ...notices
      })
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
      colorId: body.colorId,
      // "BLabs no F2F required" on the list → "(No F2F)" in the title, as if
      // it had been entered with the buttons. See brainlabFromKit.
      attendance: body.attendance ?? candidate.attendance
    }, firstNameFor(session.email), { source: 'email' })

    const accepted = await updateBookingCandidate(id, {
      status: 'accepted',
      acceptedBy: firstNameFor(session.email),
      acceptedAt: new Date().toISOString(),
      eventId: created.id
    })

    const notices = await prepareNotices({ kind: 'new', afterEvent: created, eventId: created.id, session })
    return res.status(200).json({
      ok: true,
      candidate: accepted,
      event: { id: created.id, summary: created.summary || '', etag: created.etag || null },
      ...notices
    })
  } catch (err) {
    if (claim) await redis('DEL', claim).catch(() => {})
    return res.status(err.status || 500).json({ error: err.message })
  }
}

/** Dismiss: not a case, already on the calendar, or cancelled before it started. */
/**
 * Taking a candidate off the queue.
 *
 * Two different answers, kept apart because they mean opposite things about
 * the case. "Not a booking" says this email was never a case — a reply, a
 * circular, a misread. "Already booked" says the case is perfectly real and
 * we have it; the app simply read the confirmation after somebody had entered
 * it by hand.
 *
 * Recording them the same way would have lost the distinction that matters:
 * dismissing a real case reads as "this is not happening", which is the wrong
 * thing for the next person to find when they go looking for why a tray was
 * not packed.
 */
async function handleDismiss(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const id = String(body.id || '').trim()
    const alreadyBooked = body.reason === 'onCalendar'
    const dismissed = await updateBookingCandidate(id, {
      status: alreadyBooked ? 'onCalendar' : 'dismissed',
      dismissedBy: firstNameFor(session.email),
      dismissedAt: new Date().toISOString(),
      reason: String(body.reason || '').trim() || null
    })
    return res.status(200).json({ ok: true, candidate: dismissed })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}


/**
 * A booking dictated out loud, turned into fields for the form.
 *
 * Deliberately does not create anything. Speech recognition is good at English
 * and bad at surnames — "Petrusma", "Ibbett" and "Bewg" are in no language
 * model — so what comes back is a filled form for a person to glance at, along
 * with the raw transcript so a misheard word is visible rather than buried in a
 * field that looks confidently correct.
 */
/**
 * A spoken command, read and routed.
 *
 * Returns what was heard and what it would do. Nothing is written here — every
 * one of the four things this can turn into has its own action, already behind
 * its own checks, and the app calls that one after a person has read the two
 * lines on screen and tapped.
 */
async function handleVoice(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const result = await readVoiceCommand({
      audio: body.audio,
      contentType: body.contentType
    })
    return res.status(200).json({ ok: true, ...result })
  } catch (err) {
    // Written to be read by somebody holding a phone, so it goes through as it
    // is rather than becoming "something went wrong".
    return res.status(400).json({ error: err.message })
  }
}

async function handleDictate(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const result = await readDictatedBooking({
      audio: body.audio,
      contentType: body.contentType
    })
    return res.status(200).json({ ok: true, ...result })
  } catch (err) {
    // The message is written to be read by somebody holding a phone, so it goes
    // through as it is rather than becoming "something went wrong".
    return res.status(400).json({ error: err.message })
  }
}


/**
 * The running order of each theatre list on a day.
 *
 * GET returns everything recorded for that date; POST records one theatre's.
 * Stored apart from the bookings because the order includes cases that are not
 * ours and never reach the calendar — tomorrow's list at RHH opens with an ACDF
 * using a competitor's cage, and that case is the whole reason our first one is
 * not at eight.
 */
/**
 * Sets the day's running order.
 *
 * The hospital rings the afternoon before with the order the list will run in —
 * ours first up, or third after a craniotomy — and that order is the single most
 * useful thing anybody learns about tomorrow: it decides who is on site at 07:30
 * and who has a morning.
 *
 * It used to be posted to the WhatsApp group and read off a phone. Here it is
 * the order the cases sit in, and setting it moves the calendar to match, so the
 * order is visible to everyone in the thing they already have open.
 *
 * The body is a list of event ids, first to last. Nothing else — the order is
 * the whole fact, and the calendar already holds the cases.
 */
async function handleReorder(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const date = String(req.query.date || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'A date is needed' })
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const order = Array.isArray(body.order)
    ? body.order.slice(0, 60).map(id => String(id || '').trim()).filter(Boolean)
    : []
  if (!order.length) return res.status(400).json({ error: 'An order is needed' })

  try {
    // Nothing is stored here. The calendar is the record — the order a case
    // sits in is its start time, and there is no second copy to disagree with
    // it the next time somebody moves a booking in Google directly.
    const { moved } = await tidyDay(date, order)
    return res.status(200).json({ ok: true, moved })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

/**
 * Records where a case sits on the hospital's running order.
 *
 * The one fact the team leader collects every afternoon and could not put
 * anywhere: which number we are on that hospital's list, whether it is the
 * morning or the afternoon list, when we are wanted, and what is ahead of us.
 *
 * Note the difference from reordering. Moving cases past each other can only
 * say where ours sit relative to each other, and most days we have one case at
 * a hospital — Pennant is second up on JPW's Thursday list behind a PLIF using
 * KT Medical kit we are not at, and there is nothing to move him past. The
 * number is the fact; the order is a consequence of it.
 *
 * Written onto the booking, not into a store beside it, so it reads the same in
 * Google Calendar as it does in the app and there is no second copy to drift.
 */
async function handleListPlace(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const eventId = String(body.eventId || '').trim()
    if (!eventId) return res.status(400).json({ error: 'eventId is required' })

    // Null clears it. A running order taken down wrongly at four o'clock is
    // corrected at half past, and leaving no way back would mean the app kept
    // insisting on something the team knows is wrong.
    const place = body.place === null ? null : cleanListPlace(body.place || {})

    const current = await getCalendarEvent(eventId)
    // Through stripIdentifiers, because "what is ahead of us" is free prose and
    // free prose is exactly where somebody types a patient's full name.
    const safe = place && {
      ...place,
      from: stripIdentifiers(place.from),
      ahead: stripIdentifiers(place.ahead)
    }

    const saved = await updateCalendarEvent(eventId, {
      description: withListPlace(current.description || '', safe)
    }, { etag: body.etag })

    // The day re-packs around it: morning before afternoon, then by number.
    const day = (current.start?.dateTime || current.start?.date || '').slice(0, 10)
    if (day) await tidyDay(day).catch(() => {})

    return res.status(200).json({
      ok: true,
      place: safe,
      event: { id: saved.id, etag: saved.etag || null }
    })
  } catch (err) {
    if (err.code === 'conflict') {
      return res.status(409).json({ error: err.message, code: 'conflict' })
    }
    return res.status(500).json({ error: err.message })
  }
}

/**
 * Who is team leader, and setting it.
 *
 * Anybody on the team can change it. Not admin-only on purpose: the person who
 * knows the rota has changed is usually the person it changed to, and making
 * them ask somebody else is how a rota goes stale — which is exactly what
 * happened to the calendar entry this replaces.
 *
 * Stored against the week's Monday, so a week has one answer however the
 * question is asked, and last week's leader is still there afterwards.
 */
async function handleTeamLeader(req, res) {
  const session = await requireSession(req, res)
  if (!session) return

  try {
    // Any day in the calendar week being looked at.
    const asked = String(req.query.week || '').slice(0, 10)
    const monday = weekOf(asked) || weekOf(todayInHobart())
    if (!monday) return res.status(400).json({ error: 'A week is needed' })

    // Monday to Friday of that week: the days a leader is on.
    const weekdays = [0, 1, 2, 3, 4].map(n => addDaysTo(monday, n))

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      // One day only: an entry for that day, or cleared back to the turn's.
      const day = String(req.query.day || body.day || '').slice(0, 10)
      if (day) {
        if (!weekdays.includes(day)) return res.status(400).json({ error: 'That day is not a weekday in this week' })
        if (!body.email) { await setDayLeader(day, null); return res.status(200).json({ ok: true, day, leader: null }) }
        const entry = cleanLeader({ email: body.email, setBy: session.email })
        if (!entry) return res.status(400).json({ error: 'That is not somebody on the team' })
        await setDayLeader(day, entry)
        return res.status(200).json({ ok: true, day, leader: entry })
      }
      // A whole turn — Friday to Thursday — the one `from` falls in (the day
      // whose chip was tapped), else the one Monday of this week falls in.
      const turn = turnOf(String(body.from || '').slice(0, 10)) || turnOf(monday)
      if (!body.email) {
        // Back to whosever turn it is. Clearing a cover means the rota resumes.
        await setTeamLeaderFor(turn, null)
        const back = await turnLeader(turn)
        return res.status(200).json({ ok: true, turn, leader: back })
      }
      const entry = cleanLeader({ email: body.email, setBy: session.email })
      if (!entry) return res.status(400).json({ error: 'That is not somebody on the team' })
      await setTeamLeaderFor(turn, entry)
      return res.status(200).json({ ok: true, turn, leader: entry })
    }

    // Every weekday's leader, worked out on its own: a Monday-to-Friday week
    // spans two turns, the Friday starting the next one (Brent, 5 Nov 2026).
    const byDay = await leadersOn(weekdays)
    const days = Object.fromEntries(Object.entries(byDay).filter(([, l]) => l?.source === 'day'))
    const first = byDay[monday]?.turnLeader || null
    return res.status(200).json({
      ok: true,
      week: monday,
      byDay,
      // Days somebody changed, by date.
      days,
      // Monday's turn, for anything that asks about "the week".
      leader: first,
      source: first?.source || 'none',
      rostered: first?.rostered || null
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

/** Today in Hobart, whatever zone the server thinks it is in. */
function todayInHobart() {
  // Through the zone database, not a fixed +10: in daylight saving that was
  // an hour out, and just after midnight it named yesterday.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Hobart' }).format(new Date())
}

/**
 * Calls a case off, or puts it back on.
 *
 * Not a delete. A cancelled case is a fact the team needs — it was booked, kit
 * was moved for it, somebody may already be driving — and a booking that simply
 * vanishes leaves nobody any way to find out what happened. So the record stays
 * and says plainly that it is off.
 *
 * Marked the way it has always been marked by hand: CANCELLED at the front of
 * the title. Every reader of that calendar already knows what it means, and the
 * app has read it that way since before it could write it.
 */
async function handleCancel(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const eventId = String(body.eventId || '').trim()
    if (!eventId) return res.status(400).json({ error: 'eventId is required' })
    // `off: false` reinstates. A case coming back on is ordinary — a theatre
    // list is rearranged twice before eight in the morning.
    const off = body.off !== false

    const current = await getCalendarEvent(eventId)
    const summary = String(current.summary || '')
    const who = firstNameFor(session.email)
    const day = (current.start?.dateTime || current.start?.date || '').slice(0, 10)

    // The reason, where somebody gave one. It is the first thing anybody asks.
    const reason = stripIdentifiers(String(body.reason || '')).trim().slice(0, 200)
    const note = off
      ? `Cancelled by ${who}${reason ? ` — ${reason}` : ''}`
      : `Reinstated by ${who}`

    const description = `${stripCalledOffNote(current.description || '')}\n\n${note}`.trim()

    const patch = {
      summary: off ? markCancelled(summary) : stripCancellation(summary),
      description,
      // Grey while it is off, so it reads as called off at a glance in Google
      // as well as in the app. Put back to the surgeon's colour on reinstating,
      // which is where every other save gets it from.
      colorId: off
        ? '8'
        : (guideColorIdFor(normaliseSurgeon(readBooking(summary, description)?.surgeon || '') || '') || null)
    }

    const saved = await updateCalendarEvent(eventId, patch, { etag: body.etag })
    // The day closes up around it, and reopens when it comes back.
    if (day) await tidyDay(day).catch(() => {})

    // Called off is a cancellation to a supplier; put back on is the booking
    // again, so it goes as new.
    const notices = await prepareNotices({
      kind: off ? 'cancelled' : 'new', beforeEvent: current, afterEvent: saved, eventId, session
    })

    return res.status(200).json({
      ok: true,
      cancelled: off,
      event: { id: saved.id, summary: saved.summary || '', etag: saved.etag || null },
      ...notices
    })
  } catch (err) {
    if (err.code === 'conflict') {
      return res.status(409).json({ error: err.message, code: 'conflict' })
    }
    return res.status(500).json({ error: err.message })
  }
}

/** Takes off a previous cancelled/reinstated line, so they do not stack up. */
function stripCalledOffNote(description) {
  return String(description || '')
    .replace(/^\s*(?:Cancelled|Reinstated) by [^\n]*$/gmi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}


/**
 * Earlier cases filed under a surname.
 *
 * Asked when a booking says revision, removal, existing or in situ. The team
 * has to know what is in there before the day — the wrong screwdriver is in
 * another hospital — and the answer has been sitting in the usage tree all
 * along.
 *
 * Matched on surname alone, because a surname is all this app keeps. So what
 * comes back is described as records found, never as what this patient has.
 */
async function handlePrior(req, res) {
  const session = await requireSession(req, res)
  if (!session) return

  const patient = stripIdentifiers(String(req.query.patient || '')).trim().split(/\s+/)[0]
  const surgeon = String(req.query.surgeon || '').trim()
  if (!patient) return res.status(400).json({ error: 'A surname is needed' })

  try {
    if (!dropboxConfigured()) {
      return res.status(200).json({ ok: true, matches: [], unavailable: 'Dropbox is not connected' })
    }
    const found = await searchUsage(patient)
    const filed = found.map(f => readFiledCase(f.name, f.path)).filter(Boolean)
    const matches = priorImplantsFor(filed, patient, surgeon)

    res.setHeader('Cache-Control', 'private, max-age=300')
    return res.status(200).json({
      ok: true,
      matches,
      summary: describePrior(matches, surgeon)
    })
  } catch (err) {
    // A history that cannot be read must not stop anybody opening a booking.
    return res.status(200).json({ ok: true, matches: [], unavailable: err.message })
  }
}


// ─── Searching every booking ──────────────────────────────────────────────────
// "The search for patients who are booked or who have been booked needs to be
// somewhere on the cases page, similar to how Google Calendar has a search
// glass at the top."
//
// Google's own full-text search does the finding, over every booking from
// 2020 to a year ahead, so nothing is copied out of the calendar to be
// searched. Each hit is then read through readBooking, the same reader every
// other screen uses, so a result says exactly what its card says — a surname,
// never a first name, even when the first name in the notes is what matched.
//
// Only cases come back. Leave, meetings and reminders mention surgeons too,
// and a list of those under a patient search is noise.

export const SEARCH_FROM = '2020-01-01'
const SEARCH_MAX = 60

/** Whether a read case answers the query, on the fields the card shows. */
export function caseMatches(read, query) {
  const want = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!want.length || !read) return false
  const hay = [read.patient, read.surgeon, read.operation, read.system, read.kit, read.hospital]
    .filter(Boolean).join(' ').toLowerCase()
  return want.every(word => hay.includes(word))
}

async function handleSearch(req, res) {
  const session = await requireSession(req, res)
  if (!session) return

  const query = String(req.query.q || '').trim().slice(0, 60)
  if (query.length < 2) return res.status(200).json({ ok: true, results: [] })

  try {
    const token = await getGoogleToken(CALENDAR_SCOPE_READONLY)
    const until = toDateStr(addCivilDays(parseDateStr(hobartToday()), 366))
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(getCalendarId())}/events`
      + `?q=${encodeURIComponent(query)}`
      + `&timeMin=${encodeURIComponent(`${SEARCH_FROM}T00:00:00+11:00`)}`
      + `&timeMax=${encodeURIComponent(`${until}T23:59:59+10:00`)}`
      + '&singleEvents=true&orderBy=startTime&maxResults=2500'
      + `&timeZone=${encodeURIComponent(QUERY_TZ)}`
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const data = await r.json()
    if (data.error) throw new Error(data.error.message)

    // "Please add a search function to the portal, to find both cases and
    // tasks." — Toni, 19 Oct 2026. Tasks on the calendar ("TASK: Get Athlet
    // back from RHH", all-day) and on the Projects board are found as well,
    // marked as tasks so the screen can show and open them as tasks.
    const needle = query.toLowerCase()
    const tasks = (data.items || [])
      .map(e => {
        const task = readTask(e.summary || '', e.description || '')
        if (!task) return null
        const words = [task.what, task.thing, task.who, task.note, task.from, task.to].filter(Boolean).join(' ').toLowerCase()
        if (!words.includes(needle)) return null
        return { ...task, type: 'task', id: e.id, date: String(e.start?.date || e.start?.dateTime || '').slice(0, 10) }
      })
      .filter(Boolean)
    let projectItems = []
    try {
      const { items } = await getWorklist()
      projectItems = items
        .filter(it => [it.task, it.notes, it.assignee].filter(Boolean).join(' ').toLowerCase().includes(needle))
        .map(it => ({
          type: 'project', id: it.id, what: it.task, who: it.assignee !== 'Unassigned' ? it.assignee : null,
          done: it.status === 'done', date: String(it.due_date || it.createdAt || '').slice(0, 10)
        }))
    } catch { /* the board unreadable is no reason to lose the case results */ }

    const results = (data.items || [])
      .filter(e => e.start?.dateTime)
      .filter(e => !isDistributorEmail(e.organizer?.email))
      .filter(e => !isTask(e.summary || ''))
      .map(e => {
        const read = readBooking(e.summary || '', e.description || '', { knownPatient: knownPatientOf(e) })
        if (!read || (!read.patient && !read.awaitingName)) return null
        // Google matched somewhere in the event — often the notes. Kept only
        // where the match is in what the card shows, or the patient's own
        // line, so a search for a surgeon does not return every booking
        // whose notes mention them in passing.
        const labelledPatient = parseLabelledDescription(e.description || '').patient || ''
        if (!caseMatches(read, query)
          && !String(labelledPatient).toLowerCase().includes(query.toLowerCase())) return null
        return {
          id: e.id,
          date: e.start.dateTime.slice(0, 10),
          patient: read.patient || '',
          surgeon: read.surgeon || '',
          operation: read.operation || '',
          system: read.system || '',
          hospital: read.hospital || '',
          cancelled: isCancelled(e.summary || '', e.description || '')
        }
      })
      .filter(Boolean)
      // Newest first: the case somebody is looking for is usually the latest.
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

    const all = [...results.map(r => ({ type: 'case', ...r })), ...tasks, ...projectItems]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    return res.status(200).json({
      ok: true,
      results: all.slice(0, SEARCH_MAX),
      more: all.length > SEARCH_MAX
    })
  } catch (err) {
    console.error('calendar/search failed:', err.message)
    return res.status(500).json({ error: 'Search is unavailable right now. Try again in a moment.' })
  }
}


/**
 * The rest of the portal for the search glass (api/_portalSearch.js): usage,
 * resupplies, kits, tray lists, preference cards, the Inbox. Each source is
 * read on its own and a failure loses only that group.
 */
async function handleFind(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  const q = String(req.query.q || '').trim().slice(0, 60)
  if (q.length < 2) return res.status(200).json({ ok: true, groups: [] })
  const safe = (p, fallback) => p.catch(err => { console.error('find source failed:', err.message); return fallback })
  const [usage, resupplies, kits, prefs, inbox] = await Promise.all([
    safe(getUsageHistory(400), []),
    safe(getRecentResupplies(200), []),
    safe(listKits(), []),
    safe(getPreferences().then(p => p.data), null),
    safe(getBookingQueue(), [])
  ])
  let trayLists = {}
  if (kits.length) {
    const raws = await safe(redis('mget', ...kits.map(k => `kits:list:${k.id}`)), [])
    kits.forEach((k, i) => { try { if (raws[i]) trayLists[k.id] = JSON.parse(raws[i]) } catch { /* skip */ } })
  }
  const groups = searchPortal(q, { usage, resupplies, kits, trayLists, prefs, inbox })
  const said = await safe(searchChat(q, { limit: 9 }), [])
  if (said.length) {
    groups.push({
      key: 'chat', label: 'Messages', more: said.length > 8,
      items: said.slice(0, 8).map(m => ({
        type: 'chat', id: m.id, channel: m.channel, date: String(m.at || '').slice(0, 10),
        title: `${m.authorName}: ${m.text || (m.files || []).map(f => f.name).join(', ') || 'Photo'}`.slice(0, 140),
        detail: m.channel.startsWith('case:') ? 'Case thread' : `# ${m.channel}`
      }))
    })
  }
  return res.status(200).json({ ok: true, groups })
}


// ─── Supplier notices (Tasks 8 and 9) ─────────────────────────────────────────
// Worked out after every booking change and handed back to the screen to
// confirm, unless a rule has been set to send on its own. Never allowed to
// cost the change itself: a notice that cannot be prepared is reported, and
// the booking stands.

function staffSender(session) {
  const staff = STAFF_BY_EMAIL(session.email)
  return { name: staff?.name || session.name || '', email: staff?.email || session.email }
}

async function prepareNotices({ kind, beforeEvent, afterEvent, eventId, session }) {
  try {
    const settings = await getNoticeSettings()
    const before = beforeEvent ? describeBooking(beforeEvent) : null
    const after = afterEvent ? describeBooking(afterEvent) : null
    const sentLoans = await loanStateFor(eventId, [
      ...(settings.loanRequests || []).map(l => l.distributor),
      ...(settings.hospitalLoanNotices || DEFAULT_HOSPITAL_LOAN_NOTICES).map(h => `hosp-${h.hospital}`)
    ])
    const notices = [
      ...noticesFor({ kind, eventId, settings, before, after }),
      // Task 8: a request for a loan set, a change to one, or calling it off.
      ...loanRequestsFor({ kind, eventId, settings, before, after, sent: sentLoans }),
      // And the hospital's loans team, told the set is coming.
      ...hospitalLoanNoticesFor({ kind, eventId, settings, before, after, sent: sentLoans })
    ]
    const previews = []
    const sent = []
    const failed = []
    for (const notice of notices) {
      if (notice.autoSend) {
        try {
          await sendBookingNotice({ ...notice, sender: staffSender(session), caseId: eventId })
          await recordLoanRequest(notice, firstNameFor(session.email)).catch(() => {})
          sent.push(notice.name)
        } catch (err) {
          failed.push({ name: notice.name, error: err.message })
        }
      } else {
        previews.push(previewOf(notice, await holdNotice(notice)))
      }
    }
    return { notices: previews, noticesSent: sent, noticesFailed: failed }
  } catch (err) {
    console.error('notices: could not prepare', err.message)
    return { notices: [], noticeError: 'Supplier notices could not be prepared for this change.' }
  }
}

/** Sends notices a person has looked at and confirmed. */
async function handleNotify(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const results = []
  for (const id of (body.ids || []).slice(0, 10)) {
    const notice = await takeNotice(id)
    if (!notice) { results.push({ id, ok: false, error: 'This notice has expired or was already sent' }); continue }
    // "Ideally be able to edit them if needed." The wording and subject can be
    // changed; who it goes to cannot — that stays as the server wrote it, so
    // an edit can never turn a notice into an email to somebody else.
    const original = { ...notice }
    const edit = body.edits?.[id]
    if (edit && (typeof edit.text === 'string' || typeof edit.subject === 'string')) {
      const textBody = typeof edit.text === 'string' ? edit.text.slice(0, 8000) : notice.text
      notice.text = textBody
      notice.subject = typeof edit.subject === 'string' && edit.subject.trim() ? edit.subject.trim().slice(0, 300) : notice.subject
      notice.html = `<div style="font-family:-apple-system,sans-serif;font-size:14px;color:#042746">${
        escapeHtml(textBody).replace(/\n/g, '<br>')}</div>`
    }
    try {
      await sendBookingNotice({ ...notice, sender: staffSender(session), caseId: notice.eventId })
      // A loan request is remembered once it has gone, so a later move or
      // cancellation follows it up and a second save does not ask again.
      await recordLoanRequest(notice, firstNameFor(session.email)).catch(() => {})
      results.push({ id, ok: true, name: notice.name })
    } catch (err) {
      await restoreNotice(id, original).catch(() => {})
      results.push({ id, ok: false, name: notice.name, error: err.message || 'Email not sent' })
    }
  }
  return res.status(200).json({ ok: results.every(r => r.ok), results })
}

/** Admin → Notices: the contacts and the rules. */
async function handleNoticeSettings(req, res) {
  const admin = await requireAdmin(req, res)
  if (!admin) return
  if (req.method === 'GET') return res.status(200).json(await getNoticeSettings())
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    return res.status(200).json(await saveNoticeSettings(body))
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
}


/**
 * "No usage for this case" (Task 11). Clears the 6pm reminder and the next
 * morning's note to the team leader. Kept in Redis, not on the booking: it is
 * a fact about our paperwork, not about the case.
 */
async function handleNoUsage(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const eventId = String(body.eventId || '').trim()
  if (!eventId) return res.status(400).json({ error: 'eventId is required' })
  await markNoUsage(eventId, firstNameFor(session.email) || session.email, body.on !== false)
  return res.status(200).json({ ok: true, noUsage: body.on !== false })
}
