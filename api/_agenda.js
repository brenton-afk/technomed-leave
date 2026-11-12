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
