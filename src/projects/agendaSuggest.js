// ─── Items to tap onto the agenda (Brent, 12 Nov 2026: "Get rid of the bot
// and give us an alternative way to edit easily") ────────────────────────────
// Erin builds the agenda by tapping, not typing. Each project with open work
// is offered as an item with its open tasks as the discussion points, and the
// last agenda's own items are offered to carry over. Nothing is added until
// she taps it. Pure — the server and the tests share it.
import { isWelcome, isGeneral, isNextMeeting } from './agendaOrder.js'

const first = n => String(n || '').trim().split(/\s+/)[0] || ''
const norm = s => String(s || '').trim().toLowerCase()
const standing = t => isWelcome(t) || isGeneral(t) || isNextMeeting(t)

export function agendaSuggestions({ projects = [], tasks = [], previous = null, current = null, today = '' } = {}) {
  const onAgenda = new Set((current?.items || []).map(i => norm(i.title)))
  const out = []
  for (const p of projects) {
    if (!p || p.private || p.archived || !p.name || onAgenda.has(norm(p.name))) continue
    const open = tasks.filter(t => String(t.projectId || '') === String(p.id) && t.status !== 'done' && !t.archived)
    if (!open.length) continue
    const overdue = t => Boolean(t.due_date && today && t.due_date < today)
    open.sort((a, b) => Number(overdue(b)) - Number(overdue(a)) || String(a.due_date || '9').localeCompare(String(b.due_date || '9')))
    const late = open.filter(overdue).length
    out.push({
      key: `project:${p.id}`, kind: 'project', title: p.name,
      points: open.slice(0, 8).map(t => `${t.task}${t.assignee ? ` — ${first(t.assignee)}` : ''}${overdue(t) ? ' (overdue)' : ''}`),
      lead: p.owner && p.owner !== 'Unassigned' ? first(p.owner) : '',
      note: `${open.length} open${late ? ` · ${late} overdue` : ''}`
    })
  }
  for (const it of previous?.items || []) {
    if (!it?.title || standing(it.title) || onAgenda.has(norm(it.title)) || out.some(o => norm(o.title) === norm(it.title))) continue
    out.push({ key: `last:${norm(it.title)}`, kind: 'last', title: it.title, points: it.points || [], lead: it.lead || '', note: 'On the last agenda' })
  }
  return out
}
