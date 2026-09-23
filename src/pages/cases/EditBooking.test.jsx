import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import EditBooking, { staleTitle } from './EditBooking.jsx'

// This writes to the calendar the whole team reads during a list, so the tests
// are mostly about restraint: what it does *not* send, and what it refuses to
// overwrite.

const USER = { name: 'Brenton Lovering', email: 'brenton@technomed.com.au', token: 'tok' }

// The live 23 September booking, verbatim apart from the names.
const BOOKING = {
  id: 'evt-1',
  etag: '"v1"',
  summary: 'Marsh DIPLOMAT  - Ibbett',
  description: '\nSurg - Dr Ibbett\nPt - Marsh (Donna)\nDate - 23/09/2026\n'
    + 'Procedure - L5/S1 PLIF\nKit - Diplomat (Consignment) /Cascadia/AIRO\n'
    + 'Hospital - Calvary Lenah Valley',
  fields: {
    surgeon: 'Dr Ibbett',
    patient: 'Marsh',           // surname only — "(Donna)" is not sent to the portal
    procedure: 'L5/S1 PLIF',
    kit: 'Diplomat (Consignment) /Cascadia/AIRO',
    hospital: 'Calvary Lenah Valley'
  },
  notes: ''
}

let saved
let saveStatus

beforeEach(() => {
  saved = null
  saveStatus = 200
  global.fetch = vi.fn(async (url, init) => {
    if (String(url).includes('action=booking')) {
      return { status: 200, json: async () => BOOKING }
    }
    saved = JSON.parse(init.body)
    if (saveStatus === 409) {
      return { status: 409, json: async () => ({ error: 'changed in Google', code: 'conflict' }) }
    }
    return {
      status: 200,
      json: async () => ({ ok: true, event: { ...BOOKING, summary: BOOKING.summary } })
    }
  })
})

afterEach(() => vi.restoreAllMocks())

const show = (props = {}) =>
  render(<EditBooking eventId="evt-1" user={USER} onClose={() => {}} {...props} />)

async function ready() {
  await waitFor(() => expect(screen.getByDisplayValue('L5/S1 PLIF')).toBeInTheDocument())
}

describe('opening a booking', () => {
  it('loads it fresh from the calendar', async () => {
    show()
    await ready()
    // Not the case object the week plan built: that holds derived values — the
    // system uppercased, the supply lifted out of the kit line — and saving
    // those would write the app's rendering back over what the team typed.
    expect(global.fetch.mock.calls[0][0]).toContain('action=booking')
    expect(screen.getByDisplayValue('Diplomat (Consignment) /Cascadia/AIRO')).toBeInTheDocument()
  })

  it('shows the surname and not the first name', async () => {
    show()
    await ready()
    expect(screen.getByDisplayValue('Marsh')).toBeInTheDocument()
    expect(screen.queryByDisplayValue(/Donna/)).not.toBeInTheDocument()
  })

  it('will not save until something changes', async () => {
    show()
    await ready()
    expect(screen.getByRole('button', { name: /Save to calendar/ })).toBeDisabled()
  })
})

describe('saving', () => {
  it('sends only the field that changed', async () => {
    show()
    await ready()
    fireEvent.change(screen.getByDisplayValue('L5/S1 PLIF'), { target: { value: 'L4/5 TLIF' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))

    await waitFor(() => expect(saved).toBeTruthy())
    // Everything else is left out. A field sent unchanged is a field a round
    // trip can quietly reformat for no reason.
    expect(saved.fields).toEqual({ procedure: 'L4/5 TLIF' })
    expect(saved.eventId).toBe('evt-1')
  })

  it('sends the version marker, so a collision is caught', async () => {
    show()
    await ready()
    fireEvent.change(screen.getByDisplayValue('L5/S1 PLIF'), { target: { value: 'L4/5 TLIF' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))
    await waitFor(() => expect(saved).toBeTruthy())
    expect(saved.etag).toBe('"v1"')
  })

  it('does not touch the title unless asked', async () => {
    show()
    await ready()
    fireEvent.change(screen.getByDisplayValue('L5/S1 PLIF'), { target: { value: 'L4/5 TLIF' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))
    await waitFor(() => expect(saved).toBeTruthy())
    expect(saved.summary).toBeUndefined()
  })

  it('closes when it is done', async () => {
    const onClose = vi.fn()
    show({ onClose })
    await ready()
    fireEvent.change(screen.getByDisplayValue('L5/S1 PLIF'), { target: { value: 'L4/5 TLIF' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('tells the week to reload from the calendar', async () => {
    // Rather than patching what is on screen from the response: the plan derives
    // a case from the whole week, and a save can change how it groups.
    const onSaved = vi.fn()
    show({ onSaved })
    await ready()
    fireEvent.change(screen.getByDisplayValue('L5/S1 PLIF'), { target: { value: 'L4/5 TLIF' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })
})

describe('when somebody else got there first', () => {
  it('says so, and does not pretend it saved', async () => {
    saveStatus = 409
    const onClose = vi.fn()
    show({ onClose })
    await ready()
    fireEvent.change(screen.getByDisplayValue('L5/S1 PLIF'), { target: { value: 'L4/5 TLIF' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))

    expect(await screen.findByText(/changed this booking in Google/)).toBeInTheDocument()
    // The sheet stays open. Closing it would lose the edit and leave the person
    // believing it landed.
    expect(onClose).not.toHaveBeenCalled()
  })

  it('offers to reload theirs rather than overwrite it', async () => {
    saveStatus = 409
    show()
    await ready()
    fireEvent.change(screen.getByDisplayValue('L5/S1 PLIF'), { target: { value: 'L4/5 TLIF' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))
    expect(await screen.findByRole('button', { name: /Reload theirs/ })).toBeInTheDocument()
  })
})

describe('a title left behind by an edit', () => {
  // The title is what shows in Google's month view, so a booking whose title
  // says Fowler and whose description says Ibbett contradicts itself.
  it('is spotted when the surgeon changes', () => {
    const stale = staleTitle('Chalmers DIPLOMAT - Fowler (Mat)',
      { surgeon: 'Fowler' }, { surgeon: 'Ibbett' })
    expect(stale.proposed).toBe('Chalmers DIPLOMAT - Ibbett (Mat)')
  })

  it('is spotted when the patient changes', () => {
    const stale = staleTitle('Chalmers DIPLOMAT - Fowler',
      { patient: 'Chalmers' }, { patient: 'Marsh' })
    expect(stale.proposed).toBe('Marsh DIPLOMAT - Fowler')
  })

  it('says nothing when the title already agrees', () => {
    expect(staleTitle('Chalmers DIPLOMAT - Ibbett',
      { surgeon: 'Fowler' }, { surgeon: 'Ibbett' })).toBeNull()
  })

  it('says nothing when nothing changed', () => {
    expect(staleTitle('Chalmers DIPLOMAT - Fowler',
      { surgeon: 'Fowler' }, { surgeon: 'Fowler' })).toBeNull()
  })

  it('will not corrupt a word that merely contains the old value', () => {
    // "Al" inside "Calvary" is not the surgeon. A substring replace here would
    // write "Calvary" as "Cibbettvary" into a live booking.
    expect(staleTitle('Calvary list - Al', { surgeon: 'Al' }, { surgeon: 'Ibbett' }).proposed)
      .toBe('Calvary list - Ibbett')
  })

  it('is offered, never applied on its own', async () => {
    // The description saves either way. The title is a second, explicit step —
    // rewriting it automatically would silently reformat titles people wrote by
    // hand, and anything unusual in one would be lost.
    show()
    await ready()
    fireEvent.change(screen.getByDisplayValue('Dr Ibbett'), { target: { value: 'Fowler' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))

    expect(await screen.findByText(/The title still says/)).toBeInTheDocument()
    expect(saved.summary).toBeUndefined()

    fireEvent.click(screen.getByRole('button', { name: 'Update title' }))
    await waitFor(() => expect(saved.summary).toBe('Marsh DIPLOMAT  - Fowler'))
  })

  it('can be left alone', async () => {
    const onClose = vi.fn()
    show({ onClose })
    await ready()
    fireEvent.change(screen.getByDisplayValue('Dr Ibbett'), { target: { value: 'Fowler' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))
    await screen.findByText(/The title still says/)

    fireEvent.click(screen.getByRole('button', { name: 'Leave it' }))
    expect(onClose).toHaveBeenCalled()
  })
})
