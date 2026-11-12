import { describe, it, expect } from 'vitest'
import { cleanAgenda, canEditAgenda, agendaActions, newAgendaFor } from './_agenda.js'
import { agendaSuggestions } from '../src/projects/agendaSuggest.js'
import { agendaText, cycleAttendance, splitNames } from '../src/pages/projects/Agenda.jsx'

// Brent, 11 Nov 2026: a live agenda everyone can see, only Erin edits,
// drafted from her earlier agendas and the work since the last meeting.
describe('the agenda', () => {
  it('only Erin edits it', () => {
    expect(canEditAgenda('erin@technomed.com.au')).toBe(true)
    expect(canEditAgenda('brenton@technomed.com.au')).toBe(false)
    expect(canEditAgenda('mat@technomed.com.au')).toBe(false)
  })
  it('is held to Erin\'s shape: header, numbered items with points and a lead', () => {
    const a = cleanAgenda({ date: '2026-12-10', time: '12:00pm', items: [
      { title: 'Welcome and apologies', lead: 'Erin' },
      { title: 'Stocktake planning', points: 'Signus from 1 Dec\n\nE4 on 27 Jan' },
      { title: '' }
    ] })
    expect(a.items.map(i => i.title)).toEqual(['Welcome and apologies', 'General business', 'Stocktake planning', 'Next meeting'])
    expect(a.items[2].points).toEqual(['Signus from 1 Dec', 'E4 on 27 Jan'])
    expect(cleanAgenda({ date: 'next week' }).date).toBe('')
    expect(agendaText(a)).toContain('4. Stocktake planning\n   • Signus from 1 Dec')
  })
})

// Brent, 12 Nov 2026: the agenda is written from the projects report — what
// was done, and a section for what was not — set up from a date and time,
// built and changed by chatting with Claude.
describe('the agenda from the report', () => {
  const report = {
    from: '2026-10-28', to: '2026-11-12', meeting: { title: 'Staff meeting' },
    done: [{ task: 'Book stocktake', assignee: 'Toni Hoppitt', doneOn: '2026-11-03' }],
    earlierDone: [{ task: 'Torque limiters', assignee: 'Ben Cassidy', doneOn: '2026-11-01' }],
    other: [{ task: 'Order cages', assignee: 'Mat Usher', doneOn: '2026-11-05' }],
    open: [{ task: 'Christmas roster', assignee: 'Erin Smallbon', due_date: '2026-11-20', overdue: false }],
    earlier: [{ task: 'Chase plate ETA', assignee: 'Mat Usher', due_date: '2026-11-09', overdue: true }]
  }
  it('puts only what is NOT done on the agenda, overdue first, never from the model', () => {
    const a = agendaActions(report)
    expect(a.done).toBeUndefined()
    expect(a.notDone.map(t => t.task)).toEqual(['Chase plate ETA', 'Christmas roster'])
    expect(agendaActions(null)).toBe(null)
  })
  it('keeps welcome and general business at the top and next meeting at the bottom', () => {
    const a = cleanAgenda({ items: [{ title: 'Next meeting' }, { title: 'Spine update' }, { title: 'General business' }, { title: 'Welcome and apologies' }] })
    expect(a.items.map(i => i.title)).toEqual(['Welcome and apologies', 'General business', 'Spine update', 'Next meeting'])
    expect(cleanAgenda({ items: [{ title: 'Spine update' }] }).items.map(i => i.title))
      .toEqual(['Welcome and apologies', 'General business', 'Spine update', 'Next meeting'])
  })
  it('starts a new agenda from a date and time, carrying the standing items over empty', () => {
    const prev = cleanAgenda({ title: 'TechnoMed Staff Meeting', location: 'Office', items: [{ title: 'Welcome', lead: 'Erin', points: ['old point'] }, { title: 'Spine update', lead: 'Mat' }] })
    const next = newAgendaFor({ date: '2026-11-25', time: '9:00am', previous: prev })
    expect(next).toMatchObject({ date: '2026-11-25', time: '9:00am', location: 'Office' })
    expect(next.items.map(i => [i.title, i.lead, i.points.length])).toEqual([['Welcome', 'Erin', 0], ['General business', '', 0], ['Spine update', 'Mat', 0], ['Next meeting', '', 0]])
    expect(newAgendaFor({ date: '2026-11-25' }).items.map(i => i.title)).toContain('General business')
  })
  it('prints the outstanding actions as item 3, after general business, with no completed list', () => {
    const t = agendaText(cleanAgenda({ items: [{ title: 'Spine update' }] }), agendaActions(report))
    expect(t).toContain('3. Actions not yet completed')
    expect(t).toContain('○ Chase plate ETA — Mat, due')
    expect(t).not.toMatch(/Completed|Book stocktake/)
    expect(t.trim().split('\n').pop()).toBe('5. Next meeting')
  })
})

// Brent, 12 Nov 2026: "Get rid of the bot and give us an alternative way to
// edit easily" — items are tapped on from the projects and the last agenda.
describe('items to tap onto the agenda', () => {
  const projects = [
    { id: 'p1', name: 'CYLOX rollout', owner: 'Mat Usher' },
    { id: 'p2', name: 'Secret', private: true },
    { id: 'p3', name: 'Quiet project', owner: 'Erin Smallbon' }
  ]
  const tasks = [
    { projectId: 'p1', task: 'Chase plate ETA', assignee: 'Mat Usher', due_date: '2026-11-09', status: 'todo' },
    { projectId: 'p1', task: 'Book stock-take', assignee: 'Toni Hoppitt', due_date: '2026-12-01', status: 'todo' },
    { projectId: 'p1', task: 'Done already', status: 'done' },
    { projectId: 'p2', task: 'Hidden', status: 'todo' },
    { projectId: 'p3', task: 'Finished', status: 'done' }
  ]
  it('offers each project with open work, its open tasks as points, overdue first', () => {
    const s = agendaSuggestions({ projects, tasks, today: '2026-11-12' })
    expect(s.map(x => x.title)).toEqual(['CYLOX rollout'])
    expect(s[0]).toMatchObject({ lead: 'Mat', note: '2 open · 1 overdue' })
    expect(s[0].points).toEqual(['Chase plate ETA — Mat (overdue)', 'Book stock-take — Toni'])
  })
  it('offers the last agenda\'s own items, and nothing already on the agenda', () => {
    const previous = { items: [{ title: 'Welcome and apologies' }, { title: 'Christmas party', lead: 'Erin' }, { title: 'CYLOX rollout' }] }
    const current = { items: [{ title: 'CYLOX rollout' }] }
    const s = agendaSuggestions({ projects, tasks, previous, current, today: '2026-11-12' })
    expect(s.map(x => [x.title, x.kind])).toEqual([['Christmas party', 'last']])
  })
})

// Brent, 12 Nov 2026: "Attendees need to be buttons." 
describe('who is coming', () => {
  it('cycles a name: attending, apology, cleared', () => {
    let v = { attendees: 'Erin Smallbon', apologies: '' }
    v = cycleAttendance('Mat Usher', v)
    expect(splitNames(v.attendees)).toEqual(['Erin Smallbon', 'Mat Usher'])
    v = cycleAttendance('mat usher', v)
    expect(splitNames(v.attendees)).toEqual(['Erin Smallbon'])
    expect(splitNames(v.apologies)).toEqual(['mat usher'])
    v = cycleAttendance('Mat Usher', v)
    expect(v).toEqual({ attendees: 'Erin Smallbon', apologies: '' })
  })
})
