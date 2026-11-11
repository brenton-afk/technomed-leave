import { describe, it, expect } from 'vitest'
import { meetingReport, reportText } from './report.js'

// Brent, 11 Nov 2026: a report of every action item from a meeting — done and
// still outstanding — for Erin to prepare the next one. Invented tasks only.
const M = { id: 'm1', title: 'Monthly team meeting', date: '2026-11-02' }
const items = [
  { id: 'a', task: 'Chase Signus invoice', assignee: 'Toni', status: 'done', doneAt: '2026-11-05T01:00:00Z', doneBy: 'Toni', sourceMeetingId: 'm1', sourceMeetingDate: '2026-11-02' },
  { id: 'b', task: 'Order trial cages', assignee: 'Mat', status: 'open', due_date: '2026-11-20', sourceMeetingId: 'm1', sourceMeetingDate: '2026-11-02' },
  { id: 'c', task: 'Update tray lists', assignee: 'Aimee', status: 'open', due_date: '2026-11-04', sourceMeetingId: 'm1', sourceMeetingDate: '2026-11-02' },
  { id: 'd', task: 'Old item', assignee: 'Ben', status: 'open', sourceMeetingId: 'm0', sourceMeetingDate: '2026-10-01', sourceMeetingTitle: 'October' },
  { id: 'e', task: 'Car service', assignee: 'Brent', status: 'done', doneAt: '2026-11-08T00:00:00Z' },
  { id: 'f', task: 'Done before the meeting', assignee: 'Brent', status: 'done', doneAt: '2026-10-20T00:00:00Z' },
  { id: 'g', task: 'Dropped idea', assignee: 'Erin', status: 'open', archived: true, sourceMeetingId: 'm1', sourceMeetingDate: '2026-11-02' }
]

describe('the meeting report', () => {
  const r = meetingReport(items, M, { to: '2026-11-11', today: '2026-11-11' })
  it('splits the meeting\'s items into done and outstanding, with overdue marked', () => {
    expect(r.done.map(t => t.id)).toEqual(['a'])
    expect(r.done[0].doneOn).toBe('2026-11-05')
    expect(r.open.map(t => t.id)).toEqual(['c', 'b'])
    expect(r.open.find(t => t.id === 'c').overdue).toBe(true)
    expect(r.totals).toEqual({ items: 4, done: 1, open: 2, overdue: 1 })
    expect(r.putAway.map(t => t.id)).toEqual(['g'])
  })
  it('carries earlier meetings\' open items and other tasks done in the period', () => {
    expect(r.earlier.map(t => t.id)).toEqual(['d'])
    expect(r.other.map(t => t.id)).toEqual(['e'])
  })
  it('reads as text for an email or the agenda', () => {
    const t = reportText(r)
    expect(t).toContain('1 of 4 done, 2 outstanding (1 overdue)')
    expect(t).toContain('Completed (1)')
    expect(t).toContain('• Order trial cages — Mat (due')
  })
})
