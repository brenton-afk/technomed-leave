import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import CaseWeek from './CaseWeek.jsx'

// One view replacing two. The Calendar navigated well and showed everything the
// calendar holds; the Case plan read a case properly and knew about the week.
// Keeping both meant every improvement had to be made twice or they drifted —
// which is how the calendar view went a month without refreshing while the plan
// polled fine.
//
// The bookings below are the real 21–22 September entries, verbatim apart from
// invented patient surnames. They are the point of the test: the shapes the team
// actually types, not the shapes a parser would like.

const USER = { name: 'Brenton Lovering', email: 'brenton@technomed.com.au', token: 'tok' }

const ev = (id, summary, description, { colorId, at = '09:00', location = 'RHH', day = '21' } = {}) => ({
  id,
  summary,
  description,
  location,
  colorId,
  start: { dateTime: `2026-09-${day}T${at}:00+10:00` },
  end: { dateTime: `2026-09-${day}T${at === '09:00' ? '10' : '15'}:00:00+10:00` }
})

const BOOKINGS = [
  ev('c1', 'Chalmers DIPLOMAT + E4 Cages - Fowler (Mat)',
    'Surg: Fowler\nPt: Chalmers\nHosp: RHH\nDate: 21/9/26\n'
    + 'Surgery: L5/S1 PSF and PLIF\nKit: Diplomat and E4 Cages (Consignment)',
    { colorId: '3' }),
  ev('c2', 'Marchetti REFORM CERVICAL- Atallah',
    'Surg: Atallah\nPt: Marchetti\nDate: 22/9/26\nSurgery: C3-T2 cervical fixation, C4-C7 Lami\n'
    + 'Kit: Reform Cervical (Consignment)\nHosp: RHH\n\n'
    + 'This patient was cancelled from Friday 18/9 and rebooked to Tuesday 22/9\n\n'
    + 'Notification received from Toby on WA\n\nEntered/amended by Brent',
    { colorId: '6', day: '22' }),
  ev('c3', 'Larkin DIPLOMAT / CASCADIA - Ibbett',
    'Surg - Dr Ibbett\nPt - Larkin (Jane)\nProcedure - L4/5 PLIF/resection of facet cyst\n'
    + 'Kit - Diplomat (consignment) /Cascadia (cons)\nHospital - Calvary Lenah Valley',
    { location: 'Calvary', day: '22' }),           // no colorId at all
  ev('c4', 'CANCELLED Sturrock LONESTAR - JPW',
    'Surg: JPW\nPt: Sturrock\nHosp: RHH\nKit: Lonestar (Consignment)',
    { colorId: '4', day: '22' }),
  ev('m1', 'Team meeting', '', { colorId: '7', at: '14:00', day: '21' })
]

let events

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-09-21T02:00:00.000Z')) // Monday, midday Hobart
  localStorage.clear()
  events = BOOKINGS
  global.fetch = vi.fn(async () => ({
    json: async () => ({ events, syncedAt: '2026-09-21T02:00:00.000Z' })
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const show = (props = {}) => render(<CaseWeek user={USER} {...props} />)

describe('a case, in full', () => {
  it('shows everything the booking says', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
    expect(screen.getByText('Fowler')).toBeInTheDocument()
    // "and" is dropped by cleanOperation — the operation reads "L5/S1 PSF PLIF".
    expect(screen.getByText('L5/S1 PSF PLIF')).toBeInTheDocument()
    expect(screen.getByText(/Diplomat and E4 Cages/)).toBeInTheDocument()
    expect(screen.getByText('Consignment')).toBeInTheDocument()
    // The rep the old calendar view dropped on the floor.
    expect(screen.getByText('Mat')).toBeInTheDocument()
  })

  it('shows the notes the team wrote, which neither old view did', async () => {
    // This is the whole reason a case moved, and it lived only in Google.
    show()
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /Week/ })))
    expect(await screen.findByText(/rebooked to Tuesday 22\/9/)).toBeInTheDocument()
    expect(screen.getByText(/Notification received from Toby/)).toBeInTheDocument()
  })

  it('does not repeat a note that only says what a field already says', async () => {
    // An unlabelled first line is read as the operation. Showing it again
    // underneath as commentary on itself is how the old plan looked wrong.
    events = [ev('c9', 'Fox STRYKER CCI - Fowler', 'L5/S1 ALIF\nKit: Stryker PSI loan', { colorId: '3' })]
    show()
    await waitFor(() => expect(screen.getByText('Fox')).toBeInTheDocument())
    expect(screen.getAllByText('L5/S1 ALIF')).toHaveLength(1)
  })

  it('keeps a patient to their surname', async () => {
    // "Pt - Larkin (Jane)" is in the live calendar. Surnames only, always.
    show()
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /Week/ })))
    await screen.findByText('Larkin')
    expect(screen.queryByText(/Jane/)).not.toBeInTheDocument()
  })
})

describe('however the booking is written', () => {
  // Ported from the screen this replaced. The team uses several label styles in
  // the same calendar and every one has to read the same.
  const variants = [
    ['full words', { Surgeon: 'Ibbett', Patient: 'Horne', Procedure: 'L4/5 TLIF', Kit: 'Mariner (Loan)' }],
    ['short forms', { Surg: 'Ibbett', Pt: 'Horne', Op: 'L4/5 TLIF', Kit: 'Mariner (Loan)' }],
    ['lower case', { surgeon: 'Ibbett', patient: 'Horne', surgery: 'L4/5 TLIF', kit: 'Mariner (Loan)' }],
    ['dashes', { 'Surg -': 'Ibbett', 'Pt -': 'Horne', 'Procedure -': 'L4/5 TLIF', 'Kit -': 'Mariner (Loan)' }]
  ]

  it.each(variants)('reads a case written with %s', async (_name, fields) => {
    events = [ev('v1', 'Booking',
      Object.entries(fields).map(([k, v]) => k.endsWith('-') ? `${k} ${v}` : `${k}: ${v}`).join('\n'),
      { colorId: '5' })]
    show()
    await waitFor(() => expect(screen.getByText('Horne')).toBeInTheDocument())
    expect(screen.getByText('Ibbett')).toBeInTheDocument()
    expect(screen.getByText('L4/5 TLIF')).toBeInTheDocument()
    expect(screen.getByText(/MARINER/i)).toBeInTheDocument()
    expect(screen.getByText('Loan')).toBeInTheDocument()
  })

  it('shows no label text and no raw line', async () => {
    events = [ev('v2', 'Booking', 'Surgeon: Ibbett\nPatient: Horne\nKit: Mariner (Loan)', { colorId: '5' })]
    show()
    await waitFor(() => expect(screen.getByText('Horne')).toBeInTheDocument())
    expect(screen.queryByText(/Surgeon:|Patient:|Kit:/)).not.toBeInTheDocument()
    expect(screen.queryByText('Booking')).not.toBeInTheDocument()
  })
})

describe('a navigation case', () => {
  // "Pt Mitchell is still blue for Ibbett, which should be banana." It was
  // blueberry, not the default blue: the Kit line reads
  // "Diplomat (Consignment) /Cascadia/AIRO", and navigation used to take the
  // bar. Two real rules — Ibbett is Banana, AIRO is Blueberry — fighting over
  // one colour channel, with the surgeon losing.
  const mitchell = () => ev('n1', 'Mitchell DIPLOMAT  - Ibbett',
    '\nSurg - Dr Ibbett\nPt - Mitchell (Donna)\nDate - 23/09/2026\nProcedure - L5/S1 PLIF\n'
    + 'Kit - Diplomat (Consignment) /Cascadia/AIRO\nHospital - Calvary Lenah Valley',
    { location: 'Calvary' })

  it('keeps the surgeon\'s colour', async () => {
    events = [mitchell()]
    const { container } = show()
    await waitFor(() => expect(screen.getByText('Mitchell')).toBeInTheDocument())
    const bar = [...container.querySelectorAll('span[aria-hidden="true"]')]
      .find(el => el.style.width === '5px')
    expect(bar.style.background).toBe('rgb(246, 192, 38)')   // Banana, not blueberry
  })

  it('still says it needs the platform', async () => {
    // The signal is not lost, it has its own marker — so both facts are
    // readable at once instead of one replacing the other.
    events = [mitchell()]
    show()
    expect(await screen.findByText('AIRO')).toBeInTheDocument()
  })
})

describe('the day and the week', () => {
  it('opens on today', async () => {
    show()
    expect(await screen.findByText('Today')).toBeInTheDocument()
    expect(screen.getByText(/21 September 2026/)).toBeInTheDocument()
  })

  it('shows only that day in day view', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
    // Tuesday's cases are not on Monday.
    expect(screen.queryByText('Marchetti')).not.toBeInTheDocument()
  })

  it('shows the whole week in week view', async () => {
    show()
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /Week/ })))
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
    expect(screen.getByText('Marchetti')).toBeInTheDocument()
    expect(screen.getByText('Larkin')).toBeInTheDocument()
  })

  it('groups a day by hospital', async () => {
    show()
    expect(await screen.findByText(/RHH · 1 case/)).toBeInTheDocument()
  })

  it('separates what is not a case, and says what it is', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
    expect(screen.getByText('Team meeting')).toBeInTheDocument()
    expect(screen.getByText('Meeting')).toBeInTheDocument()
  })
})

describe('what the calendar says, and only that', () => {
  it('marks the booking that says cancelled', async () => {
    show()
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /Week/ })))
    await screen.findByText('Sturrock')
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })

  it('leaves a rebooked case alone, however its notes read', async () => {
    // Marchetti's notes say "cancelled from Friday 18/9". The case is live.
    show()
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /Week/ })))
    await screen.findByText('Marchetti')
    // One Cancelled label on the week, and it belongs to Sturrock.
    expect(screen.getAllByText('Cancelled')).toHaveLength(1)
  })

  it('does not count a cancelled case in the day strip', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
    // Tuesday has three bookings, one of them called off.
    const tuesday = screen.getByText('22').closest('button')
    expect(tuesday).toHaveTextContent('2')
  })
})

describe('following the calendar', () => {
  it('picks up an edit without a reload', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())

    events = [{ ...BOOKINGS[0], summary: 'Chalmers DIPLOMAT + E4 Cages - Fowler (Ben)' }]
    await vi.advanceTimersByTimeAsync(61000)
    await waitFor(() => expect(screen.getByText('Ben')).toBeInTheDocument())
  })

  it('keeps the week on screen when a check fails', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())

    global.fetch = vi.fn(() => Promise.reject(new Error('offline')))
    await vi.advanceTimersByTimeAsync(61000)
    // The list survives the wifi dropping, and says it is not updating.
    expect(screen.getByText('Chalmers')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/Not updating/)).toBeInTheDocument())
  })
})

describe('what came across from the old views', () => {
  it('still offers the Word export', async () => {
    // The document that gets emailed round. It lived on the case plan screen,
    // and merging the views must not quietly drop a feature people use.
    show()
    await waitFor(() => expect(screen.getByLabelText(/Download the week as Word/)).toBeInTheDocument())
  })

  it('still shows the prompt banner it was given', async () => {
    show({ promptBanner: <div>Scan a usage form</div> })
    expect(await screen.findByText('Scan a usage form')).toBeInTheDocument()
  })
})
