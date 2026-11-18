// ─── The agenda follows the tasks (Brent, 18 Nov 2026) ───────────────────────
// "If we update a task in our own tasks, we want it to auto update the agenda
// in the meeting." A project item on the agenda used to be a copy of its open
// tasks as they read when Erin tapped it on — tick one, rename it, give it to
// someone else, and the agenda still said the old thing. Now a project item is
// linked to its project (`projectId`) and its task points are worked out from
// the projects page every time the agenda is read (`live`): a task done or
// archived comes off, a new one goes on, a change of wording, owner or due
// date shows. Erin's own typed points stay hers (`points`), and a task point
// she takes off stays off (`hidden`).
//
// Items tapped on before this were copies with no link: one whose title is a
// project's name is linked on read, and the copied task lines are dropped in
// favour of the live ones. Private-board projects are never linked (everyone
// reads the agenda). Pure — the server and the tests share it.
import { isWelcome, isGeneral, isNextMeeting } from './agendaOrder.js'

const first = n => String(n || '').trim().split(/\s+/)[0] || ''
const norm = s => String(s || '').trim().toLowerCase()
const standing = t => isWelcome(t) || isGeneral(t) || isNextMeeting(t)
export const LIVE_MAX = 20

const overdueOn = today => t => Boolean(t.due_date && today && t.due_date < today)

/** One task as an agenda point: "Order the drill guide — Mat (overdue)". */
export function taskPoint(t, today = '') {
  const who = t.assignee && t.assignee !== 'Unassigned' ? ` — ${first(t.assignee)}` : ''
  return `${t.task}${who}${overdueOn(today)(t) ? ' (overdue)' : ''}`
}

/** A project's open tasks, overdue first then by due date. */
export function openTasksOf(projectId, tasks = [], today = '') {
  const overdue = overdueOn(today)
  return tasks
    .filter(t => String(t.projectId || '') === String(projectId) && t.status !== 'done' && !t.archived && t.task)
    .sort((a, b) => Number(overdue(b)) - Number(overdue(a)) || String(a.due_date || '9').localeCompare(String(b.due_date || '9')))
}

/** The agenda with each project item's task points as the projects page has them now. */
export function liveAgenda(agenda, { projects = [], tasks = [], today = '' } = {}) {
  if (!agenda || !Array.isArray(agenda.items)) return agenda
  const usable = (projects || []).filter(p => p && p.id != null && !p.private && !p.archived)
  const byId = new Map(usable.map(p => [String(p.id), p]))
  const byName = new Map(usable.filter(p => p.name).map(p => [norm(p.name), p]))
  const items = agenda.items.map(it => {
    if (!it || standing(it.title)) return it
    const linked = it.projectId ? byId.get(String(it.projectId)) : null
    const project = linked || (!it.projectId ? byName.get(norm(it.title)) : null)
    if (!project) return it.projectId ? { ...it, live: [] } : it
    const all = tasks.filter(t => String(t.projectId || '') === String(project.id))
    // Linked on read: the copied task lines give way to the live ones.
    const copied = p => all.some(t => String(t.task || '').trim().length >= 4 && norm(p).startsWith(norm(t.task)))
    const points = linked ? (it.points || []) : (it.points || []).filter(p => !copied(p))
    const hidden = new Set((it.hidden || []).map(String))
    const live = openTasksOf(project.id, tasks, today)
      .filter(t => !hidden.has(String(t.id)))
      .slice(0, LIVE_MAX)
      .map(t => ({ id: String(t.id), text: taskPoint(t, today) }))
    return { ...it, projectId: String(project.id), points, live }
  })
  return { ...agenda, items }
}

/** Every point an item shows: its live task points, then Erin's own. */
export const itemPoints = it => [...(it?.live || []).map(l => l.text), ...(it?.points || [])]
