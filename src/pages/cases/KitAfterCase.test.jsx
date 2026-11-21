import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const offered = []
vi.mock('../../notices.js', () => ({ offerNotices: r => offered.push(r) }))
const { default: KitAfterCase } = await import('./KitAfterCase.jsx')

// Invented case. The screen asks, the server drafts, the notice sheet sends.
const kit = (over = {}) => ({ system: 'Reform Cervical', key: 'reform-cervical', kind: 'distributor', distributorName: 'E4 Surgical', site: 'CLV', siteName: 'Calvary',
  next: { id: 'b2', patient: 'Laterone', surgeon: 'Ankush', date: '2026-12-02' }, priority: true, decision: null, ...over })
let posts
beforeEach(() => {
  posts = []; offered.length = 0
  globalThis.fetch = vi.fn(async (url, opts) => {
    if (opts?.method === 'POST') {
      const body = JSON.parse(opts.body); posts.push(body)
      return { ok: true, json: async () => ({ ok: true, decision: body.outcome === 'priority' ? { priorityTagged: { by: 'Brent' } } : { outcome: body.outcome, by: 'Brent' }, notices: body.email ? [{ id: 'n_1', name: 'Calvary loans team' }] : [] }) }
    }
    return { ok: true, json: async () => ({ case: { id: 'c1', patient: 'Testcase', surgeon: 'JPW', date: '2026-12-01', hospital: 'Calvary' }, kits: [kit()] }) }
  })
})

describe('the kit after the case', () => {
  it('asks to hold the kit for the next case, drafts the hospital email, and asks for priority tags', async () => {
    render(<KitAfterCase user={{ token: 't' }} date="2026-12-01" surname="Testcase" />)
    await waitFor(() => expect(document.querySelector('[data-kit-after]')).toBeTruthy())
    expect(document.querySelector('[data-kit-after]')).toHaveTextContent('Are you holding onto the kit for pt Laterone')
    expect(document.querySelector('[data-kit-priority]')).toHaveTextContent('put priority tags on the trays')
    fireEvent.click(document.querySelector('[data-kit-hold]'))
    await waitFor(() => expect(document.querySelector('[data-kit-holding]')).toBeTruthy())
    expect(posts[0]).toMatchObject({ id: 'c1', key: 'reform-cervical', outcome: 'hold', email: true })
    expect(offered[0].notices[0].id).toBe('n_1')
    fireEvent.click(screen.getByText('Priority tags on'))
    await waitFor(() => expect(document.querySelector('[data-kit-priority-done]')).toBeTruthy())
  })
  it('with no later case, asks where it goes — back to the distributor', async () => {
    globalThis.fetch.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ case: { id: 'c1', patient: 'Testcase', date: '2026-12-01', hospital: 'Calvary' }, kits: [kit({ next: null, priority: false })] }) }))
    render(<KitAfterCase user={{ token: 't' }} date="2026-12-01" surname="Testcase" />)
    await waitFor(() => expect(document.querySelector('[data-kit-return]')).toBeTruthy())
    expect(document.querySelector('[data-kit-return]')).toHaveTextContent('Back to E4 Surgical')
    fireEvent.click(document.querySelector('[data-kit-return]'))
    await waitFor(() => expect(document.querySelector('[data-kit-returned]')).toBeTruthy())
  })
  it('shows nothing when no kit needs a decision', async () => {
    globalThis.fetch.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ case: null, kits: [] }) }))
    const { container } = render(<KitAfterCase user={{ token: 't' }} date="2026-12-01" surname="Testcase" />)
    await new Promise(r => setTimeout(r, 10))
    expect(container.querySelector('[data-kit-after]')).toBeNull()
  })
})
