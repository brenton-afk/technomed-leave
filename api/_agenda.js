// ─── The next meeting's agenda (Brent, 11 Nov 2026) ──────────────────────────
// "Generate an agenda for the next meeting based on the work that was
// completed and also based on previous meeting agendas … a live document that
// anyone can see at any moment and would live in the projects page." Erin
// alone edits it (Brent: "Just Erin to edit the agenda"); everyone signed in
// reads it. Her earlier agendas are in Brent's mailbox — Word documents she
// sent him — and are imported from there, read-only, as text.
//
// Shape follows her own document (12 Nov 2026): a header (date, time,
// location, chair, attendees, apologies) over numbered items, each with
// discussion points and a lead.

import { redis, redisSetBody } from './_redis.js'

export const AGENDA_KEY = 'agenda:current'
export const PAST_INDEX = 'agenda:past'
const PAST = id => `agenda:past:${id}`

export function agendaEditors() {
  return String(process.env.AGENDA_EDITORS || 'erin@technomed.com.au')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}
export const canEditAgenda = email => agendaEditors().includes(String(email || '').toLowerCase())

const clip = (v, n) => String(v ?? '').replace(/\r/g, '').trim().slice(0, n)
const lines = (v, n, each) => (Array.isArray(v) ? v : String(v || '').split('\n'))
  .map(x => clip(x, each)).filter(Boolean).slice(0, n)

/** An agenda held to a shape the screen can trust. Pure. */
export function cleanAgenda(raw = {}) {
  return {
    title: clip(raw.title, 120) || 'TechnoMed Staff Meeting',
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date || '')) ? raw.date : '',
    time: clip(raw.time, 60),
    location: clip(raw.location, 200),
    chair: clip(raw.chair, 80),
    attendees: clip(raw.attendees, 400),
    apologies: clip(raw.apologies, 300),
    items: orderedItems((Array.isArray(raw.items) ? raw.items : []).slice(0, 40).map((it, i) => ({
      id: clip(it?.id, 40) || `i${i + 1}-${Math.random().toString(36).slice(2, 7)}`,
      title: clip(it?.title, 160),
      points: lines(it?.points, 20, 240),
      lead: clip(it?.lead, 80)
    })).filter(it => it.title)),
    notes: clip(raw.notes, 2000)
  }
}

export { orderedItems, isWelcome, isGeneral, isNextMeeting } from '../src/projects/agendaOrder.js'
import { orderedItems } from '../src/projects/agendaOrder.js'

export async function getAgenda() {
  const raw = await redis('get', AGENDA_KEY)
  try { return raw ? JSON.parse(raw) : null } catch { return null }
}

/**
 * Saves Erin's agenda. `version` is the one she was editing: a save against an
 * older one is refused, so two of her devices cannot write over each other.
 */
export async function saveAgenda(agenda, { version, by }) {
  const lock = 'agenda:lock'
  if (await redis('set', lock, '1', 'NX', 'EX', '10') !== 'OK') {
    throw Object.assign(new Error('The agenda is being saved — try again in a moment'), { code: 'busy' })
  }
  try {
    const now = await getAgenda()
    if (now && Number(version) !== Number(now.version)) {
      throw Object.assign(new Error('The agenda was changed on another device — it has been reloaded'), { code: 'conflict', current: now })
    }
    const next = { ...cleanAgenda(agenda), version: (now?.version || 0) + 1, updatedAt: new Date().toISOString(), updatedBy: by || '' }
    await redisSetBody(AGENDA_KEY, JSON.stringify(next))
    return next
  } finally {
    await redis('del', lock).catch(() => {})
  }
}

// ─── Earlier agendas ─────────────────────────────────────────────────────────

export async function pastAgendas(limit = 40) {
  const ids = await redis('lrange', PAST_INDEX, '0', String(limit - 1)) || []
  const rows = await Promise.all(ids.map(id => redis('get', PAST(id)).catch(() => null)))
  return rows.map(r => { try { return r ? JSON.parse(r) : null } catch { return null } }).filter(Boolean)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
}

export async function keepPastAgenda({ id, date, subject, filename, text }) {
  const exists = await redis('exists', PAST(id))
  await redisSetBody(PAST(id), JSON.stringify({ id, date, subject: clip(subject, 200), filename: clip(filename, 200), text: clip(text, 20000) }))
  if (!exists) await redis('lpush', PAST_INDEX, id)
  return !exists
}

/** Whether an email attachment looks like an agenda document. Pure. */
export function isAgendaFile(filename = '') {
  return /\.docx$/i.test(filename) && /agenda/i.test(filename)
}

/** The draft prompt's material, compacted. Pure, for the tests. */
export function draftMaterial({ past = [], report = null, nextDate = '' }) {
  const recent = past.slice(0, 6).map(p => `--- ${p.date} · ${p.subject}\n${String(p.text).slice(0, 4000)}`).join('\n\n')
  const r = report
  const list = (title, rows) => (rows?.length ? `${title}:\n${rows.map(t => `- ${t.task} (${t.assignee}${t.doneOn ? `, done ${t.doneOn}` : t.due_date ? `, due ${t.due_date}` : ''})`).join('\n')}` : '')
  const work = r ? [
    `Since the meeting of ${r.from} (${r.meeting.title}): ${r.totals.done} of ${r.totals.items} action items done, ${r.totals.open} outstanding.`,
    list('Done', r.done), list('Outstanding', r.open), list('Still open from earlier meetings', r.earlier),
    list('Other work completed in the period', r.other.slice(0, 30))
  ].filter(Boolean).join('\n\n') : 'No earlier meeting with action items on record.'
  return { recent, work, nextDate }
}

// ─── Built from the projects report (Brent, 12 Nov 2026) ─────────────────────
// "The agendas [should] be written based off the projects completed report …
// and the agenda should have a section for the items that are not completed,
// so we don't waste time asking staff to tell us about the things we thought
// weren't done. Ideally, Erin would tell the portal the date and time of the
// meeting and the agenda would build as an exportable and printable file and
// Erin could add items … a Claude chat … to build the agenda."
//
// The two action lists are worked out from the projects every time the agenda
// is read — never typed, never by the model — so they are always as true as
// the projects page. Erin's own items sit after them, and the chat edits only
// those and the header.

const brief = t => ({ task: t.task, assignee: t.assignee, due_date: t.due_date || '', doneOn: t.doneOn || '', overdue: Boolean(t.overdue) })

/** The report as the agenda's two lists. Pure. */
export function agendaActions(report) {
  if (!report) return null
  // Only what is NOT done goes on the agenda (Brent, 12 Nov 2026: "Completed
  // actions should not be on the agenda, that's the point").
  return {
    since: { title: report.meeting?.title || 'Last meeting', date: report.from, to: report.to },
    notDone: [...(report.open || []), ...(report.earlier || [])].map(brief)
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || String(a.assignee).localeCompare(String(b.assignee)))
  }
}

/** A new agenda for the next meeting, carrying the standing items over. Pure. */
export function newAgendaFor({ date, time, location, chair, attendees, apologies, previous = null }) {
  const standing = (previous?.items || []).map(it => ({ title: it.title, points: [], lead: it.lead || '' }))
  return cleanAgenda({
    title: previous?.title || 'TechnoMed Staff Meeting',
    date, time,
    location: location ?? previous?.location ?? '',
    chair: chair ?? previous?.chair ?? 'Erin Smallbon',
    attendees: attendees ?? previous?.attendees ?? '',
    apologies: apologies ?? '',
    items: standing.length ? standing : [
      { title: 'Welcome and apologies', lead: 'Erin' },
      { title: 'General business' },
      { title: 'Next meeting' }
    ]
  })
}

const weekdayOf = d => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${d}T12:00:00Z`).getUTCDay()] || ''

/** The prompt for one turn of the agenda chat. Pure, for the tests. */
export function agendaChatPrompt({ agenda, actions, past = [], staff = [], today }) {
  const list = (rows, done) => rows.map(t => `- ${t.task} (${t.assignee}${done ? `, done ${t.doneOn}` : t.due_date ? `, due ${t.due_date}${t.overdue ? ', OVERDUE' : ''}` : ''})`).join('\n') || '(none)'
  return `You help Erin Smallbon, General Manager of TechnoMed (a Tasmanian surgical device distributor), build the agenda for the next staff meeting by chatting with her. Today is ${today}.

The printed agenda always shows, automatically after "General business", the actions from earlier meetings that are NOT completed, worked out from the projects page — do NOT copy these into items. Completed work never goes on the agenda.
NOT completed (to be discussed, not asked about):
${list(actions?.notDone || [], false)}

The order is fixed and kept for you: "Welcome and apologies" first, "General business" second, the outstanding actions, then the other items, "Next meeting" last.

You are the way Erin builds the agenda — she does not fill in a form, she talks to you. ACT: whenever what she says implies a change, make it with the tools (set_details, start_new_agenda, add_item, update_item, remove_item) in this same turn — never just say you did. Several changes, several tool calls. Then reply in a sentence or two saying what changed. Only ask a question when you truly cannot act (for example no date at all for a new meeting).

You change only the header (title, date as YYYY-MM-DD, time, location, chair, attendees, apologies) and the discussion items. Attendees and apologies are comma-separated full staff names; "everyone" means all staff below, less any apologies.
${agenda?.date && agenda.date >= today ? '' : 'The agenda on file is for a meeting that has passed (or there is none). When she gives the next meeting date, call start_new_agenda first, then make her other changes.\n'}You may add discussion items that follow from the not-completed list (e.g. one item per person or topic with the outstanding tasks as points) when she asks. Never invent decisions, dates or people. Work dates out from today (${weekdayOf(today)} ${today}). Staff: ${staff.join(', ')}.

Her earlier agendas, for her structure and wording:
${past.slice(0, 3).map(p => `--- ${p.date}\n${String(p.text).slice(0, 2500)}`).join('\n\n') || '(none imported)'}

The agenda as it stands now (items are named by id in the tools):
${JSON.stringify({ title: agenda?.title, date: agenda?.date, time: agenda?.time, location: agenda?.location, chair: agenda?.chair, attendees: agenda?.attendees, apologies: agenda?.apologies, items: (agenda?.items || []).map(i => ({ id: i.id, title: i.title, points: i.points, lead: i.lead })) })}`
}

// ─── The conversation, kept (Brent, 12 Nov 2026: "use it like a chatbot") ────
export const AGENDA_CHAT_KEY = 'agenda:chat'
export async function getAgendaChat() {
  try { return JSON.parse(await redis('get', AGENDA_CHAT_KEY) || '[]') || [] } catch { return [] }
}
export async function saveAgendaChat(messages) {
  await redisSetBody(AGENDA_CHAT_KEY, JSON.stringify(messages.slice(-40)))
}
