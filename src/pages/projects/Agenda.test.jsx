import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'
import Agenda, { editItems } from './Agenda.jsx'

// Brent, 12 Nov 2026: "Get rid of the bot and give us an alternative way to
// edit easily." Erin taps the date, time, who is coming and the items on.

const ERIN = { email: 'erin@technomed.com.au', token: 't' }
const base = {
  title: 'TechnoMed Staff Meeting', date: '2026-11-25', time: '9:00am', location: '', version: 4, attendees: '', apologies: '',
  items: [{ id: 'w', title: 'Welcome and apologies', points: [] }, { id: 'g', title: 'General business', points: [] },
    { id: 'a', title: 'Spine update', points: ['Drill guide'], lead: 'Mat' }, { id: 'b', title: 'Christmas', points: [] },
    { id: 'n', title: 'Next meeting', points: [] }]
}

afterEach(() => vi.restoreAllMocks())

describe('editing the items', () => {
  it('moves only between the standing items, never past them', () => {
    expect(editItems(base, { type: 'move', id: 'b', dir: -1 }).items.map(i => i.id)).toEqual(['w', 'g', 'b', 'a', 'n'])
    expect(editItems(base, { type: 'move', id: 'a', dir: -1 })).toBe(base)
    expect(editItems(base, { type: 'remove', id: 'g' }).items).toHaveLength(5)
  })
  it('adds before Next meeting and changes one item', () => {
    const a = editItems(base, { type: 'add', title: 'Stock-take', points: ['Signus 1 Dec'] })
    expect(a.items.map(i => i.title).slice(-2)).toEqual(['Stock-take', 'Next meeting'])
    expect(editItems(base, { type: 'update', id: 'a', patch: { lead: 'Ben' } }).items[2].lead).toBe('Ben')
  })
})

describe('the agenda screen for Erin', () => {
  function serve() {
    const calls = []
    global.fetch = vi.fn(async (url, opts = {}) => {
      calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null })
      if (opts.method === 'PUT') {
        const b = JSON.parse(opts.body)
        return { ok: true, status: 200, json: async () => ({ agenda: { ...b.agenda, version: b.version + 1 }, suggestions: [] }) }
      }
      return { ok: true, status: 200, json: async () => ({ agenda: base, actions: null, canEdit: true,
        suggestions: [{ key: 'project:p1', kind: 'project', title: 'CYLOX rollout', points: ['Chase plate — Mat (overdue)'], lead: 'Mat', note: '1 open · 1 overdue' }] }) }
    })
    return calls
  }

  it('has no chat; a tapped suggestion goes on with its points', async () => {
    const calls = serve()
    render(<Agenda user={ERIN} today="2026-11-12" onClose={() => {}} />)
    await screen.findByText('CYLOX rollout')
    expect(screen.queryByLabelText('Message Claude')).toBeNull()
    fireEvent.click(screen.getByText('CYLOX rollout').closest('button'))
    await waitFor(() => expect(calls.some(c => c.method === 'PUT')).toBe(true))
    const put = calls.find(c => c.method === 'PUT').body
    expect(put.version).toBe(4)
    expect(put.agenda.items.find(i => i.title === 'CYLOX rollout')).toMatchObject({ points: ['Chase plate — Mat (overdue)'], lead: 'Mat' })
  })

  it('a time is one tap, and an edited point saves', async () => {
    const calls = serve()
    render(<Agenda user={ERIN} today="2026-11-12" onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '10:00am' }))
    await waitFor(() => expect(calls.filter(c => c.method === 'PUT')).toHaveLength(1))
    expect(calls.find(c => c.method === 'PUT').body.agenda.time).toBe('10:00am')
    const point = screen.getByDisplayValue('Drill guide')
    fireEvent.change(point, { target: { value: 'Drill guide sample arrived' } })
    fireEvent.blur(point)
    await waitFor(() => expect(calls.filter(c => c.method === 'PUT')).toHaveLength(2))
    const second = calls.filter(c => c.method === 'PUT')[1].body
    expect(second.version).toBe(5)
    expect(second.agenda.items.find(i => i.id === 'a').points).toEqual(['Drill guide sample arrived'])
  })
})
