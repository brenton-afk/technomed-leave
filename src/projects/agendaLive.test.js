import { describe, it, expect } from 'vitest'
import { liveAgenda, itemPoints, taskPoint } from './agendaLive.js'
import { agendaSuggestions } from './agendaSuggest.js'
import { cleanAgenda } from '../../api/_agenda.js'
import { agendaSections, editItems } from '../pages/projects/Agenda.jsx'

// The agenda follows the tasks (Brent, 18 Nov 2026: "if we update a task in
// our own tasks, we want it to auto update the agenda in the meeting").

const today = '2026-11-18'
const projects = [
  { id: 'p1', name: 'Brainlab drill guide' },
  { id: 'p2', name: 'Private thing', private: true }
]
const tasks = [
  { id: 't1', projectId: 'p1', task: 'Order the drill guide', assignee: 'Mat Smith', due_date: '2026-11-10' },
  { id: 't2', projectId: 'p1', task: 'Quote RHH for the instruments', assignee: 'Toni', due_date: '2026-11-25' },
  { id: 't3', projectId: 'p1', task: 'Ask Cody about freight', assignee: 'Brent', status: 'done' },
  { id: 't4', projectId: 'p2', task: 'Secret', assignee: 'Brent' }
]
const agendaWith = item => ({ items: [{ title: 'Welcome and apologies' }, { title: 'General business' }, item, { title: 'Next meeting' }] })

describe('a project item on the agenda is live', () => {
  it('shows the project’s open tasks as they are now, overdue first', () => {
    const a = liveAgenda(agendaWith({ id: 'i1', title: 'Drill guide', projectId: 'p1', points: ['Erin’s own point'] }), { projects, tasks, today })
    const it3 = a.items[2]
    expect(it3.live.map(l => l.text)).toEqual(['Order the drill guide — Mat (overdue)', 'Quote RHH for the instruments — Toni'])
    expect(itemPoints(it3)).toEqual(['Order the drill guide — Mat (overdue)', 'Quote RHH for the instruments — Toni', 'Erin’s own point'])
  })

  it('a task ticked, renamed or reassigned changes the agenda on the next read', () => {
    const item = { id: 'i1', title: 'Drill guide', projectId: 'p1', points: [] }
    const changed = tasks.map(t => (t.id === 't1' ? { ...t, status: 'done' } : t.id === 't2' ? { ...t, task: 'Quote RHH incl. freight', assignee: 'Erin' } : t))
    const a = liveAgenda(agendaWith(item), { projects, tasks: [...changed, { id: 't5', projectId: 'p1', task: 'Book the trial', assignee: 'Ben' }], today })
    expect(itemPoints(a.items[2])).toEqual(['Quote RHH incl. freight — Erin', 'Book the trial — Ben'])
  })

  it('a task Erin took off stays off', () => {
    const a = liveAgenda(agendaWith({ id: 'i1', title: 'Drill guide', projectId: 'p1', points: [], hidden: ['t1'] }), { projects, tasks, today })
    expect(a.items[2].live.map(l => l.id)).toEqual(['t2'])
  })

  it('an item added before this is linked by its name and its copied lines give way', () => {
    const old = { id: 'i1', title: 'Brainlab drill guide', points: ['Order the drill guide — Mat', 'Ask Cody about freight — Brent', 'Erin typed this'] }
    const it3 = liveAgenda(agendaWith(old), { projects, tasks, today }).items[2]
    expect(it3.projectId).toBe('p1')
    expect(it3.points).toEqual(['Erin typed this'])
    expect(it3.live).toHaveLength(2)
  })

  it('never links a private-board project, and leaves other items alone', () => {
    const a = liveAgenda(agendaWith({ id: 'i1', title: 'Private thing', points: ['x'] }), { projects, tasks, today })
    expect(a.items[2]).toEqual({ id: 'i1', title: 'Private thing', points: ['x'] })
  })

  it('the link and hidden tasks are saved; the live points are not', () => {
    const saved = cleanAgenda(liveAgenda(agendaWith({ title: 'Drill guide', projectId: 'p1', points: [], hidden: ['t1'] }), { projects, tasks, today }))
    const it3 = saved.items.find(i => i.title === 'Drill guide')
    expect(it3).toMatchObject({ projectId: 'p1', hidden: ['t1'], points: [] })
    expect(it3.live).toBeUndefined()
  })

  it('the printed agenda and the suggestion link both carry it', () => {
    const a = liveAgenda(agendaWith({ id: 'i1', title: 'Drill guide', projectId: 'p1', points: [] }), { projects, tasks, today })
    expect(agendaSections(a, null).find(s => s.title === 'Drill guide').points).toHaveLength(2)
    const sug = agendaSuggestions({ projects, tasks, today, current: { items: [] } })[0]
    expect(sug.projectId).toBe('p1')
    const added = editItems(agendaWith({ id: 'x', title: 'Other' }), { type: 'add', title: sug.title, points: sug.points, projectId: sug.projectId })
    expect(added.items.find(i => i.title === sug.title)).toMatchObject({ projectId: 'p1', points: [] })
    expect(agendaSuggestions({ projects, tasks, today, current: { items: [{ title: 'Renamed', projectId: 'p1' }] } })).toHaveLength(0)
  })

  it('words a task point', () => {
    expect(taskPoint({ task: 'X', assignee: 'Unassigned' }, today)).toBe('X')
  })
})
