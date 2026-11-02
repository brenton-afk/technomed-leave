import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import NoticeSheet from './NoticeSheet.jsx'
import { offerNotices, clearNotices } from '../../notices.js'

const PREVIEW = { id: 'n_1_a', name: 'Signus', to: ['jhanson@signus.com.au'], cc: ['apolites@signus.com.au'],
  subject: 'New booking — Testa 6/11/2026 CLV', text: 'Hi Signus team,\n\nA new case has been booked.' }

beforeEach(() => { global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, results: [{ id: 'n_1_a', ok: true, name: 'Signus' }] }) })) })
afterEach(() => { act(() => clearNotices()); vi.restoreAllMocks() })

describe('the notice sheet', () => {
  it('says who will be told and what, and sends only on Send', async () => {
    render(<NoticeSheet user={{ token: 't' }} />)
    act(() => offerNotices({ notices: [PREVIEW] }))
    expect(screen.getByText('Emails ready to send — check them first')).toBeInTheDocument()
    expect(screen.getByText(/To jhanson@signus.com.au · cc apolites@signus.com.au/)).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send it' }))
    await waitFor(() => expect(screen.getByText('Sent to Signus')).toBeInTheDocument())
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ ids: ['n_1_a'], edits: {} })
  })

  it('Don\'t send closes it and sends nothing', () => {
    render(<NoticeSheet user={{ token: 't' }} />)
    act(() => offerNotices({ notices: [PREVIEW] }))
    fireEvent.click(screen.getByRole('button', { name: "Don't send any" }))
    expect(screen.queryByText('Emails ready to send — check them first')).not.toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  // "I need to be able to see the email drafts going to the distributors and
  // decide whether to send them or not (and ideally be able to edit them)."
  it('sends only the ticked ones, with the wording as edited', async () => {
    const other = { ...PREVIEW, id: 'n_2_b', name: 'Device Technologies — loan set request', to: ['DL_VICLoans@device.com.au'], cc: [] }
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, results: [{ id: 'n_2_b', ok: true, name: other.name }] }) }))
    render(<NoticeSheet user={{ token: 't' }} />)
    act(() => offerNotices({ notices: [PREVIEW, other] }))
    fireEvent.click(screen.getByLabelText('Send to Signus'))
    fireEvent.click(screen.getAllByRole('button', { name: /Read or edit the email/ })[1])
    fireEvent.change(screen.getByLabelText(`The email to ${other.name}`), { target: { value: 'Please send Mariner MIS.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send 1 of 2' }))
    await waitFor(() => expect(screen.getByText(`Sent to ${other.name}`)).toBeInTheDocument())
    expect(screen.getByText('Not sent to Signus — you left it unticked')).toBeInTheDocument()
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ ids: ['n_2_b'], edits: { n_2_b: { text: 'Please send Mariner MIS.' } } })
  })

  it('stays out of the way when a change concerns no supplier', () => {
    render(<NoticeSheet user={{ token: 't' }} />)
    act(() => offerNotices({ ok: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
