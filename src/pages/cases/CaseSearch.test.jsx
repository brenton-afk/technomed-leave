import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CaseSearch from './CaseSearch.jsx'

const RESULTS = [
  { id: 'future', date: '2099-02-01', patient: 'Testa', surgeon: 'Ibbett', operation: 'L4/5 TLIF', system: 'CYLOX', hospital: 'RHH' },
  { id: 'past', date: '2020-02-01', patient: 'Testa', surgeon: 'Ibbett', operation: 'ACDF', system: 'REFORM', hospital: 'CLV', cancelled: true }
]

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, results: RESULTS }) }))
})
afterEach(() => vi.restoreAllMocks())

describe('the search sheet', () => {
  it('searches as you type and splits coming up from past', async () => {
    render(<CaseSearch user={{ token: 't' }} onClose={() => {}} onOpen={() => {}} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'testa' } })
    await waitFor(() => expect(screen.getByText('Coming up')).toBeInTheDocument())
    expect(screen.getByText('Past')).toBeInTheDocument()
    expect(global.fetch.mock.calls[0][0]).toContain('action=search&q=testa')
  })

  it('opens the booking that was tapped', async () => {
    const onOpen = vi.fn()
    render(<CaseSearch user={{ token: 't' }} onClose={() => {}} onOpen={onOpen} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'testa' } })
    await waitFor(() => expect(screen.getByText(/ACDF/)).toBeInTheDocument())
    fireEvent.click(screen.getByText(/ACDF/))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'past' }))
  })

  it('says so when nothing matches', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, results: [] }) }))
    render(<CaseSearch user={{ token: 't' }} onClose={() => {}} onOpen={() => {}} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nobody' } })
    await waitFor(() => expect(screen.getByText(/No bookings found/)).toBeInTheDocument())
  })
})
