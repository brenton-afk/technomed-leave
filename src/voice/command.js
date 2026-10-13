import { TASK_KINDS, TASK_PLACES, taskThings, taskSummary } from '../clinicalPlan/tasks.js'
import { SESSIONS } from '../clinicalPlan/listPlace.js'
import { STAFF } from '../staffConfig.js'
import { SURGEON_COLOUR_NAMES } from '../clinicalPlan/colours.js'
import { INVENTORY } from '../clinicalPlan/inventory.js'

const SESSION_IDS = SESSIONS.map(s => s.id)

// ─── "Hey TM Portal…" ────────────────────────────────────────────────────────
// "I want a voice option to be able to add/amend list orders or add a reminder
// to the portal. Like a speak function that says 'Hey TM Portal, I want to add
// a booking', or 'Hey TM portal, I want to add a reminder', 'Hey TM portal I
// want to update the list order for tomorrow'."
//
// ── Why it is a button and not a wake word ──
//
// A real wake word needs the microphone open all the time. A web app cannot do
// that: iOS will not let a PWA hold the mic in the background at all, it would
// flatten the battery if it could, and a permanently live microphone in an RHH
// corridor is a clinical privacy problem nobody asked for. So the phrase is
// accepted and ignored — you tap once and say the whole sentence, wake word and
// all, because that is how people will say it and an app that argued about the
// first three words would be worse than one that listened to them.
//
// ── Why it never acts on what it heard ──
//
// Speech recognition is good at English and bad at surnames. "Petrusma",
// "Ibbett" and "Bewg" are not in anyone's language model. Every command shows
// what was heard beside what it will do, and nothing happens until somebody
// taps. Brent chose this for all four commands, including the two that are
// cheap to undo, and it is the right call: the expensive failure is not a wrong
// reminder, it is a wrong name on a booking.

/**
 * The openings people will actually use.
 *
 * Matched loosely because this is what a transcript does to them: "Hey TM
 * portal" comes back as "Hey team portal", "Hey, TM Portal" and "Hey tm portal"
 * depending on how it was said and how much noise was in the corridor.
 */
const WAKE = /^\s*(?:hey|hi|ok(?:ay)?)[,\s]+(?:t\.?\s?m\.?|team|tm)\s*portal[,.\s]*/i

/** And the "I want to…" that follows it. */
const PREAMBLE = /^\s*(?:i\s+(?:want|need|would like)\s+to|please|can you|could you)\s+/i

/**
 * The command, with the ceremony taken off the front.
 *
 * Only for display — the model is given the whole transcript, because "add a
 * reminder" after the wake word and "add a reminder" with nothing in front of
 * it are the same instruction and stripping is one more thing to get wrong.
 */
export function stripWake(transcript) {
  let out = String(transcript || '').trim()
  out = out.replace(WAKE, '')
  out = out.replace(PREAMBLE, '')
  return out.trim()
}

/** Whether somebody said the magic words, which is worth knowing for the copy. */
export function hasWakeWord(transcript) {
  return WAKE.test(String(transcript || ''))
}

/** What a command can be. */
export const INTENTS = ['booking', 'reminder', 'listOrder', 'todo', 'unclear']

/**
 * The instruction given to the model.
 *
 * Written to make the model choose rather than guess: the four things this app
 * can do are described by what they are for, and "unclear" is offered as a
 * first-class answer. A router with no way to say "I did not follow that" puts
 * every mumble into whichever branch is nearest, which is how a cough becomes a
 * booking.
 */
export function commandPrompt(transcript, { today, weekday, staff = STAFF } = {}) {
  const kinds = TASK_KINDS.map(k => `  · ${k.key} — ${k.label}`).join('\n')
  const names = staff.map(s => s.name).join(', ')

  return `You are the router for a surgical implant distributor's staff portal.
Somebody has spoken a command into it. Decide which of four things they want,
and pull out the details.

Today is ${weekday} ${today} in Hobart.

WHAT THEY SAID:
"""
${transcript}
"""

They may open with "Hey TM Portal" or "I want to". Ignore that — it is how the
app is woken, not part of the instruction.

THE FOUR THINGS, and how to tell them apart:

"booking" — a surgical case going in the calendar. There will be a patient
surname, a surgeon, usually a hospital, a date and an operation. "Cooper,
Ibbett, RHH, Friday, L4/5 PLIF, Diplomat."

"reminder" — a job attached to a particular day that somebody has to physically
do: move a kit, get a tray back, restock something. It belongs on the day in the
calendar where the whole team sees it. Kinds:
${kinds}
Places are things like: ${TASK_PLACES.slice(0, 8).join(', ')}.
Things are kits and systems, e.g.: ${taskThings().slice(0, 10).join(', ')}.

"listOrder" — where one of our cases sits on a hospital's theatre list. "We're
second at Calvary tomorrow, after a craniotomy." "Put Ibbett's case first up."
Fields: date, a hint about which case (surgeon surname and/or patient surname),
position (a number), session ("morning" or "afternoon"), from (a start time like
"1.30pm"), ahead (prose about what is in front of us).

"todo" — a piece of office work with no day attached to it, for somebody's task
list. "Chase the Globus paperwork." "Remind Toni to book the in-service."
Assignee must be one of: ${names}. Use null if no one was named.

"unclear" — you could not tell, or there is not enough to act on. Use this
freely. A wrong guess costs more than asking again.

REPLY WITH JSON ONLY, no fences, no commentary:

{
  "intent": "booking" | "reminder" | "listOrder" | "todo" | "unclear",
  "confidence": "high" | "low",
  "why": "one short sentence a person can read, saying what you took it to mean",
  "reminder": { "kind": "...", "thing": "...", "from": "...", "to": "...", "note": "...", "date": "YYYY-MM-DD" },
  "listOrder": { "date": "YYYY-MM-DD", "surgeon": "...", "patient": "...", "position": 2, "session": "morning"|"afternoon", "from": "...", "ahead": "..." },
  "todo": { "task": "...", "assignee": "...", "due_date": "YYYY-MM-DD", "priority": "urgent"|"normal"|"low" }
}

Include only the object for the intent you chose. Leave out any field you did
not actually hear — do not invent a date, a kit or a name. "Tomorrow" and
"Friday" resolve against today's date above.

If the intent is "booking", return just the intent and confidence; the booking
reader handles the rest.`
}

const str = (v, max) => String(v ?? '').trim().slice(0, max)

/**
 * The routing, made safe to act on.
 *
 * Everything is checked against what this app actually has — the task kinds,
 * the session ids, the staff list — rather than trusted. A model that invents a
 * kind called "collect" produces a task the calendar cannot draw, and the place
 * to find that out is here, not on somebody's Tuesday.
 */
export function readCommand(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : (raw || {})
  const intent = INTENTS.includes(data.intent) ? data.intent : 'unclear'
  const out = {
    intent,
    confidence: data.confidence === 'high' ? 'high' : 'low',
    why: str(data.why, 200)
  }

  if (intent === 'reminder') {
    const given = data.reminder || {}
    const kind = TASK_KINDS.find(k => k.key === given.kind)
    if (!kind) return { ...out, intent: 'unclear', why: out.why || 'Could not tell what kind of task that is.' }
    out.reminder = {
      kind: kind.key,
      thing: str(given.thing, 120),
      from: str(given.from, 40),
      to: str(given.to, 40),
      note: str(given.note, 200),
      date: isDate(given.date) ? given.date : ''
    }
    // A task the calendar could not draw a line for is not a task. Checked
    // against the kind's own needsThing rather than against the rendered
    // phrase: "Get  back" is a non-empty string and a meaningless task.
    if (kind.needsThing && !out.reminder.thing) {
      return { ...out, intent: 'unclear', why: 'Could not tell what the task was about.' }
    }
    if (!taskSummary(out.reminder)?.replace(/^TASK:\s*/, '').trim()) {
      return { ...out, intent: 'unclear', why: 'Could not tell what the task was.' }
    }
    if (!out.reminder.date) {
      return { ...out, intent: 'unclear', why: 'Could not tell which day that is for.' }
    }
  }

  if (intent === 'listOrder') {
    const given = data.listOrder || {}
    const position = Number(given.position)
    out.listOrder = {
      date: isDate(given.date) ? given.date : '',
      surgeon: str(given.surgeon, 40),
      patient: str(given.patient, 40),
      position: Number.isInteger(position) && position >= 1 && position <= 40 ? position : null,
      session: SESSION_IDS.includes(given.session) ? given.session : null,
      from: str(given.from, 20),
      ahead: str(given.ahead, 120)
    }
    const { date, position: p, session, from, ahead } = out.listOrder
    if (!date) return { ...out, intent: 'unclear', why: 'Could not tell which day that list is.' }
    if (p === null && !session && !from && !ahead) {
      return { ...out, intent: 'unclear', why: 'Could not tell what the list order is.' }
    }
  }

  if (intent === 'todo') {
    const given = data.todo || {}
    const named = STAFF.find(s => s.name === given.assignee)
    out.todo = {
      task: str(given.task, 300),
      assignee: named ? named.name : 'Unassigned',
      due_date: isDate(given.due_date) ? given.due_date : '',
      priority: ['urgent', 'normal', 'low'].includes(given.priority) ? given.priority : 'normal'
    }
    if (!out.todo.task) {
      return { ...out, intent: 'unclear', why: 'Could not tell what the task was.' }
    }
  }

  return out
}

function isDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

/**
 * What the confirm screen says it is about to do.
 *
 * Plain sentences rather than a field dump. The whole safety of this feature
 * rests on somebody reading two lines and deciding they are right, and a
 * labelled grid of eight fields is not read — it is glanced at and approved.
 *
 * @returns {{title: string, lines: string[]}}
 */
export function describePlan(command, { weekdayOf } = {}) {
  const day = d => (d && weekdayOf ? `${weekdayOf(d)} ${human(d)}` : human(d))

  if (command.intent === 'booking') {
    return { title: 'New booking', lines: ['Opens the booking form, filled in.'] }
  }

  if (command.intent === 'reminder') {
    const t = command.reminder
    const kind = TASK_KINDS.find(k => k.key === t.kind)
    return {
      title: `Task · ${kind?.label || 'Task'}`,
      lines: [
        taskSummary(t).replace(/^TASK:\s*/, ''),
        day(t.date),
        t.note
      ].filter(Boolean)
    }
  }

  if (command.intent === 'listOrder') {
    const p = command.listOrder
    const who = [p.surgeon, p.patient].filter(Boolean).join(' · ')
    const bits = []
    if (p.position) bits.push(ordinal(p.position))
    if (p.session) bits.push(p.session)
    if (p.from) bits.push(`from ${p.from}`)
    return {
      title: 'List order',
      lines: [who, day(p.date), bits.join(' · '), p.ahead].filter(Boolean)
    }
  }

  if (command.intent === 'todo') {
    const t = command.todo
    return {
      title: 'Task list',
      lines: [
        t.task,
        t.assignee === 'Unassigned' ? 'Nobody yet' : t.assignee,
        t.due_date ? `Due ${day(t.due_date)}` : ''
      ].filter(Boolean)
    }
  }

  return { title: 'Not sure', lines: [command.why || 'Could not tell what that was.'] }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

function human(d) {
  if (!d) return ''
  const [y, m, day] = String(d).split('-')
  if (!y || !m || !day) return String(d)
  return `${parseInt(day, 10)} ${MONTHS[parseInt(m, 10) - 1]}`
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

/**
 * Which booking a list-order command is about.
 *
 * Resolved against the week the app already has rather than on the server,
 * because the app is holding the cases and the server would have to fetch them
 * again. Surname first — it is the one thing in a booking that identifies it —
 * then the surgeon, and only when exactly one case matches.
 *
 * Never guesses between two. A list order applied to the wrong case moves the
 * wrong team to the wrong hospital at half past seven.
 */
export function matchCase(plan, { date, surgeon, patient }) {
  const day = (plan?.days || []).find(d => d.date === date)
  if (!day) return { match: null, why: 'Nothing is booked on that day.' }

  const cases = (day.casesByHospital || []).flatMap(g => g.cases || [])
  if (!cases.length) return { match: null, why: 'Nothing is booked on that day.' }

  const like = (a, b) => a && b && String(a).toLowerCase() === String(b).toLowerCase()
  let found = patient ? cases.filter(c => like(c.patient, patient)) : []
  if (!found.length && surgeon) found = cases.filter(c => like(c.surgeon, surgeon))
  // One case that day is unambiguous whatever was said about it.
  if (!found.length && cases.length === 1) found = cases

  if (found.length === 1) return { match: found[0], why: '' }
  if (found.length > 1) {
    return { match: null, why: 'More than one case matches — set it on the booking instead.' }
  }
  return { match: null, why: 'Could not tell which case that is.' }
}

/** The kits and systems the vocabulary should be primed with. */
export const SPOKEN_VOCABULARY = [
  ...Object.keys(SURGEON_COLOUR_NAMES),
  ...INVENTORY.map(i => i.system),
  ...STAFF.map(s => s.firstName),
  ...TASK_PLACES,
  'TM Portal', 'list order', 'reminder', 'restock', 'consignment'
]
