// ─── The live meeting (Brent, 11 Nov 2026) ───────────────────────────────────
// "We want the ability to have a real time live meeting, where you
// automatically update the projects page in real time for us." One phone in
// the room records; every forty seconds or so what was said is written out and
// read against the open tasks, and what it implies — a new task, a task
// finished, a task handed to someone else or given a date — appears on
// everyone's screen as a suggestion. Nothing reaches the projects page until a
// person taps Accept: a meeting is full of things said in passing, and a
// board that fills itself with them is a board nobody trusts.
//
// The rules are pure and live here, shared by the server (api/_liveMeeting.js)
// and the screen (pages/projects/LiveMeeting.jsx).

export const KINDS = ['new', 'done', 'update']
const PRIORITIES = ['urgent', 'normal', 'low']
const ISO = /^\d{4}-\d{2}-\d{2}$/

const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * The open tasks a meeting may talk about, short enough to put in a prompt.
 * Private-board tasks are always left out: the live panel is seen by everyone
 * in the room, whoever started it.
 */
export function openTaskBrief(items = [], privateProjectIds = new Set(), max = 150) {
  return items
    .filter(t => t && t.id && t.status !== 'done' && !t.archivedAt && !t.archived)
    .filter(t => !privateProjectIds.has(String(t.projectId || '')))
    .slice(0, max)
    .map(t => ({ id: String(t.id), task: String(t.task || '').slice(0, 160), assignee: t.assignee || 'Unassigned', due_date: t.due_date || '' }))
}

/** Pull the JSON object out of a model's answer, forgiving fences and preamble. */
export function readJsonObject(textOut) {
  const s = String(textOut || '')
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try { return JSON.parse(s.slice(a, b + 1)) } catch { return null }
}

function sameSuggestion(a, b) {
  if (a.kind !== b.kind) return false
  if (a.kind === 'new') return words(a.task) === words(b.task)
  if (a.kind === 'done') return a.taskId === b.taskId
  return a.taskId === b.taskId && (a.assignee || '') === (b.assignee || '') && (a.due_date || '') === (b.due_date || '')
}

/**
 * What the model suggested, kept only where it makes sense: a known kind, a
 * task that exists for "done" and "update", a staff name or Unassigned, a real
 * date. Anything already on the panel (waiting, accepted or skipped) is not
 * offered twice — the same thing is often said three times in a meeting.
 */
export function cleanSuggestions(raw, { openTasks = [], staffNames = [], existing = [], at = '', stamp = () => Math.random().toString(36).slice(2, 10) } = {}) {
  const list = Array.isArray(raw?.suggestions) ? raw.suggestions : Array.isArray(raw) ? raw : []
  const byId = new Map(openTasks.map(t => [String(t.id), t]))
  const names = new Set(staffNames)
  const person = n => (names.has(n) ? n : '')
  const date = d => (ISO.test(String(d || '')) ? String(d) : '')
  const out = []
  for (const s of list) {
    if (!s || !KINDS.includes(s.kind)) continue
    const why = String(s.why || '').trim().slice(0, 240)
    let next = null
    if (s.kind === 'new') {
      const task = String(s.task || '').trim().slice(0, 300)
      if (!task) continue
      next = { kind: 'new', task, assignee: person(s.assignee) || 'Unassigned', due_date: date(s.due_date),
        priority: PRIORITIES.includes(s.priority) ? s.priority : 'normal' }
    } else {
      const t = byId.get(String(s.taskId || ''))
      if (!t) continue
      if (s.kind === 'done') next = { kind: 'done', taskId: t.id, task: t.task, assignee: t.assignee }
      else {
        const assignee = person(s.assignee)
        const due = date(s.due_date)
        if ((!assignee || assignee === t.assignee) && (!due || due === t.due_date)) continue
        next = { kind: 'update', taskId: t.id, task: t.task, was: { assignee: t.assignee, due_date: t.due_date },
          ...(assignee && assignee !== t.assignee ? { assignee } : {}), ...(due && due !== t.due_date ? { due_date: due } : {}) }
      }
    }
    if ([...existing, ...out].some(e => sameSuggestion(e, next))) continue
    out.push({ id: `s-${stamp()}`, ...next, why, status: 'waiting', at })
  }
  return out.slice(0, 8)
}

/** The prompt for one stretch of the meeting. */
export function suggestionPrompt({ chunk, recent = '', openTasks = [], staffNames = [], today = '', agenda = [] }) {
  return `You are listening in on a staff meeting at TechnoMed, a Tasmanian surgical implant distributor, and keeping its project task list up to date. Today is ${today}.

Staff (the only names allowed as an assignee): ${staffNames.join(', ')}.
${agenda.length ? `\nToday's agenda: ${agenda.join(' | ')}\n` : ''}
Open tasks (id — task — who — due):
${openTasks.map(t => `${t.id} — ${t.task} — ${t.assignee} — ${t.due_date || 'no date'}`).join('\n') || '(none)'}

What was said a little earlier, for context only:
"""
${String(recent).slice(-2500)}
"""

What was just said — suggest changes only from this:
"""
${chunk}
"""

Suggest only what was clearly agreed or reported, never a passing idea:
- "new": a job someone agreed to do that is not already an open task
- "done": an open task someone reported as finished (use its id)
- "update": an open task handed to someone else, or given a new date (use its id)
Dates as YYYY-MM-DD, worked out from today. "why" is a few words on what was said, paraphrased.

Return ONLY JSON: {"suggestions":[{"kind":"new","task":"…","assignee":"…","due_date":"","priority":"normal","why":"…"},{"kind":"done","taskId":"…","why":"…"},{"kind":"update","taskId":"…","assignee":"…","due_date":"","why":"…"}]}
If nothing qualifies, return {"suggestions":[]}.`
}

/** A suggestion as a person would say it. */
export function describe(s) {
  if (!s) return ''
  if (s.kind === 'new') return `New task: ${s.task}${s.assignee && s.assignee !== 'Unassigned' ? ` — ${s.assignee.split(' ')[0]}` : ''}`
  if (s.kind === 'done') return `Done: ${s.task}`
  const bits = []
  if (s.assignee) bits.push(`to ${s.assignee.split(' ')[0]}`)
  if (s.due_date) bits.push(`due ${s.due_date}`)
  return `Change: ${s.task} — ${bits.join(', ')}`
}

/** Whether a recording phone is still sending (a chunk within the last two minutes). */
export function recorderActive(live, now = Date.now()) {
  const last = Date.parse(live?.recorder?.lastAt || '')
  return Boolean(live?.recorder?.name) && Number.isFinite(last) && now - last < 2 * 60 * 1000
}
