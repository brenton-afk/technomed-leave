import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import EditBooking, { staleTitle } from './EditBooking.jsx'

// ─── Task 4: multi-word surnames and the Edit booking glitches ───────────────
// Reported from a screenshot of Edit booking: the surname was cut to its first
// word, the edit "could not be saved", the sheet said "Somebody changed this
// booking in Google while you had it open" and "Moving this booking to…" when
// the date had not changed, and the kit hint named a system from nowhere.
//
// The last three were one bug. Saving a surname rewrites the title in a second
// pass. That pass read the booking from the render the save started in — the
// version marker from *before* the sheet's own first write — so Google refused
// it as a collision. And the first pass's response carried Google's
// {dateTime, timeZone} objects, which, merged over the loaded booking, left the
// date unreadable, so the sheet believed the booking was moving.
//
// The mock below returns the server's response in the server's real shape.
// The older suite's mock echoed the loaded booking back, which is how none of
// this was ever seen in a test.

const USER = { name: 'Toni Test', email: 'toni@technomed.com.au', token: 'tok' }

// Fake patient. A three-word surname with no particle in the list, so the
// title alone cannot say where it ends.
const BOOKING = {
  id: 'evt-9',
  etag: '"v1"',
  summary: 'Testa Rossa Bianca CYLOX - Ibbett',
  description: 'Surg - Dr Ibbett\nPt - Testa Rossa Bianca\nProcedure - L4/5 TLIF\nKit - CYLOX (Loan)\nHospital - RHH',
  fields: {
    surgeon: 'Dr Ibbett', patient: 'Testa Rossa Bianca', procedure: 'L4/5 TLIF',
    kit: 'CYLOX (Loan)', hospital: 'RHH'
  },
  notes: '',
  start: '2026-11-04T09:00:00+11:00',
  end: '2026-11-04T10:00:00+11:00',
  allDay: false,
  colorId: '5',
  reps: []
}

let calls
let version

beforeEach(() => {
  calls = []
  version = 1
  global.fetch = vi.fn(async (url, init) => {
    if (String(url).includes('action=booking')) return { status: 200, json: async () => BOOKING }
    if (String(url).includes('action=week')) {
      return { status: 200, json: async () => ({ events: [] }) }
    }
    const body = JSON.parse(init.body)
    calls.push(body)
    // Google's If-Match, faithfully: a stale marker is a 409.
    if (body.etag !== `"v${version}"`) {
      return { status: 409, json: async () => ({ error: 'changed', code: 'conflict' }) }
    }
    version += 1
    return {
      status: 200,
      json: async () => ({
        ok: true,
        event: {
          id: 'evt-9',
          summary: body.summary || BOOKING.summary,
          description: BOOKING.description,
          etag: `"v${version}"`,
          // What the server used to send: Google's objects, not strings.
          start: { dateTime: '2026-11-04T09:00:00+11:00', timeZone: 'Australia/Hobart' },
          end: { dateTime: '2026-11-04T10:00:00+11:00', timeZone: 'Australia/Hobart' }
        }
      })
    }
  })
})

afterEach(() => vi.restoreAllMocks())

const show = (props = {}) =>
  render(<EditBooking eventId="evt-9" user={USER} onClose={() => {}} {...props} />)

const ready = () => waitFor(() =>
  expect(screen.getByDisplayValue('Testa Rossa Bianca')).toBeInTheDocument())

describe('a booking with a three-word surname', () => {
  it('opens with the whole surname', async () => {
    show()
    await ready()
  })

  it('saves an edit to the surname, title and all, without a conflict', async () => {
    const onClose = vi.fn()
    show({ onClose })
    await ready()
    fireEvent.change(screen.getByDisplayValue('Testa Rossa Bianca'),
      { target: { value: 'Testa Rossa Bianchi' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.queryByText(/Somebody changed this booking/)).not.toBeInTheDocument()

    // Two passes: the fields, then the title — and the title pass carries the
    // marker the first pass got back, not the one the sheet opened with.
    expect(calls).toHaveLength(2)
    expect(calls[0].etag).toBe('"v1"')
    expect(calls[1].etag).toBe('"v2"')
    expect(calls[1].summary).toBe('Testa Rossa Bianchi CYLOX - Ibbett')
    // And it sends the title alone: no times, no fields resent.
    expect(calls[1].start).toBeUndefined()
    expect(calls[1].fields).toEqual({})
  })
})

describe('editing without changing the date', () => {
  it('never says the booking is moving', async () => {
    show()
    await ready()
    fireEvent.change(screen.getByDisplayValue('L4/5 TLIF'), { target: { value: 'L4/5 PLIF' } })
    expect(screen.queryByText(/Moving this booking/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].start).toBeUndefined()
    expect(screen.queryByText(/Moving this booking/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Somebody changed this booking/)).not.toBeInTheDocument()
  })

  it('still says so when the date really changes', async () => {
    show()
    await ready()
    fireEvent.change(screen.getByDisplayValue('2026-11-04'), { target: { value: '2026-11-05' } })
    expect(screen.getByText(/Moving this booking to/)).toBeInTheDocument()
  })
})

describe('the kit hint', () => {
  it('does not name another system under a booking that has one', async () => {
    show()
    await ready()
    expect(screen.getByDisplayValue('CYLOX (Loan)')).toBeInTheDocument()
    // The hint, not the system buttons — Diplomat is rightly one of those.
    expect(screen.queryByText(/for example "Diplomat/)).not.toBeInTheDocument()
  })

  it('shows the format, marked as an example, while the field is empty', async () => {
    show()
    await ready()
    fireEvent.change(screen.getByDisplayValue('CYLOX (Loan)'), { target: { value: '' } })
    expect(screen.getByText(/for example "Diplomat \(Consignment\)"/)).toBeInTheDocument()
  })
})

describe('the title follows the surname field', () => {
  it('completes a surname the title already has whole, without doubling it', () => {
    expect(staleTitle('Lloyd Jones DIPLOMAT - Ibbett',
      { patient: 'Lloyd' }, { patient: 'Lloyd Jones' })).toBeNull()
  })

  it('corrects a title spelled differently from the field', () => {
    // Field said Smith, title said Smyth; the field is corrected to Smithe and
    // the title follows it.
    const stale = staleTitle('Smyth DIPLOMAT - Ibbett', { patient: 'Smith' }, { patient: 'Smithe' })
    expect(stale.proposed).toBe('Smithe DIPLOMAT - Ibbett')
  })

  it('replaces a multi-word surname whole', () => {
    const stale = staleTitle('Van der Berg DIPLOMAT - Ibbett (Mat)',
      { patient: 'Van der Berg' }, { patient: 'Marsh' })
    expect(stale.proposed).toBe('Marsh DIPLOMAT - Ibbett (Mat)')
  })

  it('leaves a title that opens with CANCELLED for a person', () => {
    expect(staleTitle('CANCELLED - Smyth ACDF - Ibbett',
      { patient: 'Smith' }, { patient: 'Smithe' })).toBeNull()
  })
})

describe('the No F2F button', () => {
  it('writes the line the team writes by hand, and takes it off again', async () => {
    show()
    await ready()
    const button = screen.getByRole('button', { name: 'No F2F' })
    fireEvent.click(button)
    expect(screen.getByDisplayValue(/No F2F required/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'No F2F' }))
    expect(screen.queryByDisplayValue(/No F2F required/)).not.toBeInTheDocument()
  })
})
