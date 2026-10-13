import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import CaseWeek from './CaseWeek.jsx'
import { LIVE_POLL_MS, AWAY_LONG_ENOUGH_MS } from '../liveRefresh.js'
import { formatWeekRangeShort } from '../clinicalPlan/week.js'

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
  ev('c1', 'Mardon DIPLOMAT + E4 Cages - Fowler (Mat)',
    'Surg: Fowler\nPt: Mardon\nHosp: RHH\nDate: 21/9/26\n'
    + 'Surgery: L5/S1 PSF and PLIF\nKit: Diplomat and E4 Cages (Consignment)',
    { colorId: '3' }),
  ev('c2', 'Vellacott REFORM CERVICAL- Atallah',
    'Surg: Atallah\nPt: Vellacott\nDate: 22/9/26\nSurgery: C3-T2 cervical fixation, C4-C7 Lami\n'
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
  global.fetch = vi.fn(async url => ({
    // The guide list, so a booking can be matched to a preference card.
    json: async () => (String(url).includes('/api/guides')
      ? {
        guides: [
          { slug: 'surgeon-preferences', name: 'Surgeon Preferences', group: 'Restricted', restricted: true },
          { slug: 'dakota', name: 'Dakota ACDF', group: 'Spine' }
        ],
        coming: []
      }
      : { events, syncedAt: '2026-09-21T02:00:00.000Z' }),
    text: async () => '<html><body><h2 id="p-fowler">Fowler</h2></body></html>',
    ok: true
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
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(screen.getByText('Fowler')).toBeInTheDocument()
    // "and" survives now. It used to be dropped because the kit — "Diplomat
    // and E4 Cages" — contains the word, and every word of the kit was struck
    // out of the operation. A conjunction is never a product's identity, and
    // without it the line stops being English.
    expect(screen.getByText('L5/S1 PSF and PLIF')).toBeInTheDocument()
    // Resolved on the way in: the booking says "E4 Cages" and the procedure is
    // a PLIF, so the card names the cage the team actually has to bring.
    expect(screen.getByText(/Diplomat and Global BMD PLIF/)).toBeInTheDocument()
    // Bracketed and attached to its system now, because a booking can name
    // two systems supplied differently and one trailing word said the wrong
    // thing about one of them.
    expect(screen.getByText('(Consignment)')).toBeInTheDocument()
    // The rep the old calendar view dropped on the floor.
    expect(screen.getByText('Mat')).toBeInTheDocument()
  })

  it('leaves the notes the team wrote to the booking', async () => {
    // They were on the tile, and they are the longest thing on it and the
    // least often why you are looking: "slightly less information on view...
    // but still be able to go into each booking and get the extra info". The
    // tile is a block to glance at; the prose is one tap in.
    show()
    fireEvent.click(await waitFor(() => screen.getByRole('tab', { name: 'Week' })))
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(screen.queryByText(/rebooked to Tuesday 22\/9/)).not.toBeInTheDocument()
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
    fireEvent.click(await waitFor(() => screen.getByRole('tab', { name: 'Week' })))
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
    expect(screen.getByText('(Loan)')).toBeInTheDocument()
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
    // The whole card carries the colour now, so that is where it is checked.
    // The fact being protected has not changed: an AIRO case belonging to one
    // of our surgeons stays their colour rather than turning blueberry, which
    // would say the case is somebody else's.
    const card = [...container.querySelectorAll('div')]
      .find(el => el.style.background === 'rgb(246, 192, 38)')   // Banana
    expect(card, 'the card should be drawn in Banana').toBeTruthy()
  })

  it('keeps the surgeon’s own colour, with the platform a tap away', async () => {
    // The point of that fix stands: navigation never overrides the surgeon,
    // because a booking can be both and one colour channel cannot carry two
    // facts. Where the platform is *said* has moved — off the tile, onto the
    // desktop column and into the booking — because it reads AIRO on every
    // pedicle screw case and so said the same thing on most of a week.
    events = [mitchell()]
    show()
    await waitFor(() => expect(screen.getByText('Mitchell')).toBeInTheDocument())
    expect(screen.queryByText('AIRO')).not.toBeInTheDocument()
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
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    // Tuesday's cases are not on Monday.
    expect(screen.queryByText('Vellacott')).not.toBeInTheDocument()
  })

  it('shows the whole week in week view', async () => {
    show()
    fireEvent.click(await waitFor(() => screen.getByRole('tab', { name: 'Week' })))
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(screen.getByText('Vellacott')).toBeInTheDocument()
    expect(screen.getByText('Larkin')).toBeInTheDocument()
  })

  it('groups a day by hospital', async () => {
    show()
    expect(await screen.findByText(/RHH · 1 case/)).toBeInTheDocument()
  })

  it('separates what is not a case, and says what it is', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(screen.getByText('Team meeting')).toBeInTheDocument()
    expect(screen.getByText('Meeting')).toBeInTheDocument()
  })
})

describe('what the calendar says, and only that', () => {
  it('marks the booking that says cancelled', async () => {
    show()
    fireEvent.click(await waitFor(() => screen.getByRole('tab', { name: 'Week' })))
    await screen.findByText('Sturrock')
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })

  it('leaves a rebooked case alone, however its notes read', async () => {
    // Vellacott's notes say "cancelled from Friday 18/9". The case is live.
    show()
    fireEvent.click(await waitFor(() => screen.getByRole('tab', { name: 'Week' })))
    await screen.findByText('Vellacott')
    // One Cancelled label on the week, and it belongs to Sturrock.
    expect(screen.getAllByText('Cancelled')).toHaveLength(1)
  })

  it('names each day and dates it', async () => {
    // The count badges are gone, and the "Cases each day" label that had to
    // explain them went with them: the week below says how busy a day is by
    // being long, and a number in a circle was a smaller way of saying it
    // twice. What is left is the day and the date, said the way it is said
    // out loud.
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(screen.getByText('22nd')).toBeInTheDocument()
    expect(screen.getByText('22nd').closest('button')).toHaveTextContent('Tue')
    expect(screen.queryByText(/Cases each day/i)).not.toBeInTheDocument()
  })
})

describe('following the calendar', () => {
  it('picks up an edit without a reload', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())

    events = [{ ...BOOKINGS[0], summary: 'Mardon DIPLOMAT + E4 Cages - Fowler (Ben)' }]
    await vi.advanceTimersByTimeAsync(61000)
    await waitFor(() => expect(screen.getByText('Ben')).toBeInTheDocument())
  })

  it('keeps the week on screen when a check fails', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())

    global.fetch = vi.fn(() => Promise.reject(new Error('offline')))
    await vi.advanceTimersByTimeAsync(61000)
    // The list survives the wifi dropping, and says it is not updating.
    expect(screen.getByText('Mardon')).toBeInTheDocument()
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

describe('opening the app', () => {
  it('always shows today, not where you were last', async () => {
    // The app is opened to find out what is on now. Restoring a week somebody
    // scrolled to yesterday means the first thing it shows is wrong, quietly.
    localStorage.setItem('tm_clinical_prefs', JSON.stringify({ weekStart: '2026-08-24' }))
    show()
    expect(await screen.findByText('Today')).toBeInTheDocument()
    expect(screen.getByText(/21 September 2026/)).toBeInTheDocument()
  })
})

describe('the header', () => {
  it('carries one row of controls above the day strip', async () => {
    // It used to carry three — a Day/Week pair, a row of three chips, and the
    // week range with its arrows — which on a phone left very little of the week
    // itself on screen.
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Previous week/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Next week/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Today$/ })).not.toBeInTheDocument()
  })

  it('gives the week arrows a real tap target', async () => {
    // Reported as "the arrows to cycle through the weeks are very small". They
    // were a 19px glyph with 2px of padding — roughly 23 by 22 — and they are
    // the most-used control on the screen. 44 is Apple's minimum.
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    for (const name of [/Previous week/, /Next week/]) {
      const { width, height } = screen.getByRole('button', { name }).style
      expect(`${name} width`, `${name}`).toBeTruthy()
      expect(parseInt(width, 10)).toBeGreaterThanOrEqual(44)
      expect(parseInt(height, 10)).toBeGreaterThanOrEqual(44)
    }
  })

  it('says which of day and week you are looking at', async () => {
    // The old control named its destination, not its state: it read "Day" while
    // showing the week. Two segments with one selected says both at once.
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Day' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Week' })).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(screen.getByRole('tab', { name: 'Week' }))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Week' })).toHaveAttribute('aria-selected', 'true'))
  })

  it('only offers a way back to today when you have left it', async () => {
    // Tapping the week range to come back was an affordance nobody could see.
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(screen.queryByText(/Back to today/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Next week/ }))
    await waitFor(() => expect(screen.getByText(/Back to today/i)).toBeInTheDocument())
  })

  it('offers adding a booking as a row, not a floating button', async () => {
    // The circle pinned to the bottom corner drifted off with the content: it
    // was positioned against a container that scrolls. A row cannot drift, and
    // cannot float over the last case of a long list either.
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    const add = screen.getByRole('button', { name: /Add a booking/ })
    expect(add).toBeInTheDocument()
    expect(add.style.position).not.toBe('absolute')
    expect(add.style.position).not.toBe('fixed')
  })

  it('names the day it sits under, and opens the sheet on it', async () => {
    // One fewer thing to choose for the booking somebody is most likely making.
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    const add = screen.getByRole('button', { name: /Add a booking to Monday 21 September/ })
    fireEvent.click(add)
    expect(await screen.findByDisplayValue('2026-09-21')).toBeInTheDocument()
  })
})

describe('when a sub-calendar cannot be read', () => {
  // Leave lives on its own calendar, fetched alongside the bookings. One
  // failing must not fail the week — but it must not pass unmentioned either.
  function withLeaveUnreadable() {
    global.fetch = vi.fn(async () => ({
      json: async () => ({
        events,
        syncedAt: '2026-09-21T02:00:00.000Z',
        sourceErrors: [{
          source: 'leave', error: 'Not Found',
          shareWith: 'technomed-portal@technomed-portal.iam.gserviceaccount.com'
        }]
      })
    }))
  }

  it('says so rather than showing a week with nobody on leave', async () => {
    // An unreadable leave calendar looks exactly like a week where nobody is
    // away, which is a difference worth knowing before planning around it.
    withLeaveUnreadable()
    show()
    await waitFor(() =>
      expect(screen.getByText(/Leave is not showing this week/)).toBeInTheDocument())
    // Named, so the fix is a paste rather than a hunt through Vercel's settings.
    expect(screen.getByText(/technomed-portal@.*iam\.gserviceaccount\.com/)).toBeInTheDocument()
    expect(screen.getByText(/See all event details/)).toBeInTheDocument()
  })

  it('still shows the bookings it did get', async () => {
    withLeaveUnreadable()
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
  })

  it('says nothing when both calendars read fine', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(screen.queryByText(/could not be read/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Leave is not showing/)).not.toBeInTheDocument()
  })
})

describe('who is away', () => {
  const LEAVE = {
    id: 'lv1',
    summary: 'Ben - ANNUAL LEAVE',
    description: '',
    location: '',
    start: { date: '2026-09-21' },
    end: { date: '2026-09-23' }
  }

  it('shows leave above the cases, not below them', async () => {
    // It sat under the theatre list, so on a busy day you had to scroll past
    // every case to find out who was not in. Leave changes who covers what, so
    // it is read before the list rather than after it.
    events = [...BOOKINGS, LEAVE]
    show()
    const leave = await screen.findByText('Ben - ANNUAL LEAVE')
    const firstCase = screen.getByText('Mardon')
    // Node.compareDocumentPosition: 4 means the argument follows in the document.
    expect(leave.compareDocumentPosition(firstCase) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
  })

  it('does not also repeat it at the bottom', async () => {
    events = [...BOOKINGS, LEAVE]
    show()
    await waitFor(() => expect(screen.getAllByText('Ben - ANNUAL LEAVE')).toHaveLength(1))
  })

  it('leaves the other odds and ends where they were', async () => {
    // Only leave is promoted. A team meeting is not a reason to look up.
    events = [...BOOKINGS, LEAVE]
    show()
    const leave = await screen.findByText('Ben - ANNUAL LEAVE')
    const meeting = screen.getByText('Team meeting')
    expect(leave.compareDocumentPosition(meeting) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
  })
})

describe('the week header fits a phone', () => {
  it('drops the year from the range when it is this year', async () => {
    // "21 – 27 September 2026" at heading size does not fit between two 44px
    // arrows on a 390px screen — it was being cut off mid-month.
    show()
    await waitFor(() => expect(screen.getByText('21 – 27 September')).toBeInTheDocument())
    expect(screen.queryByText(/21 – 27 September 2026/)).not.toBeInTheDocument()
  })

  it('shortens the months when a week straddles two', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Next week/ }))
    await waitFor(() => expect(screen.getByText('28 Sep – 4 Oct')).toBeInTheDocument())
  })

  it('keeps the year when the week is not in this one', async () => {
    // Which is exactly when it is worth the room.
    expect(formatWeekRangeShort('2027-03-01', '2027-03-07', '2026-09-21'))
      .toBe('1 – 7 March 2027')
    expect(formatWeekRangeShort('2026-12-28', '2027-01-03', '2026-09-21'))
      .toBe('28 Dec 2026 – 3 Jan 2027')
  })
})

describe('the number under each date', () => {
  it('reads the whole date to a screen reader', async () => {
    // "22nd" alone is not a date. The label says which day and which month,
    // because that is what the column is actually offering to select.
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Monday 21 September' }))
      .toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tuesday 22 September' }))
      .toBeInTheDocument()
  })
})

describe('no numbers, and no arrows', () => {
  // "The list order numbers are a bit clunky. Tomorrow we have patient Holmes
  // as case number 1 according to the numbers, but there is a competitor case
  // in the morning that is actually the first case. So I hit change list order
  // and put the case second on the AM list following the competitor ALIF, but
  // the number on the left is at odds with this and is confusing. I think we
  // ditch the ability to move the cases and give them a number, because the
  // number becomes obsolete if there are other cases on."
  //
  // The number only ever counted *our* cases. The hospital's list contains
  // everybody's, so the two disagree the moment another company has a case on
  // — which is most days. Two numbers for one thing, one of them wrong, and
  // the wrong one bigger and further left.
  //
  // What replaces it is the thing that was already right: the list place,
  // recorded against the hospital's actual running order and able to say
  // "second on the AM list, after a competitor ALIF".
  it('gives a case no position number', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    // Nothing on a card is a bare ordinal any more.
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    expect(screen.queryByText('2')).not.toBeInTheDocument()
  })

  it('offers no arrows to move a case with', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(screen.queryByLabelText(/up the list/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/down the list/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/earlier on the list/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/later on the list/)).not.toBeInTheDocument()
  })

  it('does not explain an ordering that no longer exists', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(screen.queryByText(/Move a case with the arrows/)).not.toBeInTheDocument()
  })

  it('never writes an order to the calendar', async () => {
    // The endpoint is still there and nothing in the app calls it. A reorder
    // sent by accident would move real calendar entries.
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(global.fetch.mock.calls.some(([url]) => String(url).includes('action=reorder')))
      .toBe(false)
  })

  it('keeps the list place, which is the thing that was right', async () => {
    // It can say what a number never could: second on the AM list, behind
    // somebody else's case.
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(screen.getAllByLabelText(/Set where .* is on the list/).length)
      .toBeGreaterThan(0)
  })
})

describe('where we are on the hospital\'s list', () => {
  // The two cases that showed the first attempt was wrong. Hollis is first up but
  // on an afternoon list. Pennant is second up on JPW's list behind a PLIF
  // using KT Medical kit we are not at, so we are wanted about one o'clock.
  // Neither is expressible by moving our own cases past each other, and both
  // are the only case of ours at that hospital that day.

  const hollis = ev('c20', 'Hollis DIPLOMAT - Dubey',
    'Surg: Dubey\nPt: Hollis\nHosp: RHH\nSurgery: L4/5 PSF\nKit: Diplomat (Consignment)\n'
    + 'List: 1st · afternoon',
    { day: '22' })

  const pennant = ev('c21', 'Pennant DIPLOMAT - JPW',
    'Surg: JPW\nPt: Pennant\nHosp: Calvary\nSurgery: L4/5 PLIF\nKit: Diplomat (Consignment)\n'
    + 'List: 2nd · afternoon · from 1pm · after a PLIF — KT Medical, not ours',
    { day: '22', location: 'Calvary' })

  beforeEach(() => { events = [...BOOKINGS, hollis, pennant] })

  it('reads the place off the booking and says it on the card', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Week' }))

    await waitFor(() => expect(screen.getByText('Pennant')).toBeInTheDocument())
    expect(screen.getByText('1st on the list · PM')).toBeInTheDocument()
    expect(screen.getByText('2nd on the list · PM · from 1pm')).toBeInTheDocument()
    expect(screen.getByText('after a PLIF — KT Medical, not ours')).toBeInTheDocument()
  })

  it('does not show the line back as an unread note', async () => {
    // Every labelled field the app understands is consumed. A "List:" line
    // repeated underneath the card as prose is exactly the raw-text noise the
    // app was asked to stop showing.
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Week' }))
    await waitFor(() => expect(screen.getByText('Pennant')).toBeInTheDocument())
    expect(screen.queryByText(/^List:/)).not.toBeInTheDocument()
  })

  it('offers to set it even where it is our only case at that hospital', async () => {
    // The gap that made the arrows useless: nothing to move Pennant past.
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Week' }))

    await waitFor(() => expect(screen.getByText('Pennant')).toBeInTheDocument())
    expect(screen.getByLabelText('Set where Pennant is on the list')).toBeInTheDocument()
    expect(screen.getByLabelText('Set where Hollis is on the list')).toBeInTheDocument()
  })

  it('saves what the sheet was told, onto the booking', async () => {
    global.fetch = vi.fn(async url => (
      String(url).includes('action=listplace')
        ? { ok: true, json: async () => ({ ok: true }) }
        : { ok: true, json: async () => ({ events, syncedAt: '2026-09-21T02:00:00.000Z' }) }
    ))
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Week' }))
    await waitFor(() => expect(screen.getByText('Pennant')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Set where Pennant is on the list'))
    await waitFor(() => expect(screen.getByText('List order')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '3rd' }))
    fireEvent.click(screen.getByRole('button', { name: 'Morning' }))
    fireEvent.click(screen.getByRole('button', { name: /Save list order/ }))

    await waitFor(() => {
      const call = global.fetch.mock.calls.find(([u]) => String(u).includes('action=listplace'))
      expect(call).toBeTruthy()
      expect(JSON.parse(call[1].body)).toMatchObject({
        eventId: 'c21',
        place: { position: 3, session: 'morning' }
      })
    })
  })
})

describe('setting the list order on the day you are looking at', () => {
  // Reported as "nothing has changed in the app" while looking at Thursday in
  // the day view. Both views have to offer it, and on a day where we have one
  // case at a hospital, which is the ordinary shape of a day.
  const alone = ev('c30', 'Hollis DIPLOMAT - Dubey',
    'Surg: Dubey\nPt: Hollis\nHosp: RHH\nSurgery: L4/5 PSF\nKit: Diplomat (Consignment)',
    { day: '24' })

  beforeEach(() => { events = [...BOOKINGS, alone] })

  it('offers it in the day view', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    // Thursday, where the report came from.
    fireEvent.click(screen.getByRole('button', { name: /Thursday 24 September/ }))
    await waitFor(() => expect(screen.getByText('Hollis')).toBeInTheDocument())
    expect(screen.getByLabelText('Set where Hollis is on the list')).toBeInTheDocument()
  })

  it('offers it in the week view', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Week' }))
    await waitFor(() => expect(screen.getByText('Hollis')).toBeInTheDocument())
    expect(screen.getByLabelText('Set where Hollis is on the list')).toBeInTheDocument()
  })

  it('offers it on a cancelled-free day with several hospitals', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Week' }))
    await waitFor(() => expect(screen.getByText('Larkin')).toBeInTheDocument())
    // Calvary, one case, no arrows possible — and still settable.
    expect(screen.getByLabelText('Set where Larkin is on the list')).toBeInTheDocument()
  })
})

describe('controls that are actually tappable', () => {
  // "There's a set list order button but it won't let me do anything." It was a
  // <span role="button"> inside the card's <button>. Nested interactive content
  // is invalid HTML and a browser is entitled not to deliver the tap to the
  // inner element — which is what happened on the phone, while every test
  // passed, because jsdom dispatches straight at the element and skips the
  // hit-testing a real browser does first.
  //
  // So the guard is structural, not behavioural: nothing interactive may sit
  // inside anything else interactive. A click test cannot catch this and this
  // cannot catch a broken click, so both are kept.
  const NESTED = 'button button, button [role="button"], button a[href], button input, button select'

  const second = ev('c9', 'Pearse DIPLOMAT - Fowler',
    'Surg: Fowler\nPt: Pearse\nHosp: RHH\nSurgery: L4/5 PLIF\nKit: Diplomat (Consignment)',
    { at: '10:00' })

  beforeEach(() => { events = [...BOOKINGS, second] })

  it('never nests one control inside another, in the day view', async () => {
    const { container } = show()
    await waitFor(() => expect(screen.getByText('Pearse')).toBeInTheDocument())
    expect([...container.querySelectorAll(NESTED)].map(el => el.outerHTML.slice(0, 120)))
      .toEqual([])
  })

  it('never nests one control inside another, in the week view', async () => {
    const { container } = show()
    await waitFor(() => expect(screen.getByText('Pearse')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Week' }))
    await waitFor(() => expect(screen.getByText('Larkin')).toBeInTheDocument())
    expect([...container.querySelectorAll(NESTED)].map(el => el.outerHTML.slice(0, 120)))
      .toEqual([])
  })

  it('opens the list order sheet without also opening the booking', async () => {
    // The two controls sit on one card. Tapping one must not do both.
    show()
    await waitFor(() => expect(screen.getByText('Pearse')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Set where Pearse is on the list'))

    await waitFor(() => expect(screen.getByText('List order')).toBeInTheDocument())
    expect(screen.queryByText('Edit booking')).not.toBeInTheDocument()
  })
})

describe('saving a list order and seeing it', () => {
  // "I selected everything and then hit set list order and nothing changed."
  // The write reached Google; the reply was discarded as identical, because the
  // signature the plan is compared on did not mention the running order. The
  // whole round trip has to be exercised, not just the request.
  const withPlace = (id, place) => ev(id, 'Pennant DIPLOMAT - JPW',
    'Surg: JPW\nPt: Pennant\nHosp: RHH\nSurgery: L4/5 PLIF\nKit: Diplomat (Consignment)'
    + (place ? `\nList: ${place}` : ''),
    { day: '21', at: '11:00' })

  beforeEach(() => {
    events = [...BOOKINGS, withPlace('c40', null)]
    global.fetch = vi.fn(async url => {
      if (String(url).includes('action=listplace')) {
        // What the server does: writes the line onto the booking. The next read
        // of the calendar sees it, which is the part that was broken.
        events = [...BOOKINGS, withPlace('c40', '2nd · afternoon · from 1pm')]
        return { ok: true, json: async () => ({ ok: true }) }
      }
      return { ok: true, json: async () => ({ events, syncedAt: '2026-09-21T02:00:00.000Z' }) }
    })
  })

  it('shows the order on the card once it is saved', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Pennant')).toBeInTheDocument())
    expect(screen.queryByText(/on the list/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Set where Pennant is on the list'))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'List order' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '2nd' }))
    fireEvent.click(screen.getByRole('button', { name: 'Afternoon' }))
    fireEvent.click(screen.getByRole('button', { name: /Save list order/ }))

    // The sheet goes, and the card says it.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'List order' })).not.toBeInTheDocument())
    await waitFor(() =>
      expect(screen.getByText('2nd on the list · PM · from 1pm')).toBeInTheDocument())
  })

  it('offers to change it rather than set it, once there is one', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Pennant')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Set where Pennant is on the list'))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'List order' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '2nd' }))
    fireEvent.click(screen.getByRole('button', { name: /Save list order/ }))

    await waitFor(() => expect(screen.getByText('Change list order')).toBeInTheDocument())
  })
})

describe('getting back to today from a week that is not this one', () => {
  // Reported on Friday 2 October: "The back to today button at the top of the
  // cases screen is not working. It's stuck on next monday 5/10/26."
  //
  // The app opens on next week from Friday onwards, deliberately — that is the
  // week being planned. "Back to today" used the same resolver, so it set the
  // window to the week already showing, could not find today in it, and fell
  // back to the first day of it. Every weekend since the roll-forward landed.
  const FRIDAY = new Date('2026-10-02T02:00:00.000Z')  // Friday, midday Hobart

  const onFriday = () => {
    vi.setSystemTime(FRIDAY)
    events = [
      ev('f1', 'Hollis DIPLOMAT - Dubey',
        'Surg: Dubey\nPt: Hollis\nHosp: RHH\nKit: Diplomat (Consignment)',
        { day: '02' }),
      ev('n1', 'Kemp DIPLOMAT - Thani',
        'Surg: Thani\nPt: Kemp\nHosp: RHH\nKit: Diplomat (Consignment)',
        { day: '05' })
    ].map(e => ({
      ...e,
      start: { dateTime: e.start.dateTime.replace('2026-09', '2026-10') },
      end: { dateTime: e.end.dateTime.replace('2026-09', '2026-10') }
    }))
  }

  it('opens on this week, on a Friday as on any other day', async () => {
    // "The portal keeps defaulting back to the last date you were looking at,
    // instead of defaulting back to today's date."
    //
    // It never remembered a date. It rolled forward to next week from Friday
    // — three days in seven where the app opened somewhere that was not
    // today, which is indistinguishable from a week somebody left it on.
    onFriday()
    show()
    await waitFor(() => expect(screen.getByText('Hollis')).toBeInTheDocument())
    expect(screen.queryByText('Kemp')).not.toBeInTheDocument()
  })

  it('offers no way back, being already there', async () => {
    onFriday()
    show()
    await waitFor(() => expect(screen.getByText('Hollis')).toBeInTheDocument())
    expect(screen.queryByText(/Back to today/i)).not.toBeInTheDocument()
  })

  it('still has next week one tap away', async () => {
    // Which is the thing the roll-forward was for, and it was never the only
    // way to get there.
    onFriday()
    show()
    await waitFor(() => expect(screen.getByText('Hollis')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText(/next week/i))
    await waitFor(() => expect(screen.getByText('Kemp')).toBeInTheDocument())
  })

  it('comes back to today from wherever the arrows went', async () => {
    onFriday()
    show()
    await waitFor(() => expect(screen.getByText('Hollis')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText(/next week/i))
    await waitFor(() => expect(screen.getByText(/Back to today/i)).toBeInTheDocument())
    fireEvent.click(screen.getByText(/Back to today/i))
    await waitFor(() => expect(screen.getByText('Hollis')).toBeInTheDocument())
  })

})

describe('a case we have been told about but are not needed at', () => {
  // "Brainlab F2F Not required" — the hospital letting us know, not asking us
  // to come. Useful on the calendar; must not look like a case anybody is
  // driving to.
  const notNeeded = ev('c50', 'Mathieson BRAINLAB - Ibbett',
    'Surg: Ibbett\nPt: Mathieson\nHosp: RHH\nProcedure: L4/5 decompression\n'
    + 'Brainlab F2F Not required')

  beforeEach(() => { events = [...BOOKINGS, notNeeded] })

  it('says so on the card', async () => {
    const { container } = show()
    await waitFor(() => expect(screen.getByText('Mathieson')).toBeInTheDocument())
    const badge = [...container.querySelectorAll('span')]
      .find(el => el.textContent === 'We are not needed' && el.style.borderRadius === '999px')
    expect(badge).toBeTruthy()
  })

  it('is not counted as a case anybody is going to', async () => {
    // The count line is what the day is staffed from. Mardon is the real
    // RHH case; Mathieson is the one we were only told about.
    show()
    await waitFor(() => expect(screen.getByText('Mathieson')).toBeInTheDocument())
    expect(screen.getByText(/1 case — 1 RHH · 1 we are not needed at/)).toBeInTheDocument()
  })

  it('keeps the case on the day, because it is still on', async () => {
    // It is why the theatre is busy and why the surgeon is unavailable.
    show()
    await waitFor(() => expect(screen.getByText('Mathieson')).toBeInTheDocument())
    expect(screen.getByText(/L4\/5 decompression/)).toBeInTheDocument()
  })

  // The badge used to carry this: filled on a case we are attending, outlined
  // on one we are not. The badge is gone — "remove the AIRO badge, just have
  // AIRO listed in the notes" — so the distinction it drew has to be made by
  // the thing that was already making it, which is the card saying outright
  // that we are not needed. A second signal of the same fact is what a badge
  // on most of the week amounts to.

  it('still says we are not needed, which is what changes the day', async () => {
    // The platform itself moved off the tile. Whether anybody goes did not —
    // it is one of the three things kept, because it decides the morning.
    show()
    await waitFor(() => expect(screen.getByText('Mathieson')).toBeInTheDocument())
    expect(screen.getAllByText(/not needed/i).length).toBeGreaterThan(0)
  })

  it('does not dress it up as a case we are attending', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mathieson')).toBeInTheDocument())
    // More than one place says it — the card and the day's count line — which
    // is the point: the fact is already carried without a badge drawing it.
    expect(screen.getAllByText(/not needed/i).length).toBeGreaterThan(0)
  })

  it('says nothing of the sort on an ordinary case', async () => {
    events = [...BOOKINGS, ev('c51', 'Nunan AIRO - Ibbett',
      'Surg: Ibbett\nPt: Nunan\nHosp: RHH\nProcedure: L4/5 PSF with AIRO')]
    show()
    await waitFor(() => expect(screen.getByText('Nunan')).toBeInTheDocument())
    expect(screen.queryByText(/We are not needed/i)).not.toBeInTheDocument()
  })
})

describe('getting back to today from another day of this week', () => {
  // Reported twice. The second half of it: the button asked whether today was
  // in the week on screen, which is the right question in the week view and
  // the wrong one in the day view. Standing on Monday of this week, the app
  // decided you were already here — it hid the label and did nothing when the
  // button was pressed.
  it('offers the way back once you move off today', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    // Monday 21 September is today in these tests; move to Tuesday.
    fireEvent.click(screen.getByRole('button', { name: /Tuesday 22 September/ }))
    await waitFor(() => expect(screen.getByText(/Back to today/i)).toBeInTheDocument())
  })

  it('actually goes back', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Tuesday 22 September/ }))
    await waitFor(() => expect(screen.getByText('Vellacott')).toBeInTheDocument())

    fireEvent.click(screen.getByText(/Back to today/i))
    // Monday's case is back, Tuesday's is gone.
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(screen.queryByText('Vellacott')).not.toBeInTheDocument()
  })

  it('does not offer it while you are on today', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(screen.queryByText(/Back to today/i)).not.toBeInTheDocument()
  })

  it('in the week view, asks about the week rather than the day', async () => {
    // A week view showing today does not need a way back to it — today is on
    // screen. The question is genuinely different in each view.
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Week' }))
    await waitFor(() => expect(screen.getByText('Larkin')).toBeInTheDocument())
    expect(screen.queryByText(/Back to today/i)).not.toBeInTheDocument()
  })
})

describe('who is team leader this week', () => {
  // It was a calendar entry somebody had to remember to move, so it drifted —
  // Mat showed as team leader through a week he spent on TOIL. The portal owns
  // it now, and anybody on the team can change it with a tap: the person who
  // knows the rota has changed is usually the one it changed to.
  beforeEach(() => {
    global.fetch = vi.fn(async (url, opts) => {
      if (String(url).includes('action=leader')) {
        if (opts?.method === 'POST') return { ok: true, json: async () => ({ ok: true }) }
        return {
          ok: true,
          json: async () => ({ ok: true, week: '2026-09-21', leader: { email: 'ben@technomed.com.au', firstName: 'Ben' } })
        }
      }
      return { ok: true, json: async () => ({ events, syncedAt: '2026-09-21T02:00:00.000Z' }) }
    })
  })

  it('names them on the week', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Ben')).toBeInTheDocument())
    expect(screen.getByText('Team leader')).toBeInTheDocument()
  })

  it('opens a picker on a tap', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Ben')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Team leader:/ }))
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Team leader' })).toBeInTheDocument())
    expect(screen.getByText(/Monday 7am to Friday 5pm/)).toBeInTheDocument()
  })

  it('saves the person tapped, against that week', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Ben')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Team leader:/ }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Team leader' })).toBeInTheDocument())
    fireEvent.click(screen.getByText(/^Aimee/))

    await waitFor(() => {
      const post = global.fetch.mock.calls.find(
        ([u, o]) => String(u).includes('action=leader') && o?.method === 'POST')
      expect(post).toBeTruthy()
      expect(String(post[0])).toContain('week=2026-09-21')
      expect(JSON.parse(post[1].body).email).toBe('aimee@technomed.com.au')
    })
  })

  it('can be set to nobody', async () => {
    // A week nobody is covering should say so, rather than keep naming
    // whoever held it last.
    show()
    await waitFor(() => expect(screen.getByText('Ben')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Team leader:/ }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Team leader' })).toBeInTheDocument())
    fireEvent.click(screen.getByText('Nobody this week'))

    await waitFor(() => {
      const post = global.fetch.mock.calls.find(
        ([u, o]) => String(u).includes('action=leader') && o?.method === 'POST')
      expect(JSON.parse(post[1].body).email).toBe(null)
    })
  })
})

describe('the team leader on the day', () => {
  // "The team leader notation is doubled up at the top of the page — there's a
  // spot to amend the team leader and then the actual team leader is listed a
  // second time. Just have the one option/tab that allows you to adjust, and
  // also informs you."
  //
  // It was put on the day deliberately, on an earlier instruction: "the option
  // to change the team leader at the top is good, but it should still appear in
  // the items under 'Brent on call'." Both of those are reasonable, and on the
  // day that is actually on screen they turn out to be the same sentence twice
  // a few centimetres apart. The strip wins because it is the one that can be
  // acted on.
  const leaderReplies = who => vi.fn(async (url, opts) => {
    if (String(url).includes('action=leader')) {
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ ok: true }) }
      return { ok: true, json: async () => ({ ok: true, leader: who }) }
    }
    return { ok: true, json: async () => ({ events, syncedAt: '2026-09-21T02:00:00.000Z' }) }
  })

  it('names them once, in the place that can also change them', async () => {
    global.fetch = leaderReplies({ email: 'ben@technomed.com.au', firstName: 'Ben' })
    show()
    // The strip, which is a button: it says who, and opens the chooser.
    await waitFor(() => expect(
      screen.getByLabelText(/Team leader: Ben\. Change\./)).toBeInTheDocument())
    // And nowhere else. The pill on the day said the same thing and could not
    // be acted on.
    expect(screen.queryByText('Ben — team leader')).not.toBeInTheDocument()
  })

  it('says nothing on a day nobody has been set for', async () => {
    global.fetch = leaderReplies(null)
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(screen.queryByText(/team leader$/)).not.toBeInTheDocument()
  })

  it('warns when the person set is on leave that week', async () => {
    // Mat was Spine Team Leader through a week he spent on TOIL. Two facts the
    // app held at once and never compared.
    events = [...BOOKINGS, {
      id: 'lv', summary: 'Mat - ANNUAL LEAVE', description: '',
      start: { date: '2026-09-21' }, end: { date: '2026-09-26' }
    }]
    global.fetch = leaderReplies({ email: 'mat@technomed.com.au', firstName: 'Mat' })
    show()
    await waitFor(() => expect(screen.getByText('On leave')).toBeInTheDocument())
  })
})

describe('the rota and covering for somebody', () => {
  // "Ordinarily Mat would be team leader this coming week, but I am covering
  // for him." A rota plus an override, and the screen has to tell them apart —
  // "Brent is covering for Mat" and "it is Brent's turn" are different facts
  // and only one of them is true.
  const reply = payload => vi.fn(async (url, opts) => {
    if (String(url).includes('action=leader')) {
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ ok: true }) }
      return { ok: true, json: async () => ({ ok: true, ...payload }) }
    }
    return { ok: true, json: async () => ({ events, syncedAt: '2026-09-21T02:00:00.000Z' }) }
  })

  it('names whoever the rota says, with nothing saved', async () => {
    global.fetch = reply({
      leader: { email: 'mat@technomed.com.au', firstName: 'Mat' },
      source: 'roster',
      rostered: { email: 'mat@technomed.com.au', firstName: 'Mat' }
    })
    show()
    // Scoped to the strip: "Mat" turns up elsewhere on a week view.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Team leader/ }).textContent).toContain('Mat'))
    expect(screen.queryByText(/covering for/)).not.toBeInTheDocument()
  })

  it('says who is covering for whom', async () => {
    global.fetch = reply({
      leader: { email: 'brenton@technomed.com.au', firstName: 'Brent' },
      source: 'set',
      rostered: { email: 'mat@technomed.com.au', firstName: 'Mat' }
    })
    show()
    await waitFor(() => expect(screen.getByText(/covering for Mat/)).toBeInTheDocument())
  })

  it('does not say covering when the person set is the rostered one', async () => {
    // Confirming the rota is not a cover.
    global.fetch = reply({
      leader: { email: 'mat@technomed.com.au', firstName: 'Mat' },
      source: 'set',
      rostered: { email: 'mat@technomed.com.au', firstName: 'Mat' }
    })
    show()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Team leader/ }).textContent).toContain('Mat'))
    expect(screen.queryByText(/covering for/)).not.toBeInTheDocument()
  })

  it('offers to put the rota back rather than leaving nobody on', async () => {
    global.fetch = reply({
      leader: { email: 'brenton@technomed.com.au', firstName: 'Brent' },
      source: 'set',
      rostered: { email: 'mat@technomed.com.au', firstName: 'Mat' }
    })
    show()
    await waitFor(() => expect(screen.getByText(/covering for Mat/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Team leader:/ }))
    await waitFor(() =>
      expect(screen.getByText('Back to the roster — Mat')).toBeInTheDocument())
  })
})

describe('the header, pared back', () => {
  // "Move the team leader banner down to just below the dates and make it a
  // section like the add a booking button. Ditch the case number tally and
  // the cases each day reference."
  it('puts the team leader on the page, not in the navy header', async () => {
    const { container } = show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    const strip = screen.getByRole('button', { name: /Team leader:/ })
    // The header is the navy block; the strip now sits in the body below it,
    // with the inbox and the rest of the things you can open from here.
    const header = container.querySelector('.tm-bleed')
    expect(header).toBeTruthy()
    expect(header.contains(strip)).toBe(false)
  })

  it('leaves no count badges behind in the strip', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    const monday = screen.getByRole('button', { name: 'Monday 21 September' })
    // Just the day and the date. Monday carries one case in the fixtures, and
    // the badge that used to say so has gone.
    expect(monday.textContent).toBe('Mon21st')
  })
})

describe('the preference card on a phone', () => {
  // It used to sit on the tile beside the list order, asked for in those
  // words: "a button on the booking for each case next to where it says List
  // order that takes you to a surgeon preferences page".
  //
  // It has moved inside the booking: "it might be better to have slightly
  // less information on view when you look at it in the portal view... the
  // preferences button could be inside the booking itself." Both are right —
  // the second is about a tile you glance at, and reading a preference card
  // is not glancing. The desktop column keeps it, having the room.
  it('is not on the tile any more', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(screen.queryByLabelText(/^Preferences for /)).not.toBeInTheDocument()
  })

  it('leaves the list order where it was, which is a thing you change', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(screen.getAllByLabelText(/is on the list$/).length).toBeGreaterThan(0)
  })
})

describe('a booking with two systems supplied differently', () => {
  // "The preview in the app screen of the booking says Mariner/E4 Global BMD
  // PLIF Distributor loan, which makes it look like both systems are loan
  // when they are not."
  //
  // The card carried one supply for the whole line, so a booking with two
  // systems showed whichever answer was read first against both of them. The
  // E4 cages being consignment is exactly what somebody checks before leaving
  // the office.
  beforeEach(() => {
    events = [{
      id: 'loane', summary: 'Loane MARINER MIS (DT LOAN) + E4 BMD - Gupta',
      description: 'Surg - Gupta\nPt - Loane\nHosp: CLV\n'
        + 'Procedure: L3-S1 MIS Pedicle Screw Fixation\n'
        + 'Kit: Mariner (DT LOAN) E4 Global PLIF (Consignment)',
      start: { dateTime: '2026-09-21T09:00:00+10:00' },
      end: { dateTime: '2026-09-21T10:00:00+10:00' },
      location: 'CLV'
    }]
  })

  it('gives each system its own answer', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Loane')).toBeInTheDocument())
    const card = screen.getByText('Loane').closest('div')
    expect(card.textContent).toMatch(/Mariner \(Distributor Loan\)/)
    expect(card.textContent).toMatch(/E4 Global PLIF \(Consignment\)/)
  })

  it('says when the kit is one of ours off the office shelf', async () => {
    // "We need to add a TM Loan option to the where-the-kit-is-coming-from
    // tab." A fourth answer and a fourth job: no request to anybody, no trip
    // to RHH — somebody puts the Shoreline in a car on the way through.
    events = [{
      id: 'tm', summary: 'Quintrell SHORELINE - Ibbett',
      description: 'Surg - Ibbett\nPt - Quintrell\nHosp: CLV\n'
        + 'Procedure: L4-L5 ALIF\nKit: Shoreline (TM Loan)',
      start: { dateTime: '2026-09-21T09:00:00+10:00' },
      end: { dateTime: '2026-09-21T10:00:00+10:00' },
      location: 'CLV'
    }]
    show()
    await waitFor(() => expect(screen.getByText('Quintrell')).toBeInTheDocument())
    const card = screen.getByText('Quintrell').closest('div')
    expect(card.textContent).toMatch(/Shoreline \(TM Loan\)/)
  })

  it('does not read as though both are on loan', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Loane')).toBeInTheDocument())
    const card = screen.getByText('Loane').closest('div')
    // The old line: the two systems run together, then one supply after them.
    expect(card.textContent).not.toMatch(/E4 Global PLIF · Distributor Loan/)
  })

  it('leaves an ordinary one-system booking alone', async () => {
    // Shorter and reads better. The split only earns its keep where the
    // single line is actually wrong.
    events = [{
      id: 'one', summary: 'Hollis DIPLOMAT - Ibbett',
      description: 'Surg: Ibbett\nPt: Hollis\nHosp: RHH\nKit: Diplomat (Consignment)',
      start: { dateTime: '2026-09-21T09:00:00+10:00' },
      end: { dateTime: '2026-09-21T10:00:00+10:00' },
      location: 'RHH'
    }]
    show()
    await waitFor(() => expect(screen.getByText('Hollis')).toBeInTheDocument())
    const card = screen.getByText('Hollis').closest('div')
    // One system, one answer — still one line, and the answer is bracketed
    // and attached to the system it belongs to like everywhere else.
    expect(card.textContent).toMatch(/Diplomat \(Consignment\)/i)
  })
})

describe('a supply on every booking', () => {
  // "Pt Bannister for KT Medical doesn't say whether it was consignment or
  // loan. Those labels must be on every booking in every entry in the app."
  // "You need to scan and know what kits are where at each hospital (you
  // already know) and then assign."
  //
  // The label was missing wherever nobody had typed it, which is most
  // bookings — "Kit: KT Lonestar" is a natural thing to write. An absent
  // label reads like a decision nobody has made, so the cases that needed
  // chasing looked identical to the ones that did not.
  const booking = (kit, hospital = 'RHH', patient = 'Bannister') => ({
    id: patient, summary: `${patient} ${kit} - JPW`,
    description: `Surgeon: JPW\nPatient: ${patient}\nHospital: ${hospital}\nKit: ${kit}`,
    start: { dateTime: '2026-09-21T09:00:00+10:00' },
    end: { dateTime: '2026-09-21T10:00:00+10:00' },
    location: hospital
  })

  const cardFor = async patient => {
    show()
    await waitFor(() => expect(screen.getByText(patient)).toBeInTheDocument())
    return screen.getByText(patient).closest('div').textContent
  }

  it('works out a supply nobody recorded', async () => {
    // Lonestar is consigned at RHH, so it is on the shelf.
    events = [booking('KT Lonestar')]
    expect(await cardFor('Bannister')).toMatch(/\(Consignment\?\)/)
  })

  it('marks a worked-out answer as one', async () => {
    // The inventory is dictated knowledge and goes stale. A guess dressed as
    // an answer is how a wrong one survives to the morning of the case.
    events = [booking('KT Lonestar')]
    const card = await cardFor('Bannister')
    expect(card).toContain('?')
    expect(card).not.toMatch(/\(Consignment\)/)
  })

  it('leaves a recorded answer unmarked', async () => {
    events = [booking('KT Lonestar (Consignment)')]
    const card = await cardFor('Bannister')
    expect(card).toMatch(/\(Consignment\)/)
    expect(card).not.toMatch(/Consignment\?/)
  })

  it('knows a Calvary Mariner case needs a distributor set', async () => {
    // Which is what Loane and O'Brien both actually have.
    events = [booking('Mariner', 'CLV', 'Loane')]
    expect(await cardFor('Loane')).toMatch(/\(Distributor Loan\?\)/)
  })

  it('knows the Athlet kit is one we move ourselves', async () => {
    events = [booking('Athlet', 'CLV', 'Quintrell')]
    expect(await cardFor('Quintrell')).toMatch(/\(RHH Loan\?\)/)
  })

  it('asks outright where it cannot work it out', async () => {
    // Better than silence: a system the inventory has never heard of is
    // exactly the one somebody needs to think about.
    events = [booking('Something Nobody Stocks')]
    expect(await cardFor('Bannister')).toMatch(/\(supply\?\)/)
  })

  it('says nothing for a case we are not attending', async () => {
    // No kit to bring, and a supply prompt here is noise standing next to
    // the cases that need one.
    events = [booking('Blab F2F not required', 'RHH', 'Gray')]
    expect(await cardFor('Gray')).not.toMatch(/supply\?|Consignment|Loan/)
  })
})

// ─── Tapping a day in the Lists view ─────────────────────────────────────────
// "The list view isn't refreshing automatically when you select the day... the
// list order view needs to correspond immediately and refresh immediately to
// whatever day you click on."
//
// Two separate faults behind that. The list was never told which day was
// selected, so it drew the whole week regardless; and the date strip, on a
// phone, switched you to the Day view as a side effect — so the one thing you
// could do to make the list respond was also the thing that took the list off
// the screen.
describe('the lists follow the day strip', () => {
  const toLists = async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Lists' }))
    return waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Lists' })).toHaveAttribute('aria-selected', 'true'))
  }

  it('stays in the lists when a day is tapped', async () => {
    await toLists()
    fireEvent.click(screen.getByLabelText(/Tuesday 22 September/i))
    expect(screen.getByRole('tab', { name: 'Lists' }))
      .toHaveAttribute('aria-selected', 'true')
  })

  it('shows the day that was tapped', async () => {
    // Monday is Mardon's; Tuesday is Vellacott's and Larkin's.
    //
    // The Lists assertion is load-bearing and not belt-and-braces. Without it
    // this passed against the broken build: the tap dropped out of Lists into
    // the Day view, which also shows Tuesday and not Monday — so the test
    // agreed with the screen for entirely the wrong reason.
    await toLists()
    expect(screen.getByText('Mardon')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/Tuesday 22 September/i))
    await waitFor(() => expect(screen.getByText('Vellacott')).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Lists' }))
      .toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText('Mardon')).not.toBeInTheDocument()
  })

  it('still takes you to the day view from the week, which it always did', async () => {
    // The early return is for the lists only. Tapping a date in the week view
    // opens that day, which is how the strip has always worked on a phone.
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Week' }))
    fireEvent.click(screen.getByLabelText(/Tuesday 22 September/i))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Day' }))
      .toHaveAttribute('aria-selected', 'true'))
  })
})

// ─── The screen that was left open ───────────────────────────────────────────
// "The auto refresh to the current day is also not working. The app needs to
// constantly refresh back to today's date."
//
// Today was worked out once, at mount, and never again. A screen left open on
// the office desk overnight was still on Monday on Tuesday morning, with
// Monday highlighted as today and nothing to say otherwise. The plan behind it
// refreshed every minute the whole time, so the data was right and the date it
// was filed under was wrong — which is worse than being plainly stale.
describe('following the date, with nobody touching it', () => {
  const selected = () =>
    document.querySelector('[aria-current="date"]')?.getAttribute('aria-label')

  it('moves to the new day when the date rolls over', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    expect(selected()).toMatch(/Monday 21 September/i)

    // Just past midnight, Hobart.
    //
    // What this guards is the wiring — the screen moving when the date does.
    // It does not, on its own, prove the date is rechecked: the minute poll
    // re-renders this component anyway, which is enough to notice here. The
    // part that holds when a poll changes nothing is useToday, and that is
    // guarded directly in liveRefresh.today.test.jsx.
    await act(async () => {
      vi.setSystemTime(new Date('2026-09-21T14:30:00.000Z'))
      vi.advanceTimersByTime(LIVE_POLL_MS + 10)
    })
    await waitFor(() => expect(selected()).toMatch(/Tuesday 22 September/i))
  })

  it('leaves the day alone while it is still the same day', async () => {
    // Somebody looking at Thursday should still be looking at Thursday a
    // minute later. The clock only moves the screen when the date moves.
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText(/Thursday 24 September/i))
    await act(async () => { vi.advanceTimersByTime(LIVE_POLL_MS * 3) })
    expect(selected()).toMatch(/Thursday 24 September/i)
  })

  it('goes back to today when the app is picked up again', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText(/Thursday 24 September/i))
    expect(selected()).toMatch(/Thursday 24 September/i)

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(AWAY_LONG_ENOUGH_MS + 1000)
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(selected()).toMatch(/Monday 21 September/i))
  })

  it('does not snap back for a flick away and straight back', async () => {
    // A photo picker closing, a notification dismissed. Resetting the week
    // out from under somebody adding a booking for next Thursday is worse
    // than the staleness it would prevent.
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText(/Thursday 24 September/i))

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(4000)
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(selected()).toMatch(/Thursday 24 September/i)
  })
})

// ─── What is due, on the morning view ────────────────────────────────────────
// "Anything due today appears on the Cases day view alongside the bookings, so
// the portal is one place you look each morning."
//
// The day view is where this team starts the day. A to-do list on a different
// tab is a to-do list that gets looked at on Fridays.
describe('project tasks that fall due', () => {
  const WORKLIST = [
    {
      id: 'w1', task: 'Get the Athlet tray back from RHH', assignee: 'Ben Cassidy',
      status: 'open', priority: 'normal', due_date: '2026-09-21'
    },
    {
      id: 'w2', task: 'Chase the Globus paperwork', assignee: 'Toni Hoppitt',
      status: 'open', priority: 'normal', due_date: '2026-09-18'
    },
    {
      id: 'w3', task: 'Book the Calvary in-service', assignee: 'Aimee Vulinovich',
      status: 'open', priority: 'normal', due_date: '2026-09-24'
    },
    {
      id: 'w4', task: 'Already handled', assignee: 'Ben Cassidy',
      status: 'done', priority: 'normal', due_date: '2026-09-21'
    }
  ]

  const withWorklist = () => {
    global.fetch = vi.fn(async url => {
      const at = String(url)
      if (at.includes('action=board')) {
        return { ok: true, json: async () => ({ items: WORKLIST, projects: [] }) }
      }
      if (at.includes('/api/guides')) {
        return { ok: true, json: async () => ({ guides: [], coming: [] }) }
      }
      return {
        ok: true,
        json: async () => ({ events, syncedAt: '2026-09-21T02:00:00.000Z' }),
        text: async () => ''
      }
    })
  }

  it('puts what is due today on today', async () => {
    withWorklist()
    show()
    await waitFor(() =>
      expect(screen.getByText(/Get the Athlet tray back from RHH/)).toBeInTheDocument())
  })

  it('brings the overdue one along, because it is still due', async () => {
    // A task due on Friday does not stop being due because it is Monday, and
    // a list that quietly drops it is a list that helped you forget.
    withWorklist()
    show()
    await waitFor(() =>
      expect(screen.getByText(/Chase the Globus paperwork/)).toBeInTheDocument())
    expect(screen.getByText(/Chase the Globus paperwork/).textContent)
      .toMatch(/overdue/)
  })

  it('leaves a later one for its own day', async () => {
    withWorklist()
    show()
    await waitFor(() =>
      expect(screen.getByText(/Get the Athlet tray back/)).toBeInTheDocument())
    expect(screen.queryByText(/Book the Calvary in-service/)).not.toBeInTheDocument()
  })

  it('leaves out what is already done', async () => {
    withWorklist()
    show()
    await waitFor(() =>
      expect(screen.getByText(/Get the Athlet tray back/)).toBeInTheDocument())
    expect(screen.queryByText(/Already handled/)).not.toBeInTheDocument()
  })

  it('names who has it, so the day view says whose job it is', async () => {
    withWorklist()
    show()
    await waitFor(() =>
      expect(screen.getByText(/Get the Athlet tray back/).textContent)
        .toMatch(/Ben Cassidy/))
  })

  it('ticks one off without leaving the week', async () => {
    // The point of putting these here is clearing them without changing tab.
    withWorklist()
    show()
    const row = await waitFor(() =>
      screen.getByLabelText('Tick off Get the Athlet tray back from RHH'))
    fireEvent.click(row)
    await waitFor(() => {
      const calls = global.fetch.mock.calls.filter(c => String(c[0]).includes('action=task'))
      expect(calls.length).toBeGreaterThan(0)
      expect(JSON.parse(calls[0][1].body)).toMatchObject({ id: 'w1', column: 'done' })
    })
  })

  it('still draws the week when the worklist will not load', async () => {
    // A missing to-do list is a smaller problem than a blank screen on the
    // morning of a list.
    global.fetch = vi.fn(async url => {
      if (String(url).includes('action=board')) throw new Error('Upstash is down')
      if (String(url).includes('/api/guides')) {
        return { ok: true, json: async () => ({ guides: [], coming: [] }) }
      }
      return {
        ok: true,
        json: async () => ({ events, syncedAt: '2026-09-21T02:00:00.000Z' }),
        text: async () => ''
      }
    })
    show()
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
  })
})
