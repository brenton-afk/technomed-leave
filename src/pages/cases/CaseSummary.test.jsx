import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CaseSummary from './CaseSummary.jsx'

// Invented case. Toni, 4 Nov 2026: a summary at the top of the booking that
// can be copied into an email or chat, and stays current as fields change.
const booking = {
  patient: 'Sample', date: '2026-11-13', hospital: 'CLV', surgeon: 'Gupta',
  procedure: 'L4/5 PLIF', kit: 'Diplomat (Consignment)', planned: ['Mat'], reps: [], notes: ''
}

describe('case summary card', () => {
  it('shows the whole case, hospital and day included', () => {
    render(<CaseSummary booking={booking} />)
    expect(screen.getByText('Calvary')).toBeInTheDocument()
    expect(screen.getByText('Fri 13 Nov 2026')).toBeInTheDocument()
    expect(screen.getByText('Diplomat (Consignment)')).toBeInTheDocument()
  })

  it('follows an edit straight away', () => {
    const { rerender } = render(<CaseSummary booking={booking} />)
    rerender(<CaseSummary booking={{ ...booking, procedure: 'L4/5 TLIF' }} />)
    expect(screen.getByText('L4/5 TLIF')).toBeInTheDocument()
  })

  it('copies it as plain text', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<CaseSummary booking={booking} />)
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Copied/))
    expect(writeText.mock.calls[0][0]).toMatch(/^Patient: Sample\nDate: Fri 13 Nov 2026\nHospital: Calvary/)
  })
})

describe('on the booking (Brent, 4 Nov 2026)', () => {
  it('leaves the notes out — they are in their own field below', () => {
    render(<CaseSummary booking={{ ...booking, notes: 'Second on the list' }} />)
    expect(screen.queryByText('Second on the list')).not.toBeInTheDocument()
    expect(screen.queryByText('Notes')).not.toBeInTheDocument()
  })
})
