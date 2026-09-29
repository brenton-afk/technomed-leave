import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import ListOrders from './ListOrder.jsx'

// Tomorrow at RHH, as the hospital gave it on the ring-round: 1. an ACDF using a
// competitor's cage, 2. Kon, 3. Rowe. Our calendar has Rowe first and Kon
// second, which is the point — the booking order is not the list order.

const CASES = [
  { id: 'rowe', patient: 'Rowe', surgeon: 'Dubey', hospital: 'RHH', operation: 'L4/5 fusion', system: 'DIPLOMAT', notes: ['Theatre 11. All-day list.'] },
  { id: 'kon', patient: 'Kon', surgeon: 'Fowler', hospital: 'RHH', operation: 'C3 corpectomy', system: 'ATHLET + ASCOT', notes: ['Theatre 11'] }
]

let saved

function serving(lists = {}) {
  saved = null
  global.fetch = vi.fn(async (url, init) => {
    if (init?.method === 'POST') {
      saved = JSON.parse(init.body)
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, lists }) }
  })
}

beforeEach(() => serving())
afterEach(() => vi.restoreAllMocks())

const show = (props = {}) =>
  render(<ListOrders date="2026-09-30" cases={CASES} user={{ token: 't' }} {...props} />)

describe('before anyone has rung the hospital', () => {
  it('says the order is not taken, rather than showing a made-up one', async () => {
    show()
    await waitFor(() => expect(screen.getByText(/Order not taken yet/)).toBeInTheDocument())
  })

  it('names the list by theatre, not by surgeon', async () => {
    // Kon is Fowler operating on Dubey's list. One theatre, one queue.
    show()
    await waitFor(() => expect(screen.getByText('RHH · Theatre 11')).toBeInTheDocument())
  })
})

describe('once the order is in', () => {
  const RECORDED = {
    '2026-09-30:RHH:11': {
      hospital: 'RHH',
      theatre: '11',
      entries: [
        { kind: 'other', label: 'ACDF — competitor cage' },
        { kind: 'ours', eventId: 'kon' },
        { kind: 'ours', eventId: 'rowe' }
      ],
      updatedBy: 'Brent'
    }
  }

  it("shows the hospital's order, not the calendar's", async () => {
    serving(RECORDED)
    show()
    await waitFor(() => expect(screen.getByText('ACDF — competitor cage')).toBeInTheDocument())
    const rows = screen.getAllByText(/^[123]$/).map(n => n.textContent)
    expect(rows).toEqual(['1', '2', '3'])
  })

  it("answers the evening's question in one line", async () => {
    serving(RECORDED)
    show()
    await waitFor(() => expect(screen.getByText('Ours 2nd and 3rd up')).toBeInTheDocument())
  })

  it('says who took it', async () => {
    serving(RECORDED)
    show()
    await waitFor(() => expect(screen.getByText(/Taken by Brent/)).toBeInTheDocument())
  })

  it('calls out a case of ours that is first up', async () => {
    // The one outcome that costs somebody a 7:30 start.
    serving({
      '2026-09-30:RHH:11': {
        hospital: 'RHH', theatre: '11',
        entries: [{ kind: 'ours', eventId: 'rowe' }, { kind: 'other', label: 'ACDF' }]
      }
    })
    show()
    await waitFor(() =>
      expect(screen.getByText(/Ours is first up — on site by 07:30/)).toBeInTheDocument())
  })
})

describe('taking the order', () => {
  it('starts from the cases already on the list', async () => {
    show()
    await waitFor(() => expect(screen.getByText(/Set order/)).toBeInTheDocument())
    fireEvent.click(screen.getByText(/Set order/))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getAllByText('Ours')).toHaveLength(2)
  })

  it('takes a case that is not ours', async () => {
    show()
    await waitFor(() => expect(screen.getByText(/Set order/)).toBeInTheDocument())
    fireEvent.click(screen.getByText(/Set order/))
    const field = await screen.findByLabelText(/Add another case/)
    fireEvent.change(field, { target: { value: 'ACDF — competitor cage' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(screen.getByText('ACDF — competitor cage')).toBeInTheDocument())
  })

  it('reorders and saves what the hospital said', async () => {
    show()
    await waitFor(() => expect(screen.getByText(/Set order/)).toBeInTheDocument())
    fireEvent.click(screen.getByText(/Set order/))
    await screen.findByRole('dialog')

    // Rowe is first from the calendar; the hospital says Kon goes before it.
    fireEvent.click(screen.getAllByRole('button', { name: 'Move up' })[1])
    fireEvent.click(screen.getByRole('button', { name: 'Save the order' }))

    await waitFor(() => expect(saved).not.toBeNull())
    expect(saved.entries.map(e => e.eventId)).toEqual(['kon', 'rowe'])
    expect(saved.key).toBe('2026-09-30:RHH:11')
    expect(saved.theatre).toBe('11')
  })
})
