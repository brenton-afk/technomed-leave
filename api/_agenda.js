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
    items: (Array.isArray(raw.items) ? raw.items : []).slice(0, 40).map((it, i) => ({
      id: clip(it?.id, 40) || `i${i + 1}-${Math.random().toString(36).slice(2, 7)}`,
      title: clip(it?.title, 160),
      points: lines(it?.points, 20, 240),
      lead: clip(it?.lead, 80)
    })).filter(it => it.title),
    notes: clip(raw.notes, 2000)
  }
}

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
