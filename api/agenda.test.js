import { describe, it, expect } from 'vitest'
import { cleanAgenda, canEditAgenda, isAgendaFile, draftMaterial } from './_agenda.js'
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
