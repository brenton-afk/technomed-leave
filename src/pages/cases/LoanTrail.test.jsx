import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import LoanTrail from './LoanTrail.jsx'

// The loan set inside a booking: status, summary, facts, the emails and their
// attachments. Invented case.

const SET = {
  distributor: 'device', name: 'Device Technologies', systems: ['Mariner MIS'], searched: true,
  summary: { status: 'confirmed', summary: 'Requested by Brent on 2 Nov. Device confirmed the next day.',
    facts: [{ label: 'Arriving', value: 'CLV Wed 11 Nov, 9am' }] },
  emails: [
    { from: 'Brent', outgoing: true, subject: 'Loan set request — Mariner MIS', at: '2026-11-02T03:00:00Z', text: 'Please send…', attachments: [] },
    { from: 'DL VIC Loans', outgoing: false, subject: 'RE: Loan set request', at: '2026-11-03T01:00:00Z', text: 'Confirmed.',
      attachments: [{ filename: 'tray list.pdf', mediaType: 'application/pdf', size: 52000, token: '11111111-2222-3333-4444-555555555555' }] }
  ]
}

afterEach(() => vi.restoreAllMocks())

// Each set is one line until tapped open.
async function openSet() {
  const header = await screen.findByRole('button', { expanded: false, name: /Loan set/ })
  fireEvent.click(header)
}

const serve = sets => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ sets }) }))
}

describe('LoanTrail', () => {
  it('shows where the set stands, what the emails say, and the emails', async () => {
    serve([SET])
    render(<LoanTrail eventId="evt1" user={{ token: 't' }} />)
    await waitFor(() => expect(screen.getByText('Confirmed')).toBeInTheDocument())
    // Folded: the set, the supplier and the status on one line.
    expect(screen.getByText('Mariner MIS · Device')).toBeInTheDocument()
    expect(screen.queryByText(/Device confirmed the next day/)).not.toBeInTheDocument()
    await openSet()
    expect(screen.getByText(/Device confirmed the next day/)).toBeInTheDocument()
    expect(screen.getByText('CLV Wed 11 Nov, 9am')).toBeInTheDocument()
    // The emails are folded away until asked for.
    expect(screen.queryByText('RE: Loan set request')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Show emails \(2\) · 1 attached/ }))
    expect(screen.getByText('RE: Loan set request')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tray list\.pdf · 51 KB/ })).toBeInTheDocument()
  })

  it('opens an email to read it', async () => {
    serve([SET])
    render(<LoanTrail eventId="evt1" user={{ token: 't' }} />)
    await openSet()
    fireEvent.click(screen.getByRole('button', { name: /Show emails/ }))
    fireEvent.click(screen.getByText('RE: Loan set request'))
    expect(screen.getByText('Confirmed.')).toBeInTheDocument()
  })

  it('says plainly when nothing was found', async () => {
    serve([{ ...SET, summary: null, emails: [] }])
    render(<LoanTrail eventId="evt1" user={{ token: 't' }} />)
    await openSet()
    await waitFor(() => expect(screen.getByText(/No emails with Device Technologies about this patient/)).toBeInTheDocument())
  })

  it('shows nothing on a booking with no distributor loan', async () => {
    serve([])
    const { container } = render(<LoanTrail eventId="evt1" user={{ token: 't' }} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await waitFor(() => expect(container.textContent).toBe(''))
  })
})
