import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'
import Suggested, { assigneeFor, dueFor, taskFrom, splitByOwner } from './Suggested.jsx'

// Brent, 8 Nov 2026: suggestions from email and the portal land in My To Do,
// on his login first; nothing is ever emailed from the portal.

const USER = { email: 'brenton@technomed.com.au', token: 't' }
const KT = {
  id: 'email:t1:m1', ids: ['email:t1:m1', 'email:t2:m2'], source: 'email', mailbox: 'accounts@technomed.com.au', owner: 'toni',
  title: 'KT Medical October sales and commission report', ask: 'Check the report and send our commission invoice',
  detail: 'Ben Reynolds · October sales report', urgency: 'week', waitingDays: 2, link: 'https://mail.google.com/x', from: 'kt@ktmedical.com.au', subject: 'October sales report'
}

const MINE = { ...KT, owner: 'brent' }

afterEach(() => vi.restoreAllMocks())

describe('a suggestion becomes a to-do', () => {
  it('goes to the person it belongs to, else the person adding it', () => {
    expect(assigneeFor({ owner: 'toni' }, USER.email)).toBe('Toni Hoppitt')
    expect(assigneeFor({ owner: 'leader' }, USER.email)).toBe('Brenton Lovering')
  })
  it('is due today, within three days, or undated', () => {
    expect(dueFor({ urgency: 'today' }, '2026-11-09')).toBe('2026-11-09')
    expect(dueFor({ urgency: 'week' }, '2026-11-09')).toBe('2026-11-12')
    expect(dueFor({ urgency: 'later' }, '2026-11-09')).toBe('')
  })
  it('reads as the thing to do, with where it came from in the notes', () => {
    const t = taskFrom(KT, { me: USER.email, today: '2026-11-09' })
    expect(t).toMatchObject({ task: 'Check the report and send our commission invoice', assignee: 'Toni Hoppitt', due_date: '2026-11-12' })
    expect(t.notes).toMatch(/Email: https:\/\/mail\.google\.com/)
  })
})

describe('on the Projects page', () => {
  it('draws nothing for anyone not on the trial', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
    const { container } = render(<Suggested user={USER} today="2026-11-09" />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(container.querySelector('[data-suggested]')).toBeNull()
  })

  it('offers Add to my To Do, Open email, Later and Not needed on your own — never a reply to send', async () => {
    const sent = []
    global.fetch = vi.fn(async (url, init) => {
      sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
      return { ok: true, status: 200, json: async () => (String(url).includes('action=list') ? { items: [MINE], mine: ['brent'], stale: false } : { ok: true }) }
    })
    const added = vi.fn()
    render(<Suggested user={USER} today="2026-11-09" onAdded={added} />)
    await waitFor(() => expect(screen.getByText(/Check the report and send our commission invoice/)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Open email' })).toHaveAttribute('href', KT.link)
    expect(screen.queryByRole('button', { name: /reply|send/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add to my To Do' }))
    await waitFor(() => expect(added).toHaveBeenCalled())
    const task = sent.find(c => c.url.includes('action=add-task'))
    expect(task.body).toMatchObject({ assignee: 'Brenton Lovering', addedByEmail: USER.email })
    const mark = sent.find(c => c.url.includes('action=mark'))
    expect(mark.body).toMatchObject({ state: 'done', ids: KT.ids })
  })

  it("someone else's job is folded away apart from yours, with nothing that would act on it", async () => {
    const sent = []
    global.fetch = vi.fn(async (url, init) => {
      sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
      return { ok: true, status: 200, json: async () => (String(url).includes('action=list') ? { items: [KT], mine: ['brent'], stale: false } : { ok: true }) }
    })
    render(<Suggested user={USER} today="2026-11-09" />)
    await waitFor(() => expect(screen.getByText(/In other people's inboxes · Toni 1/)).toBeInTheDocument())
    expect(screen.getByText(/For you, from email and the portal · 0/)).toBeInTheDocument()
    expect(screen.queryByText(/Check the report/)).toBeNull()
    fireEvent.click(screen.getByText(/In other people's inboxes/))
    expect(screen.getByText(/Check the report/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add to/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Not needed' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Not mine' }))
    await waitFor(() => expect(sent.find(c => c.url.includes('action=mark'))?.body).toMatchObject({ state: 'wrong-person', ids: KT.ids }))
    expect(sent.some(c => c.url.includes('add-task'))).toBe(false)
  })
})

describe('whose it is', () => {
  it('your own name, and Team leader on a day you lead', () => {
    const r = splitByOwner([{ id: 1, owner: 'brent' }, { id: 2, owner: 'toni' }, { id: 3, owner: 'leader' }, { id: 4, owner: 'toni' }], ['brent', 'leader'])
    expect(r.ours.map(i => i.id)).toEqual([1, 3])
    expect(r.others).toEqual([{ owner: 'toni', items: [{ id: 2, owner: 'toni' }, { id: 4, owner: 'toni' }] }])
  })
})
