import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import AwaySheet from './AwaySheet.jsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('+ Away (Brent, 24 Nov 2026)', () => {
  it('puts a training day on the calendar for the person chosen', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      calls.push({ url, opts })
      if (opts.method === 'POST') return { ok: true, json: async () => ({ entry: { id: 'e1' } }) }
      return { ok: true, json: async () => ({ entries: [], mayEdit: true }) }
    }))
    const onSaved = vi.fn(); const onClose = vi.fn()
    render(<AwaySheet user={{ token: 't' }} date="2026-11-26" onClose={onClose} onSaved={onSaved} />)
    fireEvent.click(document.querySelector('[data-away-person="Mat"]'))
    fireEvent.click(document.querySelector('[data-away-save]'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const post = calls.find(c => c.opts.method === 'POST')
    expect(post.url).toBe('/api/calendar/today?action=away')
    expect(JSON.parse(post.opts.body)).toMatchObject({ email: 'mat@technomed.com.au', reason: 'Training day', from: '2026-11-26', to: '2026-11-26', allDay: true })
    expect(onClose).toHaveBeenCalled()
  })

  it('offers RDO and lists what is coming up with Remove', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ entries: [
      { id: 'x', firstName: 'Ben', reason: 'RDO', from: '2026-12-01', to: '2026-12-01', allDay: true, byName: 'Toni Hoppitt' }
    ] }) })))
    render(<AwaySheet user={{ token: 't' }} date="2026-11-26" onClose={() => {}} />)
    expect(document.querySelector('[data-away-reason="RDO"]')).toBeTruthy()
    await waitFor(() => expect(document.querySelector('[data-away-entry]')).toBeTruthy())
    expect(screen.getByText('Ben — RDO')).toBeTruthy()
    expect(screen.getByText(/Tue 1 Dec · added by Toni/)).toBeTruthy()
  })

  it('shows + Away on Cases only for Brent, Erin and Toni', () => {
    const src = readFileSync(join(__dirname, '..', 'CaseWeek.jsx'), 'utf8')
    expect(src).toMatch(/onAway=\{mayAddAway\(user\?\.email\) \? setAddingAway : null\}/)
  })
})
