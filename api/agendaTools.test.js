import { describe, it, expect, vi } from 'vitest'
import { applyAgendaTool, runAgendaChat } from './_agendaTools.js'
import { cleanAgenda } from './_agenda.js'

const base = () => ({ ...cleanAgenda({ date: '2026-11-25', time: '9am', items: [
  { id: 'w', title: 'Welcome and apologies' }, { id: 'g', title: 'General business' },
  { id: 'c', title: 'CYLOX', points: ['Drill guide'] }, { id: 'n', title: 'Next meeting' }] }), version: 3 })

describe('agenda chat actions', () => {
  it('adds an item before Next meeting', () => {
    const out = applyAgendaTool(base(), 'add_item', { title: 'Christmas party', points: ['Venue'], lead: 'Erin' })
    expect(out.error).toBeUndefined()
    expect(out.agenda.items.map(i => i.title)).toEqual(['Welcome and apologies', 'General business', 'CYLOX', 'Christmas party', 'Next meeting'])
  })
  it('updates, appends points and removes by id or title', () => {
    let a = applyAgendaTool(base(), 'update_item', { id: 'c', add_points: ['Screwdriver'] }).agenda
    expect(a.items.find(i => i.id === 'c').points).toEqual(['Drill guide', 'Screwdriver'])
    a = applyAgendaTool(a, 'remove_item', { id: 'CYLOX' }).agenda
    expect(a.items.some(i => i.title === 'CYLOX')).toBe(false)
  })
  it('changes header details and refuses a bad date', () => {
    expect(applyAgendaTool(base(), 'set_details', { attendees: 'Erin Smallbon, Mat Usher' }).agenda.attendees).toBe('Erin Smallbon, Mat Usher')
    expect(applyAgendaTool(base(), 'set_details', { date: '25/11' }).error).toBeTruthy()
    expect(applyAgendaTool(base(), 'remove_item', { id: 'zzz' }).error).toBeTruthy()
  })
  it('starts a new agenda keeping standing items, points cleared', () => {
    const out = applyAgendaTool(base(), 'start_new_agenda', { date: '2026-12-09' })
    expect(out.newMeeting).toBe(true)
    expect(out.agenda.date).toBe('2026-12-09')
    expect(out.agenda.items.every(i => i.points.length === 0)).toBe(true)
  })
})

describe('the chat loop', () => {
  it('carries out tool calls and reports what was done, not what was said', async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [
        { type: 'tool_use', id: 't1', name: 'add_item', input: { title: 'Stock-take' } },
        { type: 'tool_use', id: 't2', name: 'set_details', input: { time: '10am' } }] })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Added Stock-take and moved it to 10am.' }] })
    const out = await runAgendaChat({ system: 's', messages: [{ role: 'user', content: 'x' }], agenda: base(), ask })
    expect(out.changes).toEqual(['Added "Stock-take"', 'Changed time'])
    expect(out.agenda.time).toBe('10am')
    expect(out.agenda.items.some(i => i.title === 'Stock-take')).toBe(true)
    const second = ask.mock.calls[1][0].request.messages
    expect(second.at(-1).content.map(r => r.tool_use_id)).toEqual(['t1', 't2'])
  })
  it('makes no change when Claude only talks', async () => {
    const ask = vi.fn().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'When is the meeting?' }] })
    const out = await runAgendaChat({ system: 's', messages: [{ role: 'user', content: 'x' }], agenda: base(), ask })
    expect(out.changes).toEqual([])
    expect(out.reply).toBe('When is the meeting?')
  })
})
