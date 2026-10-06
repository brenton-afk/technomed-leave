import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import EditBooking, { staleTitle, withReps } from './EditBooking.jsx'
import { extractRep } from '../../clinicalPlan/parse.js'

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
  notes: '',
  start: '2026-09-23T09:00:00+10:00',
  end: '2026-09-23T10:00:00+10:00',
  allDay: false,
  colorId: null,                 // entered with no colour, as the live one was
  reps: []
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
    const stale = staleTitle('Mardon DIPLOMAT - Fowler (Mat)',
      { surgeon: 'Fowler' }, { surgeon: 'Ibbett' })
    expect(stale.proposed).toBe('Mardon DIPLOMAT - Ibbett (Mat)')
  })

  it('is spotted when the patient changes', () => {
    const stale = staleTitle('Mardon DIPLOMAT - Fowler',
      { patient: 'Mardon' }, { patient: 'Marsh' })
    expect(stale.proposed).toBe('Marsh DIPLOMAT - Fowler')
  })

  it('says nothing when the title already agrees', () => {
    expect(staleTitle('Mardon DIPLOMAT - Ibbett',
      { surgeon: 'Fowler' }, { surgeon: 'Ibbett' })).toBeNull()
  })

  it('says nothing when nothing changed', () => {
    expect(staleTitle('Mardon DIPLOMAT - Fowler',
      { surgeon: 'Fowler' }, { surgeon: 'Fowler' })).toBeNull()
  })

  it('will not corrupt a word that merely contains the old value', () => {
    // "Al" inside "Calvary" is not the surgeon. A substring replace here would
    // write "Calvary" as "Cibbettvary" into a live booking.
    expect(staleTitle('Calvary list - Al', { surgeon: 'Al' }, { surgeon: 'Ibbett' }).proposed)
      .toBe('Calvary list - Ibbett')
  })

  it('follows the fields without asking', async () => {
    // "It asks me to update the title when I update the booking. I don't want
    // it to ask me every time, I just want the title automatically updated if
    // I edit it in the edit booking screen."
    //
    // It used to stop and offer, every time. That was wrong about where the
    // surprise is: somebody who has just corrected the booking has already
    // said what they want it to say, and being asked again is a second step
    // for a decision made in the first.
    show()
    await ready()
    fireEvent.change(screen.getByDisplayValue('Dr Ibbett'), { target: { value: 'Fowler' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))

    await waitFor(() => expect(saved.summary).toBe('Marsh DIPLOMAT  - Fowler'))
    expect(screen.queryByText(/The title still says/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update title' })).not.toBeInTheDocument()
  })

  it('saves the description first, and the title after it', async () => {
    // Two passes, not one. A title rewritten from fields that failed to save
    // would be the one genuinely bad outcome here.
    show()
    await ready()
    fireEvent.change(screen.getByDisplayValue('Dr Ibbett'), { target: { value: 'Fowler' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))

    await waitFor(() => expect(saved.summary).toBeTruthy())
    const writes = global.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(writes.length).toBeGreaterThanOrEqual(2)
    expect(JSON.parse(writes[0][1].body).summary).toBeUndefined()
  })

  it('closes once the title has followed', async () => {
    const onClose = vi.fn()
    show({ onClose })
    await ready()
    fireEvent.change(screen.getByDisplayValue('Dr Ibbett'), { target: { value: 'Fowler' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})


describe('moving a booking', () => {
  it('shows the Hobart date, and no time at all', async () => {
    // Case timings are not settled until the list order lands the evening
    // before and then move several times a day, so editing a time is work with
    // no value. Only the day moves.
    show()
    await ready()
    expect(screen.getByDisplayValue('2026-09-23')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('09:00')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Start|Finish/)).not.toBeInTheDocument()
  })

  it('sends a naive local time and lets the server apply the zone', async () => {
    // Never an offset worked out here. A phone in another timezone must not be
    // able to move a theatre list.
    show()
    await ready()
    fireEvent.change(screen.getByDisplayValue('2026-09-23'), { target: { value: '2026-09-25' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))

    await waitFor(() => expect(saved).toBeTruthy())
    expect(saved.start).toBe('2026-09-25T09:00:00')
    expect(saved.start).not.toMatch(/[+Z]/)
  })

  it('keeps the hours the booking already had', async () => {
    // Moving a day must not quietly restate the time as something else.
    show()
    await ready()
    fireEvent.change(screen.getByDisplayValue('2026-09-23'), { target: { value: '2026-09-25' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))
    await waitFor(() => expect(saved).toBeTruthy())
    expect(saved.end).toBe('2026-09-25T10:00:00')
  })

  it('says which day it is moving to', async () => {
    show()
    await ready()
    fireEvent.change(screen.getByDisplayValue('2026-09-23'), { target: { value: '2026-09-25' } })
    expect(await screen.findByText(/Moving this booking to Friday/)).toBeInTheDocument()
  })

  it('leaves the date out of a save that did not touch it', async () => {
    show()
    await ready()
    fireEvent.change(screen.getByDisplayValue('L5/S1 PLIF'), { target: { value: 'L4/5 TLIF' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))
    await waitFor(() => expect(saved).toBeTruthy())
    expect(saved.start).toBeUndefined()
  })
})

describe('deleting a booking', () => {
  it('asks first', async () => {
    // A booking removed by accident is a case nobody knows about, and the
    // calendar keeps no undo the team can reach.
    show()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /Delete booking/ }))
    expect(await screen.findByRole('button', { name: /Delete from the calendar/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Keep it/ })).toBeInTheDocument()
  })

  it('can be backed out of', async () => {
    show()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /Delete booking/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Keep it/ }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Delete from the calendar/ })).not.toBeInTheDocument())
  })

  it('sends the version marker, so it cannot delete someone else\'s edit', async () => {
    const onClose = vi.fn()
    show({ onClose })
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /Delete booking/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Delete from the calendar/ }))
    await waitFor(() => expect(saved).toBeTruthy())
    expect(saved.etag).toBe('"v1"')
    expect(saved.eventId).toBe('evt-1')
  })
})

describe('the colour, which nobody chooses', () => {
  // "Automatically allocate the colours to the surgeons so we don't have to
  // choose them." The colour is a function of who is operating, so asking a
  // person to pick it is asking them to look up a table and get it right —
  // which is how bookings ended up uncoloured or wrong to begin with.

  it('says which colour will be applied, and where it came from', async () => {
    // This booking has no colour at all, and the surgeon is Dr Ibbett.
    show()
    await ready()
    expect(await screen.findByText('Banana')).toBeInTheDocument()
    expect(screen.getByText(/set automatically from Dr Ibbett/)).toBeInTheDocument()
  })

  it('does not send a colour, so the server derives it', async () => {
    // Sending nothing is how "automatic" is expressed: the save works the colour
    // out from the surgeon on the booking as saved, which also means a booking
    // whose surgeon was corrected gets the right colour in the same write.
    show()
    await ready()
    fireEvent.change(screen.getByDisplayValue('L5/S1 PLIF'), { target: { value: 'L4/5 TLIF' } })
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))
    await waitFor(() => expect(saved).toBeTruthy())
    expect(saved.colorId).toBeUndefined()
  })

  it('reads the surgeon through their title', async () => {
    // The live convention is "Surg - Dr Ibbett" while the guide is keyed on
    // "Ibbett". Without stripping the honorific there is no colour to apply.
    show()
    await ready()
    expect(screen.getByDisplayValue('Dr Ibbett')).toBeInTheDocument()
    expect(screen.getByText(/set automatically from/)).toBeInTheDocument()
  })

  it('keeps the palette for the day somebody wants something else', async () => {
    show()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.click(screen.getByLabelText('Flamingo'))
    expect(screen.getByText(/chosen for this booking/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))
    await waitFor(() => expect(saved).toBeTruthy())
    // An explicit pick wins: automatic is a default, not a lock.
    expect(saved.colorId).toBe('4')
  })

  it('can be put back to automatic', async () => {
    show()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.click(screen.getByLabelText('Flamingo'))
    fireEvent.click(screen.getByRole('button', { name: /Back to automatic/ }))
    expect(screen.getByText(/set automatically from/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save to calendar/ })).toBeDisabled()
  })
})


describe('who attended', () => {
  // Mitchell's booking reads "… - Ibbett (Aimee/Mat)". Two reps on one case is
  // normal, and the app was showing none of them.
  it('is chosen, never typed', async () => {
    show()
    await ready()
    for (const name of ['Ben', 'Aimee', 'Brent', 'Mat']) {
      expect(screen.getByRole('button', { name }), name).toBeInTheDocument()
    }
  })

  it('goes into the title the way the team writes it', async () => {
    show()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Aimee' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mat' }))
    fireEvent.click(screen.getByRole('button', { name: /Save to calendar/ }))
    await waitFor(() => expect(saved).toBeTruthy())
    expect(saved.summary).toBe('Marsh DIPLOMAT  - Ibbett (Aimee/Mat)')
  })

  it('shows the reps a booking already names', async () => {
    // Otherwise an edit would quietly drop the reps somebody recorded.
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes('action=booking')) {
        return { status: 200, json: async () => ({ ...BOOKING, reps: ['Aimee', 'Mat'] }) }
      }
      saved = JSON.parse(init.body)
      return { status: 200, json: async () => ({ ok: true, event: BOOKING }) }
    })
    show()
    await ready()
    expect(screen.getByRole('button', { name: 'Aimee' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Ben' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('replaces the group rather than adding a second one', () => {
    expect(withReps('Marsh DIPLOMAT - Ibbett (Aimee/Mat)', ['Ben'])).toBe('Marsh DIPLOMAT - Ibbett (Ben)')
    expect(withReps('Marsh DIPLOMAT - Ibbett', ['Aimee', 'Mat'])).toBe('Marsh DIPLOMAT - Ibbett (Aimee/Mat)')
  })

  it('removes it cleanly when nobody is attending', () => {
    expect(withReps('Marsh DIPLOMAT - Ibbett (Mat)', [])).toBe('Marsh DIPLOMAT - Ibbett')
  })
})

describe('reps go back to the calendar the way they came', () => {
  it('replaces a rep group it did not write itself', () => {
    // withReps used to carry its own pattern that knew only the four names in
    // ATTENDING_REPS. Editing a booking that said "(Aimee/Brenton)" would have
    // left that group alone and appended a second one beside it.
    expect(withReps('Bonney DIPLOMAT (Calvary Loan) - Gupta (Aimee/Brenton)', ['Aimee']))
      .toBe('Bonney DIPLOMAT (Calvary Loan) - Gupta (Aimee)')
  })

  it('leaves a supply bracket alone', () => {
    // The supply note is in brackets too, and stripping it would quietly change
    // what the booking says about the kit.
    expect(withReps('Rowe DIPLOMAT (Consignment) - Dubey', ['Mat']))
      .toBe('Rowe DIPLOMAT (Consignment) - Dubey (Mat)')
    expect(withReps('Petrusma REFORM CERVICAL (LOAN) - Thani', []))
      .toBe('Petrusma REFORM CERVICAL (LOAN) - Thani')
  })

  it('takes the reps off when nobody is attending', () => {
    expect(withReps('Mitchell AIRO - Ibbett (Aimee/Mat)', []))
      .toBe('Mitchell AIRO - Ibbett')
  })

  it('round-trips what it wrote', () => {
    // What the app writes must read back as the same people, or a save would
    // change the booking a little each time.
    for (const reps of [['Aimee'], ['Aimee', 'Mat'], ['Ben', 'Brent', 'Mat']]) {
      const title = withReps('Mardon MARINER - Fowler', reps)
      expect(extractRep(title).reps, title).toEqual(reps)
    }
  })

  it('keeps a name that is not on the roster through a round trip', () => {
    // A locum, or somebody from another company. Losing them on save is how the
    // calendar and the app drift apart.
    const title = withReps('Mardon MARINER - Fowler', ['Sarah'])
    expect(title).toBe('Mardon MARINER - Fowler (Sarah)')
    expect(extractRep(title).reps).toEqual(['Sarah'])
  })
})

describe('moving a booking onto a day whose kit is spoken for', () => {
  // The same clash as booking a second one there: it does not matter whether
  // the case is new or arrived from Tuesday, the kit is still one kit.
  const BOOKING = {
    summary: 'Marsh DIPLOMAT - Fowler',
    fields: { patient: 'Marsh', surgeon: 'Fowler', kit: 'Diplomat (Consignment)', hospital: 'RHH' },
    notes: '', reps: [], colorId: '3', etag: 'e1',
    start: '2026-09-29T08:00:00+10:00',
    end: '2026-09-29T17:00:00+10:00'
  }

  // Friday already has a Diplomat at RHH; Tuesday has nothing.
  const DAYS = {
    '2026-10-02': [{ id: 'other', hospital: 'RHH', system: 'DIPLOMAT', kit: 'Diplomat (Consignment)' }],
    '2026-09-29': []
  }

  function serving() {
    global.fetch = vi.fn(async url => {
      const text = String(url)
      const day = /start=(\d{4}-\d{2}-\d{2})/.exec(text)?.[1]
      if (day) {
        return {
          ok: true, status: 200,
          json: async () => ({
            events: (DAYS[day] || []).map(c => ({
              id: c.id, summary: `Other ${c.system} - Ibbett`,
              description: `Pt: Other\nKit: ${c.kit}\nHosp: ${c.hospital}`,
              location: c.hospital, start: {}, end: {}, source: 'bookings'
            }))
          })
        }
      }
      return { ok: true, status: 200, json: async () => BOOKING }
    })
  }

  it('says nothing while the booking sits on a clear day', async () => {
    serving()
    render(<EditBooking eventId="mine" user={{ token: 't' }} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByDisplayValue('Marsh')).toBeInTheDocument())
    expect(screen.queryByText(/Borrow a Diplomat kit/)).not.toBeInTheDocument()
  })

  it('warns as soon as it is moved onto the committed day', async () => {
    serving()
    render(<EditBooking eventId="mine" user={{ token: 't' }} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByDisplayValue('Marsh')).toBeInTheDocument())

    fireEvent.change(screen.getByDisplayValue('2026-09-29'), { target: { value: '2026-10-02' } })
    await waitFor(() =>
      expect(screen.getByText(/Borrow a Diplomat kit from Calvary/)).toBeInTheDocument())
  })

  it('does not count the booking against itself', async () => {
    // Reloading a booking that is already on a day must not read its own entry
    // as a second case and cry clash at a day that is fine.
    global.fetch = vi.fn(async url => {
      const text = String(url)
      if (/start=/.test(text)) {
        return {
          ok: true, status: 200,
          json: async () => ({
            events: [{
              id: 'mine', summary: 'Marsh DIPLOMAT - Fowler',
              description: 'Pt: Marsh\nKit: Diplomat (Consignment)\nHosp: RHH',
              location: 'RHH', start: {}, end: {}, source: 'bookings'
            }]
          })
        }
      }
      return { ok: true, status: 200, json: async () => BOOKING }
    })
    render(<EditBooking eventId="mine" user={{ token: 't' }} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByDisplayValue('Marsh')).toBeInTheDocument())
    expect(screen.queryByText(/Borrow a Diplomat kit/)).not.toBeInTheDocument()
  })
})

describe('calling a case off', () => {
  const ON = {
    summary: 'Sturrock LONESTAR - JPW',
    fields: { patient: 'Sturrock', surgeon: 'JPW', kit: 'Lonestar', hospital: 'RHH' },
    notes: '', reps: [], colorId: '4', etag: 'e1',
    start: '2026-10-02T08:00:00+10:00', end: '2026-10-02T09:00:00+10:00'
  }
  const OFF = { ...ON, summary: 'CANCELLED Sturrock LONESTAR - JPW', colorId: '8' }

  let posted
  function serving(booking) {
    posted = null
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes('action=cancel')) {
        posted = JSON.parse(init.body)
        return { ok: true, status: 200, json: async () => ({ ok: true, cancelled: posted.off }) }
      }
      if (/start=/.test(String(url))) {
        return { ok: true, status: 200, json: async () => ({ events: [] }) }
      }
      return { ok: true, status: 200, json: async () => booking }
    })
  }

  const open = (props = {}) => render(
    <EditBooking eventId="e" user={{ token: 't' }} onClose={() => {}} onSaved={() => {}} {...props} />
  )

  it('takes two taps, like deleting', async () => {
    // A case called off by accident sends nobody to a theatre that is expecting
    // them.
    serving(ON)
    open()
    await waitFor(() => expect(screen.getByDisplayValue('Sturrock')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Call this case off' }))
    expect(posted).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Call the case off' }))
    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted.off).toBe(true)
  })

  it('asks why, because it is the first thing anybody asks', async () => {
    serving(ON)
    open()
    await waitFor(() => expect(screen.getByDisplayValue('Sturrock')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Call this case off' }))
    const why = await screen.findByLabelText(/Reason it was called off/)
    fireEvent.change(why, { target: { value: 'Patient unwell' } })
    fireEvent.click(screen.getByRole('button', { name: 'Call the case off' }))
    await waitFor(() => expect(posted?.reason).toBe('Patient unwell'))
  })

  it('offers to put a called-off case back on', async () => {
    // A theatre list is rearranged twice before eight in the morning.
    serving(OFF)
    open()
    await waitFor(() => expect(screen.getByText(/This case is called off/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Put the case back on' }))
    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted.off).toBe(false)
  })

  it('does not offer to call off a case that is already off', async () => {
    serving(OFF)
    open()
    await waitFor(() => expect(screen.getByText(/This case is called off/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Call this case off' })).not.toBeInTheDocument()
  })

  it('does not put two buttons saying cancel side by side', async () => {
    // One would shut the sheet and one would call off surgery.
    serving(ON)
    open()
    await waitFor(() => expect(screen.getByDisplayValue('Sturrock')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    // One way out of the sheet, in the header, and it is not called Cancel.
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1)
  })
})

describe('what the patient already has in', () => {
  // Hudson, 13 October: "R/O C5/6 ACDF plate — has Shoreline in-situ from
  // 29.9.2022 with Hunn". The team has to know what is in there before the day,
  // and the answer has been in the usage tree all along.
  const REVISION = {
    summary: 'Hudson SHORELINE PLATE removal - Thani',
    fields: {
      patient: 'Hudson', surgeon: 'Thani', hospital: 'CLV',
      procedure: 'R/O C5/6 ACDF plate', kit: 'Shoreline (Consignment)'
    },
    notes: '', reps: [], colorId: '2', etag: 'e1',
    start: '2026-10-13T08:00:00+11:00', end: '2026-10-13T09:00:00+11:00'
  }
  // The title counts too, not just the procedure field — this booking's own
  // title says "removal", which is exactly where somebody would write it.
  const ORDINARY = {
    ...REVISION,
    summary: 'Hudson SHORELINE - Thani',
    fields: { ...REVISION.fields, procedure: 'C5/6 ACDF' }
  }

  let askedFor
  function serving(booking, prior) {
    askedFor = null
    global.fetch = vi.fn(async url => {
      const text = String(url)
      if (text.includes('action=prior')) {
        askedFor = text
        return { ok: true, status: 200, json: async () => prior }
      }
      if (/start=/.test(text)) return { ok: true, status: 200, json: async () => ({ events: [] }) }
      return { ok: true, status: 200, json: async () => booking }
    })
  }

  const FOUND = {
    ok: true,
    summary: '2 earlier cases filed under this surname. 1 of them under another surgeon. Check they are the same patient.',
    matches: [
      { date: '2022-09-29', surgeon: 'Hunn', systems: ['Shoreline'], sameSurgeon: false, filedAs: 'Hudson 29.09.22 Hunn Shoreline ACDF CLV' },
      { date: '2019-04-02', surgeon: 'Thani', systems: ['Diplomat'], sameSurgeon: true, filedAs: 'Hudson 02.04.19 Thani Diplomat PSF RHH' }
    ]
  }

  const open = () => render(
    <EditBooking eventId="e" user={{ token: 't' }} onClose={() => {}} onSaved={() => {}} />
  )

  it('looks it up when the booking asks about something existing', async () => {
    serving(REVISION, FOUND)
    open()
    await waitFor(() => expect(askedFor).not.toBeNull())
    expect(askedFor).toMatch(/patient=Hudson/)
    expect(askedFor).toMatch(/surgeon=Thani/)
  })

  it('does not look it up on an ordinary case', async () => {
    // A history panel on every booking is one nobody reads, and this one has to
    // be read on the cases that have it.
    serving(ORDINARY, FOUND)
    open()
    await waitFor(() => expect(screen.getByDisplayValue('Hudson')).toBeInTheDocument())
    expect(askedFor).toBeNull()
  })

  it('shows what was put in, when, and by whom', async () => {
    serving(REVISION, FOUND)
    open()
    await waitFor(() => expect(screen.getByText(/Already filed under this surname/)).toBeInTheDocument())
    expect(screen.getByText(/Hudson 29.09.22 Hunn Shoreline ACDF CLV/)).toBeInTheDocument()
  })

  it('marks the one filed under a different surgeon', async () => {
    // The case that would otherwise be missed: a patient who came back to
    // somebody else.
    serving(REVISION, FOUND)
    open()
    await waitFor(() => expect(screen.getByText(/different surgeon/)).toBeInTheDocument())
  })

  it('never claims it is the same patient', async () => {
    // A surname is all the app keeps.
    serving(REVISION, FOUND)
    open()
    await waitFor(() =>
      expect(screen.getByText(/Check they are the same patient/)).toBeInTheDocument())
  })

  it('says so when the history could not be read', async () => {
    // Silence here reads as "nothing in there", which is the worst possible
    // answer before a removal.
    serving(REVISION, { ok: true, matches: [], unavailable: 'Dropbox is not connected' })
    open()
    await waitFor(() =>
      expect(screen.getByText(/Could not check what is already in/)).toBeInTheDocument())
  })
})
