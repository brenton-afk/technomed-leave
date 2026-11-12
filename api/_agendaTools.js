// ─── The agenda chat's actions (Brent, 12 Nov 2026: "The bot isn't working …
// it's not making any changes") ───────────────────────────────────────────────
// The chat used to ask Claude to write the whole agenda back as JSON in its
// reply. After the first turn it saw its own earlier replies as plain
// sentences and answered in kind — "Done, I've added it" — with nothing for the
// portal to apply. Now every change is a tool call the portal carries out
// itself, and the screen lists what was actually done, never what was said.

import { cleanAgenda, newAgendaFor } from './_agenda.js'
import { askClaude } from './_anthropic.js'

const str = { type: 'string' }
const points = { type: 'array', items: str, description: 'Discussion points, one per line' }

export const AGENDA_TOOLS = [
  {
    name: 'set_details',
    description: 'Change the agenda header. Send only the fields that change. Attendees and apologies are comma-separated full staff names and replace the whole list.',
    input_schema: { type: 'object', properties: {
      title: str, date: { type: 'string', description: 'YYYY-MM-DD' }, time: str, location: str, chair: str, attendees: str, apologies: str
    } }
  },
  {
    name: 'start_new_agenda',
    description: 'Start the agenda for a new meeting date: carries the standing items over with their points cleared, clears apologies. Use when the meeting is a different one from the agenda on file.',
    input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, time: str, location: str }, required: ['date'] }
  },
  {
    name: 'add_item',
    description: 'Add a discussion item. The fixed order (Welcome and apologies, General business, the outstanding actions, other items, Next meeting) is kept automatically.',
    input_schema: { type: 'object', properties: { title: str, points, lead: str }, required: ['title'] }
  },
  {
    name: 'update_item',
    description: 'Change an existing item, named by its id. Send only what changes; add_points appends, points replaces them all.',
    input_schema: { type: 'object', properties: { id: str, title: str, points, add_points: points, remove_points: points, lead: str }, required: ['id'] }
  },
  {
    name: 'remove_item',
    description: 'Take an item off the agenda, named by its id.',
    input_schema: { type: 'object', properties: { id: str }, required: ['id'] }
  }
]

const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k) && o[k] !== undefined && o[k] !== null
const norm = s => String(s || '').trim().toLowerCase()

/** Finds an item by id, else by its title (models sometimes send that). */
function findItem(items, ref) {
  const r = norm(ref)
  return items.findIndex(it => norm(it.id) === r) >= 0
    ? items.findIndex(it => norm(it.id) === r)
    : items.findIndex(it => norm(it.title) === r)
}

/**
 * Applies one tool call to an agenda. Pure: returns the new agenda and a short
 * line saying what was done, or `error` with the agenda unchanged.
 */
export function applyAgendaTool(agenda, name, input = {}) {
  const a = cleanAgenda(agenda || {})
  const items = a.items.map(it => ({ ...it, points: [...it.points] }))
  if (name === 'set_details') {
    const fields = ['title', 'date', 'time', 'location', 'chair', 'attendees', 'apologies'].filter(k => has(input, k))
    if (!fields.length) return { agenda: a, error: 'Nothing to change' }
    if (has(input, 'date') && input.date && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { agenda: a, error: 'Date must be YYYY-MM-DD' }
    const next = cleanAgenda({ ...a, ...Object.fromEntries(fields.map(k => [k, input[k]])) })
    return { agenda: next, done: `Changed ${fields.join(', ')}` }
  }
  if (name === 'start_new_agenda') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.date || ''))) return { agenda: a, error: 'Date must be YYYY-MM-DD' }
    const next = newAgendaFor({ date: input.date, time: input.time ?? a.time, location: input.location, previous: a })
    return { agenda: next, done: `New agenda for ${input.date}`, newMeeting: true }
  }
  if (name === 'add_item') {
    if (!String(input.title || '').trim()) return { agenda: a, error: 'An item needs a title' }
    const next = cleanAgenda({ ...a, items: [...items, { title: input.title, points: input.points || [], lead: input.lead || '' }] })
    return { agenda: next, done: `Added "${String(input.title).trim()}"` }
  }
  if (name === 'update_item' || name === 'remove_item') {
    const i = findItem(items, input.id)
    if (i < 0) return { agenda: a, error: `No item with id ${input.id}` }
    const was = items[i].title
    if (name === 'remove_item') {
      items.splice(i, 1)
      return { agenda: cleanAgenda({ ...a, items }), done: `Removed "${was}"` }
    }
    const it = items[i]
    if (has(input, 'title') && String(input.title).trim()) it.title = input.title
    if (has(input, 'lead')) it.lead = input.lead
    if (Array.isArray(input.points)) it.points = input.points
    if (Array.isArray(input.remove_points)) { const gone = new Set(input.remove_points.map(norm)); it.points = it.points.filter(p => !gone.has(norm(p))) }
    if (Array.isArray(input.add_points)) it.points = [...it.points, ...input.add_points]
    return { agenda: cleanAgenda({ ...a, items }), done: `Updated "${it.title}"` }
  }
  return { agenda: a, error: `Unknown action ${name}` }
}

/**
 * One turn of the agenda chat: Claude acts through the tools in
 * api/_agendaTools.js until it has nothing more to change, then says what it
 * did. The agenda is worked on in memory and saved once by the caller; the
 * changes listed are the ones the portal carried out, not Claude's account.
 */
export async function runAgendaChat({ system, messages, agenda, ask = askClaude }) {
  let working = agenda || {}
  const changes = []
  let newMeeting = false
  const convo = [...messages]
  for (let round = 0; round < 6; round++) {
    const answer = await ask({
      feature: 'agenda-chat',
      whenUnavailable: 'Claude cannot help with the agenda right now — try again in a minute.',
      timeoutMs: 60000,
      request: {
        model: process.env.AGENDA_MODEL || 'claude-opus-5-5', max_tokens: 8000,
        output_config: { effort: 'low' }, tool_choice: { type: 'auto' },
        system, tools: AGENDA_TOOLS, messages: convo
      }
    })
    const content = answer.content || []
    const calls = content.filter(b => b.type === 'tool_use')
    if (!calls.length || answer.stop_reason !== 'tool_use') {
      const said = content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
      return { reply: (said || (changes.length ? 'Done.' : 'Sorry — I could not work that out.')).slice(0, 1500), agenda: working, changes, newMeeting }
    }
    convo.push({ role: 'assistant', content })
    const results = calls.map(c => {
      const out = applyAgendaTool(working, c.name, c.input || {})
      if (!out.error) { working = { ...out.agenda, version: agenda?.version }; changes.push(out.done); if (out.newMeeting) newMeeting = true }
      const now = { date: working.date, time: working.time, items: (working.items || []).map(i => ({ id: i.id, title: i.title })) }
      return { type: 'tool_result', tool_use_id: c.id, is_error: Boolean(out.error), content: out.error || `${out.done}. Agenda now: ${JSON.stringify(now)}` }
    })
    convo.push({ role: 'user', content: results })
  }
  return { reply: changes.length ? 'Done.' : 'Sorry — I could not work that out.', agenda: working, changes, newMeeting }
}
