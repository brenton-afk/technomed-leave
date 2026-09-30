import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import CaseWeek from './CaseWeek.jsx'
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
    // Resolved on the way in: the booking says "E4 Cages" and the procedure is
    // a PLIF, so the card names the cage the team actually has to bring.
    expect(screen.getByText(/Diplomat and Global BMD PLIF/)).toBeInTheDocument()
    expect(screen.getByText('Consignment')).toBeInTheDocument()
    // The rep the old calendar view dropped on the floor.
    expect(screen.getByText('Mat')).toBeInTheDocument()
  })

  it('shows the notes the team wrote, which neither old view did', async () => {
    // This is the whole reason a case moved, and it lived only in Google.
    show()
    fireEvent.click(await waitFor(() => screen.getByRole('tab', { name: 'Week' })))
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
    fireEvent.click(await waitFor(() => screen.getByRole('tab', { name: 'Week' })))
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
    fireEvent.click(await waitFor(() => screen.getByRole('tab', { name: 'Week' })))
    await screen.findByText('Sturrock')
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })

  it('leaves a rebooked case alone, however its notes read', async () => {
    // Marchetti's notes say "cancelled from Friday 18/9". The case is live.
    show()
    fireEvent.click(await waitFor(() => screen.getByRole('tab', { name: 'Week' })))
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
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Previous week/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Next week/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Today$/ })).not.toBeInTheDocument()
  })

  it('gives the week arrows a real tap target', async () => {
    // Reported as "the arrows to cycle through the weeks are very small". They
    // were a 19px glyph with 2px of padding — roughly 23 by 22 — and they are
    // the most-used control on the screen. 44 is Apple's minimum.
    show()
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
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
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Day' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Week' })).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(screen.getByRole('tab', { name: 'Week' }))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Week' })).toHaveAttribute('aria-selected', 'true'))
  })

  it('only offers a way back to today when you have left it', async () => {
    // Tapping the week range to come back was an affordance nobody could see.
    show()
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
    expect(screen.queryByText(/Back to today/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Next week/ }))
    await waitFor(() => expect(screen.getByText(/Back to today/i)).toBeInTheDocument())
  })

  it('offers adding a booking as a row, not a floating button', async () => {
    // The circle pinned to the bottom corner drifted off with the content: it
    // was positioned against a container that scrolls. A row cannot drift, and
    // cannot float over the last case of a long list either.
    show()
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
    const add = screen.getByRole('button', { name: /Add a booking/ })
    expect(add).toBeInTheDocument()
    expect(add.style.position).not.toBe('absolute')
    expect(add.style.position).not.toBe('fixed')
  })

  it('names the day it sits under, and opens the sheet on it', async () => {
    // One fewer thing to choose for the booking somebody is most likely making.
    show()
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
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
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
  })

  it('says nothing when both calendars read fine', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
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
    const firstCase = screen.getByText('Chalmers')
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
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
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
  it('says what it is counting', async () => {
    // "It wouldn't be obvious what that number means." A bare digit under a
    // date is anybody's guess, so the strip is labelled once.
    show()
    await waitFor(() => expect(screen.getByText(/Cases each day/i)).toBeInTheDocument())
  })

  it('reads as a count to a screen reader too', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
    // Monday 21 September carries one case in the fixtures.
    expect(screen.getByRole('button', { name: /Monday 21 September, 1 case$/ }))
      .toBeInTheDocument()
    // Two, not three: Sturrock on the 22nd is cancelled, and the badge counts
    // what is going ahead.
    expect(screen.getByRole('button', { name: /Tuesday 22 September, 2 cases$/ }))
      .toBeInTheDocument()
  })
})

describe('the running order', () => {
  // The hospital rings about four o'clock the afternoon before and reads out
  // the order the list will run in. Whether our case is first up or third
  // decides whether somebody is on site at half seven or has a free morning —
  // it was posted to the WhatsApp group and read off a phone. Here it is the
  // order the cases sit in, and the calendar follows.

  const second = ev('c9', 'Pearse DIPLOMAT - Fowler',
    'Surg: Fowler\nPt: Pearse\nHosp: RHH\nSurgery: L4/5 PLIF\nKit: Diplomat (Consignment)',
    { at: '10:00' })

  const posted = () => global.fetch.mock.calls.find(
    ([url]) => String(url).includes('action=reorder'))

  beforeEach(() => {
    events = [...BOOKINGS, second]
    global.fetch = vi.fn(async url => (
      String(url).includes('action=reorder')
        ? { ok: true, json: async () => ({ ok: true, moved: 2 }) }
        : { ok: true, json: async () => ({ events, syncedAt: '2026-09-21T02:00:00.000Z' }) }
    ))
  })

  it('numbers the cases and offers to move them', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Pearse')).toBeInTheDocument())
    expect(screen.getByText(/Move a case with the arrows/)).toBeInTheDocument()
    expect(screen.getByLabelText('Move Chalmers up the list')).toBeDisabled()
    expect(screen.getByLabelText('Move Pearse down the list')).toBeDisabled()
  })

  it('sends the new order to the calendar', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Pearse')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Move Pearse up the list'))

    await waitFor(() => expect(posted()).toBeTruthy())
    const [url, options] = posted()
    expect(url).toContain('date=2026-09-21')
    expect(JSON.parse(options.body).order).toEqual(['c9', 'c1'])
    expect(screen.queryByText(/did not save/i)).not.toBeInTheDocument()
  })

  it('says so when the order does not save', async () => {
    // Silently keeping a new order on screen that never reached the calendar is
    // the worst of both: the team leader believes it is posted and nobody else
    // can see it.
    global.fetch = vi.fn(async url => (
      String(url).includes('action=reorder')
        ? { ok: false, json: async () => ({ error: 'nope' }) }
        : { ok: true, json: async () => ({ events, syncedAt: '2026-09-21T02:00:00.000Z' }) }
    ))
    show()
    await waitFor(() => expect(screen.getByText('Pearse')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Move Pearse up the list'))
    await waitFor(() => expect(screen.getByText(/did not save/i)).toBeInTheDocument())
  })

  it('shows the new order straight away, before Google has caught up', async () => {
    // A round trip on a hospital connection takes a couple of seconds, and an
    // arrow that does nothing for two seconds gets pressed again.
    const { container } = show()
    await waitFor(() => expect(screen.getByText('Pearse')).toBeInTheDocument())

    const order = () => [...container.querySelectorAll('button')]
      .map(b => b.textContent)
      .filter(t => t.includes('Chalmers') || t.includes('Pearse'))
      .map(t => (t.includes('Chalmers') ? 'Chalmers' : 'Pearse'))

    expect(order()).toEqual(['Chalmers', 'Pearse'])
    fireEvent.click(screen.getByLabelText('Move Pearse up the list'))
    await waitFor(() => expect(order()).toEqual(['Pearse', 'Chalmers']))
  })

  it('leaves a called-off case out of the order', async () => {
    // It keeps its place on screen — the team needs to know it was booked and
    // who may already be driving to it — but the calendar closes up around a
    // cancelled case, so numbering it would have the card say third while the
    // calendar said second.
    const off = ev('c8', 'CANCELLED Mackey DIPLOMAT - Fowler',
      'Surg: Fowler\nPt: Mackey\nHosp: RHH\nKit: Diplomat (Consignment)', { at: '09:30' })
    events = [...BOOKINGS, off, second]
    show()
    await waitFor(() => expect(screen.getByText('Pearse')).toBeInTheDocument())

    expect(screen.getByText('Mackey')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Mackey.*the list/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Move Pearse up the list'))
    await waitFor(() => expect(posted()).toBeTruthy())
    expect(JSON.parse(posted()[1].body).order).toEqual(['c9', 'c1'])
  })

  it("orders tomorrow's list from the week, which is where you look ahead", async () => {
    // This is the case it exists for. The hospital rings about four o'clock
    // about tomorrow, never about today, and the app opens on today — so the
    // one thing this was built for must not be the awkward one.
    const alsoTomorrow = ev('c7', 'Vowles DIPLOMAT - Atallah',
      'Surg: Atallah\nPt: Vowles\nHosp: RHH\nSurgery: L4/5 PSF\nKit: Diplomat (Consignment)',
      { day: '22', at: '11:00' })
    events = [...BOOKINGS, alsoTomorrow]
    show()
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Week' }))

    await waitFor(() => expect(screen.getByText('Vowles')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Move Vowles up the list'))

    await waitFor(() => expect(posted()).toBeTruthy())
    // Tomorrow's date, not today's. The whole day goes, RHH reordered and
    // Calvary behind it untouched — the calendar lays a day out end to end,
    // even though the running order itself belongs to one hospital's list.
    expect(posted()[0]).toContain('date=2026-09-22')
    expect(JSON.parse(posted()[1].body).order).toEqual(['c7', 'c2', 'c3'])
  })

  it('does not offer to reorder a hospital with one case', async () => {
    events = BOOKINGS
    show()
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
    expect(screen.queryByText(/Move a case with the arrows/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/up the list/)).not.toBeInTheDocument()
  })
})
