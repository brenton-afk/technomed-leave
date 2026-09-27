import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
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
  fireEvent.change(screen.getByLabelText(/Add a system/), { target: { value: 'Mariner' } })
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
    const systems = screen.getByLabelText(/Add a system/)
    expect(surgeons.querySelectorAll('option').length).toBeGreaterThan(5)
    expect([...systems.querySelectorAll('option')].map(o => o.value)).toContain('Mariner')
  })

  it('leaves a competitor\'s product out of the list', () => {
    // Cascadia is Life Health Care's. We attend those cases for the Diplomat,
    // and it is not something we would ever book a set for.
    show()
    const systems = screen.getByLabelText(/Add a system/)
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
    fireEvent.change(screen.getByLabelText(/Add a system/), { target: { value: 'Mariner' } })
    expect((await screen.findAllByText(/a loan set has to be requested/)).length).toBeGreaterThan(0)
    expect(screen.getByText(/Nothing consigned at CLV/)).toBeInTheDocument()
  })

  it('gives the arrival deadline with it', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Calvary' }))
    fireEvent.change(screen.getByLabelText(/Add a system/), { target: { value: 'Mariner' } })
    // Thursday 24 September, so the kit is due the Tuesday.
    expect(await screen.findByText(/2026-09-22/)).toBeInTheDocument()
  })

  it('says nothing to order for the same system at RHH', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'RHH' }))
    fireEvent.change(screen.getByLabelText(/Add a system/), { target: { value: 'Mariner' } })
    expect(await screen.findByText(/nothing to order/)).toBeInTheDocument()
  })

  it('is loud about a system it does not know', async () => {
    // A quiet "nothing needed" is a case with no instruments on the day.
    show()
    fireEvent.click(screen.getByRole('button', { name: 'RHH' }))
    fireEvent.change(screen.getByLabelText(/Add a system/), { target: { value: 'Lonestar' } })
    // KT cover their own Calvary cases; at RHH we use their consigned set.
    expect(await screen.findByText(/nothing to order/)).toBeInTheDocument()
  })

  it('fills the supply in from the inventory', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Calvary' }))
    fireEvent.change(screen.getByLabelText(/Add a system/), { target: { value: 'Mariner' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Loan' })).toHaveAttribute('aria-pressed', 'true'))
  })
})

describe('a case needing two systems', () => {
  // Real ones do: Diplomat with E4 cages, or Athlet and Ascot for a cervical
  // corpectomy. One system per booking was simply wrong.
  it('takes both, each with its own supply', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Calvary' }))
    fireEvent.change(screen.getByLabelText(/Add a system/), { target: { value: 'Diplomat' } })
    fireEvent.change(screen.getByLabelText(/Add a system/), { target: { value: 'Global BMD PLIF' } })

    // Diplomat is consigned at Calvary; the E4 cages are not. A single supply
    // for the whole booking would be wrong for one of them.
    expect(await screen.findByText('Diplomat')).toBeInTheDocument()
    expect(screen.getByText('Global BMD PLIF')).toBeInTheDocument()
  })

  it('writes them into one kit line', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Calvary' }))
    fireEvent.change(screen.getByLabelText(/Add a system/), { target: { value: 'Diplomat' } })
    fireEvent.change(screen.getByLabelText(/Add a system/), { target: { value: 'Athlet' } })
    fireEvent.change(screen.getByLabelText(/Surgeon/), { target: { value: 'Ibbett' } })
    fireEvent.change(screen.getByLabelText(/Patient surname/), { target: { value: 'Marsh' } })
    fireEvent.click(screen.getByRole('button', { name: /Add to calendar/ }))

    await waitFor(() => expect(posted).toBeTruthy())
    expect(posted.fields.kit).toMatch(/^Diplomat \(Consignment\) \+ Athlet/)
  })

  it('gives a verdict for each of them', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Calvary' }))
    fireEvent.change(screen.getByLabelText(/Add a system/), { target: { value: 'Diplomat' } })
    fireEvent.change(screen.getByLabelText(/Add a system/), { target: { value: 'Mariner' } })
    // One is consigned at Calvary and the other has to be ordered. A combined
    // answer would hide the one that matters.
    expect(await screen.findByText(/Diplomat — nothing to order/)).toBeInTheDocument()
    expect(screen.getByText(/Mariner — a loan set has to be requested/)).toBeInTheDocument()
  })

  it('lets one be taken off again', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Calvary' }))
    fireEvent.change(screen.getByLabelText(/Add a system/), { target: { value: 'Diplomat' } })
    fireEvent.click(await screen.findByRole('button', { name: /Remove Diplomat/ }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Remove Diplomat/ })).not.toBeInTheDocument())
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

describe('a booking dictated out loud', () => {
  const FIELDS = {
    patient: 'Cooper', surgeon: 'Ibbett', date: '2026-10-02', hospital: 'RHH',
    procedure: 'L4/5 PLIF', kit: 'Diplomat + LHC cage', systems: ['Diplomat'], note: ''
  }

  function recorded(fields = FIELDS) {
    tracks = [{ stop: vi.fn() }]
    global.navigator.mediaDevices = { getUserMedia: vi.fn(async () => ({ getTracks: () => tracks })) }
    global.MediaRecorder = FakeRecorder
    global.Blob = class { constructor(p, o) { this.size = 50000; this.type = o?.type } }
    global.FileReader = class {
      readAsDataURL() { setTimeout(() => this.onload({ target: this }), 0) }
      get result() { return 'data:audio/webm;base64,QUJD' }
    }
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes('action=dictate')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, transcript: 'Cooper, Ibbett…', unclear: '', fields }) }
      }
      posted = JSON.parse(init.body)
      return { status: 200, json: async () => ({ ok: true, event: { id: 'new-1' } }) }
    })
  }

  let tracks
  class FakeRecorder {
    constructor(stream, options) { this.mimeType = options?.mimeType || 'audio/webm'; this.state = 'inactive' }
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: { size: 50000 } }); this.onstop?.() }
  }

  async function dictate() {
    fireEvent.click(screen.getByRole('button', { name: /Speak/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Start speaking/ }))
    // getUserMedia is awaited before recording starts, so wait for the button
    // to actually turn into Stop rather than clicking where it used to be.
    const stop = await screen.findByRole('button', { name: /Stop/ })
    await act(async () => { fireEvent.click(stop) })
    fireEvent.click(await screen.findByRole('button', { name: 'Check it first' }))
  }

  beforeEach(() => { FakeRecorder.isTypeSupported = () => true })

  it('writes what was heard into the form', async () => {
    recorded()
    show()
    await dictate()
    // The point of "Use this": every field the dictation heard is now in the
    // form, ready to check.
    await waitFor(() => expect(screen.getByDisplayValue('Cooper')).toBeInTheDocument())
    expect(screen.getByDisplayValue('L4/5 PLIF')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2026-10-02')).toBeInTheDocument()
    expect(screen.getByLabelText(/Surgeon/).value).toBe('Ibbett')
  })

  it('books it straight from the panel', async () => {
    // What was actually tried: speak, read the transcript, tap the button,
    // expect a booking. "Use this" only filled the form, which looked exactly
    // like nothing happening.
    recorded()
    show()
    fireEvent.click(screen.getByRole('button', { name: /Speak/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Start speaking/ }))
    const stop = await screen.findByRole('button', { name: /Stop/ })
    await act(async () => { fireEvent.click(stop) })
    fireEvent.click(await screen.findByRole('button', { name: 'Book it' }))

    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted.fields.patient).toBe('Cooper')
    expect(posted.fields.surgeon).toBe('Ibbett')
    expect(posted.date).toBe('2026-10-02')
    // The system was heard and carries its supply for the hospital that was
    // heard in the same breath — read from state, both would have been blank.
    expect(posted.fields.kit).toBe('Diplomat (Consignment)')
  })

  it('creates the booking when the form is then submitted', async () => {
    recorded()
    show()
    await dictate()
    await waitFor(() => expect(screen.getByDisplayValue('Cooper')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Add to calendar/ }))
    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted.fields.patient).toBe('Cooper')
    expect(posted.fields.surgeon).toBe('Ibbett')
    expect(posted.date).toBe('2026-10-02')
  })
})

describe('a second case wanting the same kit', () => {
  // Friday 2 October already has a Diplomat case at RHH. RHH holds one.
  const FRIDAY_DIPLOMAT = [
    { id: 'x1', patient: 'Cooper', surgeon: 'Ibbett', hospital: 'RHH',
      system: 'DIPLOMAT', kit: 'Diplomat (Consignment)' }
  ]

  it('warns rather than booking a second one as consignment', async () => {
    // Both were marked "Consignment" and booked without a murmur. One of them
    // had no kit.
    render(<NewBooking user={{ token: 't' }} onClose={() => {}}
      date="2026-10-02" alreadyBooked={FRIDAY_DIPLOMAT} />)
    fireEvent.click(screen.getByRole('button', { name: 'RHH' }))
    fireEvent.change(screen.getByLabelText(/Add a system/), { target: { value: 'Diplomat' } })

    await waitFor(() =>
      expect(screen.getByText(/Borrow a Diplomat kit from Calvary/)).toBeInTheDocument())
    expect(screen.getByText(/2 Diplomat cases at RHH that day and 1 kit there/))
      .toBeInTheDocument()
  })

  it('says nothing when the day is clear', async () => {
    render(<NewBooking user={{ token: 't' }} onClose={() => {}}
      date="2026-10-02" alreadyBooked={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'RHH' }))
    fireEvent.change(screen.getByLabelText(/Add a system/), { target: { value: 'Diplomat' } })
    await waitFor(() => expect(screen.getByText('Diplomat')).toBeInTheDocument())
    expect(screen.queryByText(/Borrow a Diplomat kit/)).not.toBeInTheDocument()
  })

  it('does not count a case at the other hospital', async () => {
    // Calvary's Diplomat list has no bearing on what is at RHH.
    render(<NewBooking user={{ token: 't' }} onClose={() => {}} date="2026-10-02"
      alreadyBooked={[{ ...FRIDAY_DIPLOMAT[0], hospital: 'CALVARY LENAH VALLEY' }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'RHH' }))
    fireEvent.change(screen.getByLabelText(/Add a system/), { target: { value: 'Diplomat' } })
    await waitFor(() => expect(screen.getByText('Diplomat')).toBeInTheDocument())
    expect(screen.queryByText(/Borrow a Diplomat kit/)).not.toBeInTheDocument()
  })
})

describe('a dictated booking that would leave a case without a kit', () => {
  const FRIDAY_DIPLOMAT = [
    { id: 'x1', patient: 'Cooper', surgeon: 'Ibbett', hospital: 'RHH',
      system: 'DIPLOMAT', kit: 'Diplomat (Consignment)' }
  ]

  let tracks
  class FakeRecorder {
    constructor(stream, options) { this.mimeType = options?.mimeType || 'audio/webm'; this.state = 'inactive' }
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: { size: 50000 } }); this.onstop?.() }
  }
  FakeRecorder.isTypeSupported = () => true

  beforeEach(() => {
    tracks = [{ stop: vi.fn() }]
    global.navigator.mediaDevices = { getUserMedia: vi.fn(async () => ({ getTracks: () => tracks })) }
    global.MediaRecorder = FakeRecorder
    global.Blob = class { constructor(p, o) { this.size = 50000; this.type = o?.type } }
    global.FileReader = class {
      readAsDataURL() { setTimeout(() => this.onload({ target: this }), 0) }
      get result() { return 'data:audio/webm;base64,QUJD' }
    }
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes('action=dictate')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            ok: true, transcript: 'Marsh, Fowler, RHH, Friday, L4 5 PLIF, Diplomat', unclear: '',
            fields: {
              patient: 'Marsh', surgeon: 'Fowler', date: '2026-10-02', hospital: 'RHH',
              procedure: 'L4/5 PLIF', kit: 'Diplomat', systems: ['Diplomat'], note: ''
            }
          })
        }
      }
      posted = JSON.parse(init.body)
      return { status: 200, json: async () => ({ ok: true, event: { id: 'n1' } }) }
    })
  })

  it('stops at the warning instead of booking it', async () => {
    // Speaking a booking is quicker than typing it. That is not a reason to
    // skip the one warning worth reading.
    render(<NewBooking user={{ token: 't' }} onClose={() => {}}
      date="2026-10-02" alreadyBooked={FRIDAY_DIPLOMAT} />)
    fireEvent.click(screen.getByRole('button', { name: /Speak/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Start speaking/ }))
    const stop = await screen.findByRole('button', { name: /Stop/ })
    await act(async () => { fireEvent.click(stop) })
    fireEvent.click(await screen.findByRole('button', { name: 'Book it' }))

    await waitFor(() =>
      expect(screen.getByText(/Borrow a Diplomat kit from Calvary/)).toBeInTheDocument())
    // Filled in and waiting, not written to the calendar.
    expect(posted).toBeNull()
    expect(screen.getByDisplayValue('Marsh')).toBeInTheDocument()
  })
})
