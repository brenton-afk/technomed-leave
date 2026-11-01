import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import NoticeSheet from './NoticeSheet.jsx'
import { offerNotices, clearNotices } from '../../notices.js'

const PREVIEW = { id: 'n_1_a', name: 'Signus', to: ['jhanson@signus.com.au'], cc: ['apolites@signus.com.au'],
  subject: 'New booking — Testa 6/11/2026 CLV — Ref TM-ABC123', text: 'Hi Signus team,\n\nA new case has been booked.' }

beforeEach(() => { global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, results: [{ id: 'n_1_a', ok: true, name: 'Signus' }] }) })) })
afterEach(() => { act(() => clearNotices()); vi.restoreAllMocks() })

describe('the notice sheet', () => {
  it('says who will be told and what, and sends only on Send', async () => {
    render(<NoticeSheet user={{ token: 't' }} />)
    act(() => offerNotices({ notices: [PREVIEW] }))
    expect(screen.getByText('These people will be notified')).toBeInTheDocument()
    expect(screen.getByText(/To jhanson@signus.com.au · cc apolites@signus.com.au/)).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByText('Sent to Signus')).toBeInTheDocument())
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ ids: ['n_1_a'] })
  })

  it('Don\'t send closes it and sends nothing', () => {
    render(<NoticeSheet user={{ token: 't' }} />)
    act(() => offerNotices({ notices: [PREVIEW] }))
    fireEvent.click(screen.getByRole('button', { name: "Don't send" }))
    expect(screen.queryByText('These people will be notified')).not.toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('stays out of the way when a change concerns no supplier', () => {
    render(<NoticeSheet user={{ token: 't' }} />)
    act(() => offerNotices({ ok: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
