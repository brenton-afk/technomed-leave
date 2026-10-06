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

const WITH_EMAIL = {
  id: 'bk_3', status: 'pending', patient: 'Parsons', surgeon: 'Thani',
  date: '2026-10-06', procedure: 'L4/5 PLIF', kit: 'Diplomat + Global BMD PLIF',
  hospital: 'RHH', systems: ['Diplomat'], sources: ['rhh'], note: '',
  from: 'tobias.long@ths.tas.gov.au',
  subject: 'Cases for next week',
  excerpt: 'Parsons\nImplanet + E4 cages\nL4/5 PLIF',
  attachments: ['list.pdf']
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

  it('says when the emails were bookings already entered', async () => {
    // The first real mailbox check found outstanding emails and every one but
    // a single case was already in the app. Without this the run reads as
    // "found nothing", and the next thing anybody would do is accept the
    // duplicates it offered.
    scanning({ read: 6, skipped: 0, remaining: 0, already: 5 })
    show()
    await waitFor(() => expect(screen.getAllByText('Marsh').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Check for new bookings' }))
    await waitFor(() =>
      expect(screen.getByText(/5 were already on the calendar/)).toBeInTheDocument())
  })

  it('counts one already-booked case in the singular', async () => {
    scanning({ read: 2, skipped: 0, remaining: 0, already: 1 })
    show()
    await waitFor(() => expect(screen.getAllByText('Marsh').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Check for new bookings' }))
    await waitFor(() =>
      expect(screen.getByText(/1 was already on the calendar/)).toBeInTheDocument())
  })
})

describe('checking how a booking was read', () => {
  // A booking came back naming a system we do not carry and nobody could say
  // whether the surgeon had written it or the reader had invented it — the
  // email sits in a mailbox only the app can see.
  function serving() {
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes('action=queue')) {
        return {
          ok: true, status: 200,
          json: async () => ({ ok: true, count: 1, pending: [WITH_EMAIL] })
        }
      }
      return respond(String(url), init)
    })
  }

  it('shows what the email actually said', async () => {
    serving()
    show()
    await waitFor(() => expect(screen.getByText('What the email said')).toBeInTheDocument())
    expect(screen.getByText(/Implanet \+ E4 cages/)).toBeInTheDocument()
    expect(screen.getByText(/tobias\.long@ths\.tas\.gov\.au/)).toBeInTheDocument()
  })

  it('names the attachment a booking arrived in', async () => {
    // "The email said nothing" should not read as a fault when the booking was
    // a photograph of a theatre list.
    serving()
    show()
    await waitFor(() => expect(screen.getByText(/list\.pdf/)).toBeInTheDocument())
  })

  it('copies the email and the reading together', async () => {
    // One tap to hand somebody both halves of the question.
    const copied = []
    // jsdom has no clipboard and the property is not writable, so it is defined
    // rather than assigned.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: text => { copied.push(text); return Promise.resolve() } },
      configurable: true
    })
    serving()
    show()
    await waitFor(() => expect(screen.getByText('What the email said')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Copy the email/ }))
    expect(copied[0]).toMatch(/Implanet/)
    expect(copied[0]).toMatch(/Read as: Parsons \/ Thani/)
  })

  it('says nothing extra for a candidate with no email kept', async () => {
    // The ones queued before this existed.
    show()
    await waitFor(() => expect(screen.getAllByText('Marsh').length).toBeGreaterThan(0))
    expect(screen.queryByText('What the email said')).not.toBeInTheDocument()
  })
})

describe('the pre-operative workup in a queued booking', () => {
  // Filtered when the email is read *and* when the card is drawn. A candidate
  // queued before that existed has the workup baked into its note, and telling
  // somebody to dismiss it and check the mailbox again — for a line the app
  // should never have shown — is not a fix.
  const NOISY = {
    id: 'bk_4', status: 'pending', patient: 'Parsons', surgeon: 'Thani',
    date: '2026-10-06', procedure: 'L4/5 PLIF', kit: 'Diplomat',
    hospital: 'RHH', systems: ['Diplomat'], sources: ['rhh'],
    note: 'Bloods and ECG completed 2 weeks prior. Patient fasting from midnight. '
      + 'Existing fusion L5/S1 from 2021. Group and hold required.'
  }

  function serving(candidate) {
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes('action=queue')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, count: 1, pending: [candidate] }) }
      }
      return respond(String(url), init)
    })
  }

  it('drops it from a candidate already in the queue', async () => {
    serving(NOISY)
    show()
    await waitFor(() => expect(screen.getAllByText('Parsons').length).toBeGreaterThan(0))
    expect(screen.queryByText(/Bloods and ECG/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Group and hold/)).not.toBeInTheDocument()
  })

  it('keeps the line that actually matters', async () => {
    // The one that says there is something already in the patient.
    serving(NOISY)
    show()
    await waitFor(() => expect(screen.getByText(/Existing fusion L5\/S1/)).toBeInTheDocument())
  })

  it('shows no note at all when the workup was the whole of it', async () => {
    serving({ ...NOISY, note: 'Bloods and ECG completed. Consent signed.' })
    show()
    await waitFor(() => expect(screen.getAllByText('Parsons').length).toBeGreaterThan(0))
    expect(screen.queryByText(/Consent signed/)).not.toBeInTheDocument()
  })
})

describe('what the card says we hold', () => {
  // The card named the right cage and then said underneath that we do not hold
  // it — which we do: two consignment kits of Global BMD PLIF at Calvary, and
  // three of Diplomat. The verdict was reading the systems list stored when the
  // email was read, which still said "E4 Cages".
  const STALE = {
    id: 'bk_5', status: 'pending', patient: 'Parsons', surgeon: 'Thani',
    date: '2026-10-06', procedure: 'L4/5 PLIF', hospital: 'CLV',
    kit: 'Implanet + E4 Cages',
    systems: ['E4 Cages'],          // as stored before the resolver existed
    sources: ['rhh'], note: ''
  }

  function serving(candidate) {
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes('action=queue')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, count: 1, pending: [candidate] }) }
      }
      return respond(String(url), init)
    })
  }

  it('does not claim we lack a kit that is on the shelf', async () => {
    serving(STALE)
    show()
    await waitFor(() => expect(screen.getAllByText('Parsons').length).toBeGreaterThan(0))
    expect(screen.queryByText(/we do not hold this/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/not in the inventory/i)).not.toBeInTheDocument()
  })

  it('shows the resolved kit on the card', async () => {
    serving(STALE)
    show()
    // Shown as text until somebody taps it, so it is read not queried by value.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Kit: Diplomat \+ Global BMD PLIF/ }))
        .toBeInTheDocument())
  })

  it('accepts the resolved kit, not the one that was stored', async () => {
    serving(STALE)
    show()
    await waitFor(() => expect(screen.getAllByText('Parsons').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }))
    await waitFor(() => expect(calls.some(c => c.url.includes('action=accept'))).toBe(true))
    const accept = calls.find(c => c.url.includes('action=accept'))
    expect(accept.body.fields.kit).toBe('Diplomat + Global BMD PLIF')
  })
})

describe('saying a case is already booked', () => {
  // "We need an option to select as 'already in the calendar or already
  // booked'. This will tell the app that it has read an email unnecessarily
  // when a booking is already in the app."
  //
  // Dismissing a real case reads as "this is not happening", which is the
  // wrong thing for the next person to find when they go looking for why a
  // tray was not packed.
  const ready = async () => {
    show()
    await waitFor(() => expect(screen.getAllByText('Marsh').length).toBeGreaterThan(0))
  }

  it('offers it as its own answer, not as a dismissal', async () => {
    await ready()
    expect(screen.getAllByRole('button', { name: 'Already in the calendar' }).length)
      .toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Not a booking' }).length)
      .toBeGreaterThan(0)
  })

  it('records it differently from a dismissal', async () => {
    await ready()
    fireEvent.click(screen.getAllByRole('button', { name: 'Already in the calendar' })[0])
    await waitFor(() => {
      const call = calls.find(c => c.url.includes('action=dismiss'))
      expect(call).toBeTruthy()
      expect(call.body.reason).toBe('onCalendar')
    })
  })

  it('still dismisses outright when it was never a booking', async () => {
    await ready()
    fireEvent.click(screen.getAllByRole('button', { name: 'Not a booking' })[0])
    await waitFor(() => {
      const call = calls.find(c => c.url.includes('action=dismiss'))
      expect(call.body.reason).toBeUndefined()
    })
  })
})
