// ─── Jobs that are not operations ────────────────────────────────────────────
// "We need to add an extra button to the portal for 'add task'. This could be
// transfer of a kit, or a reminder to restock, or a reminder to get a tray back
// from RHH. These reminders are important and need to be really easy to add to
// the day so everyone can see them. It needs to be easier than adding a task in
// Google Calendar, which is a bit clunky and relies on a lot of text entry."
//
// The work that goes wrong is rarely the operation. It is the tray that stayed
// at RHH, the set nobody restocked, the kit that needed to be in a car on
// Tuesday morning. None of that has a patient or a surgeon, so none of it fits
// a booking — and the alternative, a Google Calendar entry, means a title, a
// date, a time and a description typed on a phone in a corridor. So it does not
// get written down, and it gets forgotten.
//
// ── Taps, not typing ──
//
// This is the whole design. A task is a kind, a thing, and at most two places,
// and every one of those is a known value with a button already on it: our own
// inventory, our two hospitals and the office, our own staff. The free-text box
// is there for the task nobody anticipated, and it is the last resort rather
// than the shape of the form.
//
// ── Why they live on the calendar ──
//
// The same calendar as the bookings, so a task is on the day next to the cases
// it is about, and so that somebody looking at Google rather than the portal
// still sees it. A reminder only half the team can see is not a reminder.
//
// They are written so that readBooking cannot mistake one for a case — there is
// no surgeon and no patient, which is already the test — and so that a person
// reading the calendar entry understands it without the app.

import { INVENTORY } from './inventory.js'

/** The marker that makes a calendar entry a task. First thing in the title. */
export const TASK_PREFIX = 'TASK:'

/**
 * The kinds of job, as buttons.
 *
 * `places` says how many locations the kind needs, which is what decides how
 * many taps it takes: a restock happens somewhere, a transfer goes between two
 * somewheres, and a reminder to ring somebody has no place at all.
 */
export const TASK_KINDS = [
  {
    key: 'move',
    label: 'Move a kit',
    places: 2,
    needsThing: true,
    // "Move Mariner from RHH to Calvary"
    phrase: (thing, from, to) => `Move ${thing}${from ? ` from ${from}` : ''}${to ? ` to ${to}` : ''}`
  },
  {
    key: 'return',
    label: 'Get a tray back',
    places: 1,
    needsThing: true,
    phrase: (thing, from) => `Get ${thing} back${from ? ` from ${from}` : ''}`
  },
  {
    key: 'restock',
    label: 'Restock',
    places: 1,
    needsThing: true,
    phrase: (thing, where) => `Restock ${thing}${where ? ` at ${where}` : ''}`
  },
  {
    key: 'other',
    label: 'Something else',
    places: 0,
    needsThing: false,
    phrase: thing => String(thing || 'Task')
  }
]

/** Everywhere a kit can be, as buttons. */
export const TASK_PLACES = ['RHH', 'Calvary', 'TM Office', 'Launceston', 'Distributor']

/**
 * The things a task is usually about.
 *
 * Taken from the inventory rather than typed out again, so a kit added there
 * turns up here without anybody remembering to. The extras are the things that
 * get restocked and are not implant systems.
 */
export function taskThings() {
  const kits = INVENTORY.map(item => item.system).filter(Boolean)
  return [...new Set([...kits, 'Screws', 'Cages', 'Plates', 'Disposables', 'Loan set'])]
}

export function kindFor(key) {
  return TASK_KINDS.find(k => k.key === key) || null
}

/**
 * The calendar title for a task.
 *
 * The prefix is what makes it findable, and the phrase after it is written so
 * that somebody reading the calendar on a phone, with no app, knows what is
 * being asked without opening anything.
 */
export function taskSummary({ kind, thing, from, to } = {}) {
  const entry = kindFor(kind)
  if (!entry) return ''
  const phrase = entry.key === 'move'
    ? entry.phrase(thing, from, to)
    : entry.places === 1 ? entry.phrase(thing, from) : entry.phrase(thing)
  return `${TASK_PREFIX} ${String(phrase).trim()}`.trim()
}

/**
 * The description, as labelled lines like everything else in this calendar.
 *
 * Labelled so it can be read back, and so a person editing it by hand in Google
 * has something obvious to edit.
 */
export function taskDescription({ kind, thing, from, to, who, note, addedBy } = {}) {
  const entry = kindFor(kind)
  const lines = [
    `Task: ${entry ? entry.label : 'Task'}`,
    thing ? `Item: ${thing}` : null,
    entry?.places === 2 ? (from ? `From: ${from}` : null) : (from ? `Where: ${from}` : null),
    entry?.places === 2 && to ? `To: ${to}` : null,
    // No name means the whole team, which is said out loud rather than left as
    // a blank somebody has to interpret.
    `For: ${who || 'Anyone'}`,
    note ? `Note: ${note}` : null,
    '',
    addedBy ? `Added by ${addedBy}` : null
  ]
  return lines.filter(l => l !== null).join('\n').trim()
}

/** Whether a calendar entry is one of these. */
export function isTask(summary) {
  return new RegExp(`^\\s*${TASK_PREFIX}`, 'i').test(String(summary || ''))
}

/** The line that records a task as finished. Appended, never replacing. */
export function doneLine(who, when) {
  return `Done by ${who || 'somebody'}${when ? ` on ${when}` : ''}`
}

const DONE_PATTERN = /^\s*Done by ([^\n]*?)(?:\s+on\s+([^\n]*))?\s*$/im

/**
 * A task read back off its calendar entry.
 *
 * Null when the entry is not a task, so a caller can use it as the test.
 *
 * Tolerant about what it finds. These are editable by hand in Google — that is
 * half the point of putting them there — so a task whose description somebody
 * has rewritten still reads as a task with whatever is left.
 */
export function readTask(summary, description) {
  if (!isTask(summary)) return null
  const text = String(description || '').replace(/\r\n?/g, '\n')
  const field = name => {
    const m = new RegExp(`^\\s*${name}\\s*[:\\-]\\s*(.+)$`, 'im').exec(text)
    return m ? m[1].trim() : null
  }

  const label = field('Task')
  const done = DONE_PATTERN.exec(text)
  const who = field('For')

  return {
    what: String(summary).replace(new RegExp(`^\\s*${TASK_PREFIX}\\s*`, 'i'), '').trim(),
    kind: TASK_KINDS.find(k => k.label.toLowerCase() === String(label || '').toLowerCase())?.key
      || 'other',
    thing: field('Item'),
    from: field('From') || field('Where'),
    to: field('To'),
    // "Anyone" is the written form of nobody in particular, and reads back as
    // no name rather than as a person called Anyone.
    who: who && !/^anyone$/i.test(who) ? who : null,
    note: field('Note'),
    addedBy: field('Added by') || (/^\s*Added by (.+)$/im.exec(text)?.[1]?.trim() ?? null),
    done: Boolean(done),
    doneBy: done ? (done[1] || '').trim() || null : null,
    doneOn: done ? (done[2] || '').trim() || null : null
  }
}
