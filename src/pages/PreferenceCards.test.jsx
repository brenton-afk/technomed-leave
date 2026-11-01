import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PreferenceCards from './PreferenceCards.jsx'
import SEED from '../preferences/seed.js'

let canEdit
let posted
beforeEach(() => {
  canEdit = true
  posted = null
  global.fetch = vi.fn(async (url, init) => {
    if (init?.method === 'POST') {
      posted = JSON.parse(init.body)
      return { ok: true, json: async () => ({ version: 1, updatedBy: 'Aimee', updatedAt: '2026-11-01T08:00:00Z', data: SEED, canEdit }) }
    }
    return { ok: true, json: async () => ({ version: 0, updatedBy: 'Aimee (card of 28 Oct 2026)', data: SEED, canEdit }) }
  })
})
afterEach(() => vi.restoreAllMocks())

describe('the preference cards', () => {
  it('opens on the surgeon the booking named, with bold shown as bold', async () => {
    render(<PreferenceCards user={{ token: 't' }} focus="p-ibbett" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Ibbett', selected: true })).toBeInTheDocument())
    expect(screen.getAllByText('Dakota ACDF').length).toBeGreaterThan(0)
    expect(document.querySelector('strong')).toBeTruthy()
  })

  it('lets the clinical team edit a card and save it for everyone', async () => {
    render(<PreferenceCards user={{ token: 't' }} focus="p-dubey" onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Global PLIF' }))
    fireEvent.change(screen.getByLabelText('Preferences'), { target: { value: '**Osteotomes**\nNew line' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posted).toBeTruthy())
    expect(posted).toMatchObject({ baseVersion: 0, surgeonId: 'dubey', index: 0 })
    expect(posted.card.items).toEqual(['**Osteotomes**', 'New line'])
  })

  it('is read-only for everybody else', async () => {
    canEdit = false
    render(<PreferenceCards user={{ token: 't' }} focus="p-dubey" onClose={() => {}} />)
    await waitFor(() => expect(screen.getAllByText('Global PLIF').length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
  })
})
