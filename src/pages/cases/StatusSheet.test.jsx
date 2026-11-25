import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import StatusSheet from './StatusSheet.jsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const stub = calls => vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
  calls.push({ url, opts })
  if (opts.method === 'POST') return { ok: true, json: async () => ({ entry: { id: 'e1' } }) }
  return { ok: true, json: async () => ({ entries: [], mayEdit: true }) }
}))

describe('Add status (option B, Brent 25 Nov 2026)', () => {
  it('offers the five statuses and saves a training trip with where', async () => {
    const calls = []; stub(calls)
    const onSaved = vi.fn(); const onClose = vi.fn()
    render(<StatusSheet user={{ token: 't' }} date="2026-11-26" onClose={onClose} onSaved={onSaved} />)
    for (const k of ['theatre', 'office', 'training', 'away', 'leave']) expect(document.querySelector(`[data-status-kind="${k}"]`)).toBeTruthy()
    fireEvent.click(document.querySelector('[data-status-person="Aimee"]'))
    fireEvent.click(document.querySelector('[data-status-kind="training"]'))
    fireEvent.change(screen.getByLabelText('Where'), { target: { value: 'Melbourne' } })
    fireEvent.click(document.querySelector('[data-status-save]'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const post = calls.find(c => c.opts.method === 'POST')
    expect(JSON.parse(post.opts.body)).toMatchObject({ email: 'aimee@technomed.com.au', kind: 'training', where: 'Melbourne', from: '2026-11-26', allDay: true })
    expect(onClose).toHaveBeenCalled()
  })

  it('asks why for Away, and says Leave shows as Leave only', () => {
    stub([])
    render(<StatusSheet user={{ token: 't' }} date="2026-11-26" email="mat@technomed.com.au" kind="away" onClose={() => {}} />)
    expect(document.querySelector('[data-status-reason="RDO"]')).toBeTruthy()
    fireEvent.click(document.querySelector('[data-status-kind="leave"]'))
    expect(document.querySelector('[data-status-leave-note]').textContent).toMatch(/"Leave" only/)
  })

  it('is no longer a + Away button on Cases — the strip has + Add', () => {
    const src = readFileSync(join(__dirname, '..', 'CaseWeek.jsx'), 'utf8')
    expect(src).not.toMatch(/data-add-away/)
    expect(src).toMatch(/<WhosWhere /)
  })
})
