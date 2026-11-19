import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'
import Agenda from '../pages/projects/Agenda.jsx'
import SavedAgendas from '../pages/projects/SavedAgendas.jsx'
import { freezeAgenda, blankAfter } from '../../api/_agenda.js'

// Brent, 19 Nov 2026: "We need a save button for meeting agendas and then they
// stay in the meetings tab as saved agendas … and then Erin should have a
// blank slate to build the next agenda from the projects list." Invented tasks.

afterEach(() => vi.restoreAllMocks())

const AGENDA = {
  title: 'TechnoMed Staff Meeting', date: '2026-11-25', time: '9:00am', location: 'Office', chair: 'Erin Smallbon',
  attendees: 'Erin, Mat', apologies: 'Ben', version: 7,
  items: [
    { id: 'w', title: 'Welcome and apologies', points: [] },
    { id: 'g', title: 'General business', points: [] },
    { id: 'p', title: 'Stock-take', projectId: 'p1', points: ['Erin typed this'], hidden: ['t2'],
      live: [{ id: 't1', text: 'Count Signus — Mat' }, { id: 't2', text: 'Hidden one' }] },
    { id: 'n', title: 'Next meeting', points: [] }
  ]
}

describe('freezing and the blank slate', () => {
  it('writes the live task points and outstanding actions in as text, hidden ones left out', () => {
    const f = freezeAgenda(AGENDA, { since: { date: '2026-11-11' }, notDone: [{ id: 'x', task: 'Chase plate', assignee: 'Mat Smith', due_date: '2026-11-20', overdue: true }] })
    expect(f.items.find(i => i.title === 'Stock-take')).toEqual({ id: 'p', title: 'Stock-take', lead: '', points: ['Count Signus — Mat', 'Erin typed this'] })
    expect(f.items.some(i => i.projectId || i.live)).toBe(false)
    expect(f.actions.notDone[0]).toEqual({ task: 'Chase plate', assignee: 'Mat Smith', due_date: '2026-11-20', overdue: true })
  })
  it('the next agenda keeps the standing items, time, place and attendees — no date, no apologies, no projects', () => {
    const b = blankAfter(AGENDA)
    expect(b.items.map(i => i.title)).toEqual(['Welcome and apologies', 'General business', 'Next meeting'])
    expect(b).toMatchObject({ date: '', time: '9:00am', location: 'Office', attendees: 'Erin, Mat', apologies: '' })
  })
})

describe('the screens', () => {
  it('Save asks first, then saves against the version shown', async () => {
    const calls = []
    global.fetch = vi.fn(async (url, opts = {}) => {
      calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null })
      if (String(url).includes('agenda-save')) {
        return { ok: true, status: 200, json: async () => ({ agenda: { ...blankAfter(AGENDA), version: 8 }, suggestions: [], saved: { id: 'x' } }) }
      }
      return { ok: true, status: 200, json: async () => ({ agenda: AGENDA, actions: null, canEdit: true, suggestions: [] }) }
    })
    render(<Agenda user={{ email: 'erin@technomed.com.au', token: 't' }} today="2026-11-19" onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save agenda' }))
    expect(calls.some(c => String(c.url).includes('agenda-save'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save and start the next' }))
    await screen.findByText(/A blank agenda is ready/)
    expect(calls.find(c => String(c.url).includes('agenda-save')).body).toEqual({ version: 7 })
  })

  it('lists saved agendas and opens one as it was saved', async () => {
    const saved = { ...freezeAgenda(AGENDA, null), id: '2026-11-25-abc', savedAt: '2026-11-25T01:00:00Z', savedBy: 'Erin' }
    global.fetch = vi.fn(async url => ({ ok: true, status: 200, json: async () => (String(url).includes('id=')
      ? { agenda: saved }
      : { agendas: [{ id: saved.id, title: saved.title, date: saved.date, time: '9:00am', savedBy: 'Erin', items: 4 }] }) }))
    render(<SavedAgendas user={{ token: 't' }} onClose={() => {}} />)
    fireEvent.click(await screen.findByText(/Wednesday 25 November 2026/))
    await screen.findByText('• Count Signus — Mat')
    expect(screen.queryByText(/Hidden one/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Download Word' })).toBeInTheDocument()
  })
})
