import { describe, it, expect } from 'vitest'
import { cleanAgenda, canEditAgenda, isAgendaFile, draftMaterial, agendaActions, newAgendaFor, agendaChatPrompt } from './_agenda.js'
import { agendaText } from '../src/pages/projects/Agenda.jsx'

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
    expect(a.items.map(i => i.title)).toEqual(['Welcome and apologies', 'Stocktake planning'])
    expect(a.items[1].points).toEqual(['Signus from 1 Dec', 'E4 on 27 Jan'])
    expect(cleanAgenda({ date: 'next week' }).date).toBe('')
    expect(agendaText(a)).toContain('2. Stocktake planning\n   • Signus from 1 Dec')
  })
  it('imports only agenda Word documents', () => {
    expect(isAgendaFile('TechnoMed_Staff_Meeting_Agenda_12_November_2026.docx')).toBe(true)
    expect(isAgendaFile('Minutes.docx')).toBe(false)
    expect(isAgendaFile('Agenda.pdf')).toBe(false)
  })
  it('gives the draft the recent agendas and the work since the last meeting', () => {
    const m = draftMaterial({
      past: [{ date: '2026-11-10', subject: 'Staff meeting agenda', text: 'Agenda\n1 Welcome' }],
      report: { from: '2026-11-12', meeting: { title: 'Staff meeting' }, totals: { done: 1, items: 2, open: 1 },
        done: [{ task: 'Book stocktake', assignee: 'Toni', doneOn: '2026-11-20' }], open: [{ task: 'Order cages', assignee: 'Mat', due_date: '2026-12-01' }], earlier: [], other: [] }
    })
    expect(m.recent).toContain('Staff meeting agenda')
    expect(m.work).toContain('1 of 2 action items done')
    expect(m.work).toContain('- Order cages (Mat, due 2026-12-01)')
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
  it('lists what was done and what was not, overdue first, never from the model', () => {
    const a = agendaActions(report)
    expect(a.done.map(t => t.task)).toEqual(['Book stocktake', 'Torque limiters'])
    expect(a.alsoDone).toHaveLength(1)
    expect(a.notDone.map(t => t.task)).toEqual(['Chase plate ETA', 'Christmas roster'])
    expect(agendaActions(null)).toBe(null)
  })
  it('starts a new agenda from a date and time, carrying the standing items over empty', () => {
    const prev = cleanAgenda({ title: 'TechnoMed Staff Meeting', location: 'Office', items: [{ title: 'Welcome', lead: 'Erin', points: ['old point'] }, { title: 'Spine update', lead: 'Mat' }] })
    const next = newAgendaFor({ date: '2026-11-25', time: '9:00am', previous: prev })
    expect(next).toMatchObject({ date: '2026-11-25', time: '9:00am', location: 'Office' })
    expect(next.items.map(i => [i.title, i.lead, i.points.length])).toEqual([['Welcome', 'Erin', 0], ['Spine update', 'Mat', 0]])
    expect(newAgendaFor({ date: '2026-11-25' }).items.map(i => i.title)).toContain('General business')
  })
  it('gives the chat the not-completed list and the agenda, and tells it not to copy the lists', () => {
    const prompt = agendaChatPrompt({ agenda: cleanAgenda({ items: [{ title: 'Welcome' }] }), actions: agendaActions(report), staff: ['Erin Smallbon'], today: '2026-11-12' })
    expect(prompt).toContain('Chase plate ETA (Mat Usher, due 2026-11-09, OVERDUE)')
    expect(prompt).toMatch(/do NOT copy these into items/)
    expect(prompt).toContain('"title":"Welcome"')
  })
  it('prints the two lists in the text copy', () => {
    const t = agendaText(cleanAgenda({ items: [{ title: 'Welcome' }] }), agendaActions(report))
    expect(t).toContain('Completed (2)')
    expect(t).toContain('○ Chase plate ETA — Mat, due')
  })
})
