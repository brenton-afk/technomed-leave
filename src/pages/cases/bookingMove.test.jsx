import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import BookingQueue from './BookingQueue.jsx'
import EditBooking from './EditBooking.jsx'

// ─── Task 5 on screen: a moved booking is offered as a move, and confirmed ───

let calls
let saveReply

const MOVED = {
  id: 'bk_9', status: 'pending', patient: 'Testa', surgeon: 'Ibbett',
  date: '2026-11-06', procedure: 'L4/5 TLIF', kit: 'CYLOX (Loan)', hospital: 'RHH',
  systems: ['CYLOX'], sources: ['rhh'], note: '',
  moves: { eventId: 'evt-1', from: '2026-11-04', summary: 'Testa CYLOX - Ibbett' }
}

const BOOKING = {
  id: 'evt-1', etag: '"v1"', summary: 'Testa CYLOX - Ibbett', description: '',
  fields: { surgeon: 'Ibbett', patient: 'Testa', procedure: 'L4/5 TLIF', kit: 'CYLOX (Loan)', hospital: 'RHH' },
  notes: '', start: '2026-11-04T10:00:00+11:00', end: '2026-11-04T11:00:00+11:00',
  allDay: false, colorId: null, reps: []
}

beforeEach(() => {
  calls = []
  saveReply = null
  global.fetch = vi.fn(async (url, init) => {
    url = String(url)
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push({ url, body })
    if (url.includes('action=queue')) return { ok: true, status: 200, json: async () => ({ ok: true, pending: [MOVED] }) }
    if (url.includes('action=booking')) return { ok: true, status: 200, json: async () => BOOKING }
    if (url.includes('action=week')) return { ok: true, status: 200, json: async () => ({ events: [] }) }
    if (url.includes('action=save')) return saveReply
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  })
})
afterEach(() => vi.restoreAllMocks())

describe('the queue', () => {
  it('says the case is already booked on another day, and offers to move it', async () => {
    render(<BookingQueue user={{ token: 't' }} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/Already booked for Wednesday 4 November/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Move it to Friday 6 November/ }))
    await waitFor(() => expect(calls.some(c => c.url.includes('action=accept'))).toBe(true))
    const accept = calls.find(c => c.url.includes('action=accept')).body
    expect(accept).toMatchObject({ id: 'bk_9', move: true, date: '2026-11-06' })
  })

  it('still lets somebody add it as a separate case', async () => {
    render(<BookingQueue user={{ token: 't' }} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/add it as a new booking/)).toBeInTheDocument())
    fireEvent.click(screen.getByText(/add it as a new booking/))
    await waitFor(() => expect(calls.some(c => c.url.includes('action=accept'))).toBe(true))
    expect(calls.find(c => c.url.includes('action=accept')).body.move).toBeUndefined()
  })
})

describe('the edit sheet', () => {
  async function moveIt() {
    render(<EditBooking eventId="evt-1" user={{ token: 't' }} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByDisplayValue('2026-11-04')).toBeInTheDocument())
    fireEvent.change(screen.getByDisplayValue('2026-11-04'), { target: { value: '2026-11-06' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))
  }

  it('confirms the new date once the calendar has it', async () => {
    saveReply = { status: 200, json: async () => ({
      ok: true, event: { ...BOOKING, etag: '"v2"', start: '2026-11-06T10:00:00+11:00', end: '2026-11-06T11:00:00+11:00' }
    }) }
    await moveIt()
    await waitFor(() => expect(screen.getByText(/Moved to Friday 2026-11-06/)).toBeInTheDocument())
  })

  it('shows a clear error when the calendar refused it', async () => {
    saveReply = { status: 502, json: async () => ({ error: 'The calendar did not take the new date (it still says 2026-11-04)' }) }
    await moveIt()
    await waitFor(() => expect(screen.getByText(/did not take the new date/)).toBeInTheDocument())
    expect(screen.queryByText(/Moved to/)).not.toBeInTheDocument()
  })
})
