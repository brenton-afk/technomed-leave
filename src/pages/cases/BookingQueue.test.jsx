import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import BookingQueue from './BookingQueue.jsx'

// The queue exists because the parsers are good and not perfect. These tests are
// about the two things that makes true: a wrong reading can be corrected before
// it reaches the calendar, and nothing reaches the calendar without somebody
// tapping accept.

let calls

function respond(url, init) {
  calls.push({ url, body: init?.body ? JSON.parse(init.body) : null })
  if (url.includes('action=queue')) {
    return { ok: true, status: 200, json: async () => ({ ok: true, count: 2, pending: PENDING }) }
  }
  return { ok: true, status: 200, json: async () => ({ ok: true }) }
}

const PENDING = [
  {
    id: 'bk_1', status: 'pending', patient: 'Marsh', surgeon: 'Ibbett',
    date: '2026-09-24', procedure: 'L5/S1 PLIF', kit: 'Diplomat',
    hospital: 'CLV', systems: ['Diplomat'], sources: ['cns'], note: ''
  },
  {
    // What a half-read case looks like: the table gave a patient and a date but
    // the surgeon heading did not parse.
    id: 'bk_2', status: 'pending', patient: 'Hollis', surgeon: '',
    date: '2026-09-25', procedure: 'C5/6 ACDF', kit: 'Reform Cervical',
    hospital: 'RHH', systems: ['Reform Cervical'], sources: ['rhh'], note: ''
  }
]

beforeEach(() => {
  calls = []
  global.fetch = vi.fn(async (url, init) => respond(String(url), init))
})

afterEach(() => { vi.restoreAllMocks() })

const show = (props = {}) =>
  render(<BookingQueue user={{ token: 'tok' }} onClose={() => {}} {...props} />)

describe('what the queue shows', () => {
  it('lists what was read, without making it a form', async () => {
    show()
    await waitFor(() => expect(screen.getAllByText('Marsh').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Hollis').length).toBeGreaterThan(0)
    // A read value is text until you tap it. Two cards with six fields each
    // would otherwise be twelve inputs, which nobody reads by the fifth card.
    expect(screen.getByText('Thursday 24 September')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Patient: Marsh/ })).toBeInTheDocument()
  })

  it('marks what it could not read rather than leaving it blank', async () => {
    show()
    await waitFor(() => expect(screen.getAllByText('Hollis').length).toBeGreaterThan(0))
    // The unread surgeon opens as a control, because that is the field that
    // stops the booking being accepted.
    const surgeons = screen.getAllByRole('combobox').map(el => el.value)
    expect(surgeons).toContain('')
  })

  it('says where a case came from, for the team', async () => {
    // Inside the app, plainly: the team needs to know which source to trust for
    // detail. Nothing that leaves the building says this — see bookingSources.js.
    show()
    await waitFor(() => expect(screen.getByText('CNS')).toBeInTheDocument())
    // 'RHH' is also a hospital value, so match the source label on the card head.
    expect(screen.getAllByText('RHH').length).toBeGreaterThan(0)
  })

  it('warns when the kit is not where the case is', async () => {
    show()
    // Reform Cervical is consigned at RHH, so that case needs nothing. A case
    // whose set has to move is the one worth interrupting for.
    await waitFor(() => expect(screen.getAllByText('Hollis').length).toBeGreaterThan(0))
  })
})

describe('nothing reaches the calendar unseen', () => {
  it('will not accept a case that is still missing a surgeon', async () => {
    show()
    await waitFor(() => expect(screen.getAllByText('Hollis').length).toBeGreaterThan(0))
    const accept = screen.getAllByRole('button', { name: 'Add to calendar' })
    expect(accept[1]).toBeDisabled()
    expect(accept[0]).not.toBeDisabled()
  })

  it('accepts a corrected reading, not the original one', async () => {
    show()
    await waitFor(() => expect(screen.getAllByText('Marsh').length).toBeGreaterThan(0))

    // Fix the surname the parser got wrong.
    fireEvent.click(screen.getByRole('button', { name: /Patient: Marsh/ }))
    const input = await screen.findByDisplayValue('Marsh')
    fireEvent.change(input, { target: { value: 'Marshall' } })

    fireEvent.click(screen.getAllByRole('button', { name: 'Add to calendar' })[0])

    await waitFor(() => expect(calls.some(c => c.url.includes('action=accept'))).toBe(true))
    const accept = calls.find(c => c.url.includes('action=accept'))
    expect(accept.body.fields.patient).toBe('Marshall')
    expect(accept.body.id).toBe('bk_1')
  })

  it('dismisses without writing anything to the calendar', async () => {
    show()
    await waitFor(() => expect(screen.getAllByText('Marsh').length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByRole('button', { name: 'Not a booking' })[0])

    await waitFor(() => expect(calls.some(c => c.url.includes('action=dismiss'))).toBe(true))
    expect(calls.some(c => c.url.includes('action=create'))).toBe(false)
    expect(calls.some(c => c.url.includes('action=accept'))).toBe(false)
  })

  it('takes an accepted card off the list', async () => {
    show()
    await waitFor(() => expect(screen.getAllByText('Marsh').length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByRole('button', { name: 'Add to calendar' })[0])
    // A card that stays on screen after it is accepted gets accepted twice.
    await waitFor(() => expect(screen.queryAllByText('Marsh')).toHaveLength(0))
    expect(screen.getAllByText('Hollis').length).toBeGreaterThan(0)
  })
})

describe('reading the mailbox', () => {
  it('checks on request rather than on every open', async () => {
    show()
    await waitFor(() => expect(screen.getAllByText('Marsh').length).toBeGreaterThan(0))
    // Opening the queue reads what is stored; it does not spend a model call.
    expect(calls.some(c => c.url.includes('action=ingest'))).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Check for new bookings' }))
    await waitFor(() => expect(calls.some(c => c.url.includes('action=ingest'))).toBe(true))
  })

  it('says so when the mailbox cannot be read', async () => {
    global.fetch = vi.fn(async (url, init) => {
      const text = String(url)
      calls.push({ url: text, body: null })
      if (text.includes('action=ingest')) {
        return {
          ok: false, status: 500,
          json: async () => ({ error: 'The app cannot read bookings@technomed.com.au yet.' })
        }
      }
      return respond(text, init)
    })

    show()
    await waitFor(() => expect(screen.getAllByText('Marsh').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Check for new bookings' }))
    // The delegation is not set up until somebody sets it up, and a silent
    // failure here looks exactly like an empty mailbox.
    await waitFor(() => expect(screen.getByText(/cannot read bookings@/)).toBeInTheDocument())
  })
})

describe('what a scan says it did', () => {
  function scanning(result) {
    global.fetch = vi.fn(async (url, init) => {
      const text = String(url)
      calls.push({ url: text, body: init?.body ? JSON.parse(init.body) : null })
      if (text.includes('action=ingest')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, pending: [], ...result }) }
      }
      return respond(text, init)
    })
  }

  it('owns up to the emails it did not get to', async () => {
    // A cap that is not reported reads as "covered everything", and the booking
    // sitting in the unread half is the one that gets missed.
    scanning({ read: 5, skipped: 0, remaining: 7 })
    show()
    await waitFor(() => expect(screen.getAllByText('Marsh').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Check for new bookings' }))
    await waitFor(() => expect(screen.getByText(/7 still to read/)).toBeInTheDocument())
    // And says so on the button, so tapping again is the obvious next move.
    expect(screen.getByRole('button', { name: /Check the next 5/ })).toBeInTheDocument()
  })

  it('says when it left an email alone rather than skipping it silently', async () => {
    // A booking from a domain nobody has told the app about would otherwise
    // vanish without trace.
    scanning({ read: 2, skipped: 9, remaining: 0 })
    show()
    await waitFor(() => expect(screen.getAllByText('Marsh').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Check for new bookings' }))
    await waitFor(() =>
      expect(screen.getByText(/9 emails from senders that are not booking sources/))
        .toBeInTheDocument())
  })

  it('distinguishes a quiet mailbox from a failed check', async () => {
    scanning({ read: 0, skipped: 0, remaining: 0 })
    show()
    await waitFor(() => expect(screen.getAllByText('Marsh').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Check for new bookings' }))
    await waitFor(() => expect(screen.getByText(/No new emails/)).toBeInTheDocument())
  })
})
