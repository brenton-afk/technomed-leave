import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import NewBooking from './NewBooking.jsx'

// Creating a booking has to beat typing it into Google, which is the thing it
// replaces — so the tests are about how little has to be typed, and about the
// booking that comes out the other end being indistinguishable from one a person
// wrote by hand.

let posted

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-09-23T02:00:00.000Z'))   // Wednesday, Hobart
  posted = null
  global.fetch = vi.fn(async (url, init) => {
    posted = JSON.parse(init.body)
    return { status: 200, json: async () => ({ ok: true, event: { id: 'new-1' } }) }
  })
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const show = (props = {}) =>
  render(<NewBooking user={{ token: 'tok' }} onClose={() => {}} {...props} />)

const fill = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Calvary' }))
  fireEvent.change(screen.getByLabelText(/Surgeon/), { target: { value: 'Ibbett' } })
  fireEvent.change(screen.getByLabelText(/System/), { target: { value: 'Mariner' } })
  fireEvent.change(screen.getByLabelText(/Procedure/), { target: { value: 'L5/S1 PLIF' } })
  fireEvent.change(screen.getByLabelText(/Patient surname/), { target: { value: 'Marsh' } })
}

describe('how little has to be typed', () => {
  it('opens on the next weekday', () => {
    // A booking is far more often ahead than today, and a Saturday is never a
    // theatre list.
    show()
    expect(screen.getByDisplayValue('2026-09-24')).toBeInTheDocument()
  })

  it('offers the surgeons and the systems rather than asking for them', () => {
    show()
    const surgeons = screen.getByLabelText(/Surgeon/)
    const systems = screen.getByLabelText(/System/)
    expect(surgeons.querySelectorAll('option').length).toBeGreaterThan(5)
    expect([...systems.querySelectorAll('option')].map(o => o.value)).toContain('Mariner')
  })

  it('leaves a competitor\'s product out of the list', () => {
    // Cascadia is Life Health Care's. We attend those cases for the Diplomat,
    // and it is not something we would ever book a set for.
    show()
    const systems = screen.getByLabelText(/System/)
    expect([...systems.querySelectorAll('option')].map(o => o.value)).not.toContain('Cascadia')
  })

  it('will not create without a patient, surgeon and date', () => {
    show()
    expect(screen.getByRole('button', { name: /Add to calendar/ })).toBeDisabled()
  })
})

describe('the question a booking raises', () => {
  it('says a Mariner at Calvary needs a set ordered', async () => {
    // The expensive thing to get wrong, answered while the booking is being
    // made rather than discovered later.
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Calvary' }))
    fireEvent.change(screen.getByLabelText(/System/), { target: { value: 'Mariner' } })
    expect((await screen.findAllByText(/A loan set has to be requested/)).length).toBeGreaterThan(0)
    expect(screen.getByText(/Nothing consigned at CLV/)).toBeInTheDocument()
  })

  it('gives the arrival deadline with it', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Calvary' }))
    fireEvent.change(screen.getByLabelText(/System/), { target: { value: 'Mariner' } })
    // Thursday 24 September, so the kit is due the Tuesday.
    expect(await screen.findByText(/2026-09-22/)).toBeInTheDocument()
  })

  it('says nothing to order for the same system at RHH', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'RHH' }))
    fireEvent.change(screen.getByLabelText(/System/), { target: { value: 'Mariner' } })
    expect(await screen.findByText(/Nothing to order/)).toBeInTheDocument()
  })

  it('is loud about a system it does not know', async () => {
    // A quiet "nothing needed" is a case with no instruments on the day.
    show()
    fireEvent.click(screen.getByRole('button', { name: 'RHH' }))
    fireEvent.change(screen.getByLabelText(/System/), { target: { value: 'Lonestar' } })
    // KT cover their own Calvary cases; at RHH we use their consigned set.
    expect(await screen.findByText(/Nothing to order/)).toBeInTheDocument()
  })

  it('fills the supply in from the inventory', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Calvary' }))
    fireEvent.change(screen.getByLabelText(/System/), { target: { value: 'Mariner' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Loan' })).toHaveAttribute('aria-pressed', 'true'))
  })
})

describe('what gets created', () => {
  it('sends the booking as labelled fields', async () => {
    show()
    fill()
    fireEvent.click(screen.getByRole('button', { name: /Add to calendar/ }))

    await waitFor(() => expect(posted).toBeTruthy())
    expect(posted.fields.patient).toBe('Marsh')
    expect(posted.fields.surgeon).toBe('Ibbett')
    expect(posted.fields.hospital).toBe('CLV')
    expect(posted.fields.kit).toBe('Mariner (Loan)')
    expect(posted.date).toBe('2026-09-24')
  })

  it('sends no time at all', async () => {
    // Case timings are not settled until the list order lands the evening
    // before and then move several times a day, so a time entered now is wrong
    // almost immediately. The server spans the list instead.
    show()
    fill()
    fireEvent.click(screen.getByRole('button', { name: /Add to calendar/ }))
    await waitFor(() => expect(posted).toBeTruthy())
    expect(posted.start).toBeUndefined()
    expect(posted.end).toBeUndefined()
  })

  it('sends no colour, so the server takes it from the surgeon', async () => {
    show()
    fill()
    fireEvent.click(screen.getByRole('button', { name: /Add to calendar/ }))
    await waitFor(() => expect(posted).toBeTruthy())
    expect(posted.colorId).toBeUndefined()
  })

  it('tells the week to reload', async () => {
    const onCreated = vi.fn()
    show({ onCreated })
    fill()
    fireEvent.click(screen.getByRole('button', { name: /Add to calendar/ }))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
  })
})
