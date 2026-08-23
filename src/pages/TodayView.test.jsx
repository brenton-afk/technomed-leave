import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import TodayView from './TodayView.jsx'
import { NAVIGATION_ACCENT, accentTextFor } from '../clinicalPlan/theme.js'

// A booking carries the case as labelled lines in its description. This screen
// used to print the event title instead and stop there, which is why the system
// and kit showed through raw and, when the notes repeated them, twice over.
//
// The rules these hold to: three lines at most, no label prefixes, nothing said
// twice, and a field that could not be read left out rather than shown as typed.

const USER = { name: 'Brenton Lovering', email: 'brenton@technomed.com.au', token: 'tok' }

let events

const at = (hour, day = 24) => `2026-08-${day}T${String(hour).padStart(2, '0')}:00:00+10:00`

/** Labelled description lines, as the team writes them. */
const notes = fields => Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')

const booking = (id, description, extra = {}) => ({
  id,
  title: 'Booking',
  description,
  location: null,
  start: at(10), end: at(11), allDay: false,
  colorId: '3', // Grape
  ...extra
})

const GRAPE = '#8e24aa'

/** jsdom reports colours as rgb(), so comparisons have to speak the same units. */
function asRgb(hex) {
  const [, r, g, b] = /^#(\w\w)(\w\w)(\w\w)$/.exec(hex)
  return `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-08-24T02:00:00.000Z')) // midday in Hobart
  localStorage.clear()
  events = []
  global.fetch = vi.fn(() => Promise.resolve({
    json: () => Promise.resolve({ events, today: '2026-08-24' })
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function show(list) {
  events = list
  const view = render(<TodayView user={USER} />)
  await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  return view
}

/** The colour of the strip down the left of the card containing `text`. */
function borderFor(container, text) {
  const strips = [...container.querySelectorAll('div')].filter(node => {
    const strip = node.firstElementChild
    return strip && strip.style.width === '5px' && node.textContent.includes(text)
  })
  return strips[0]?.firstElementChild?.style?.background
}

describe('reading the labelled description', () => {
  it('shows patient, surgeon, procedure and system — and nothing else', async () => {
    await show([booking('c1', notes({
      Surgeon: 'Fowler', Patient: 'Jackson', Procedure: 'C5/6 ACDF',
      Kit: 'Dakota (Consignment)', Hospital: 'RHH'
    }))])

    await waitFor(() => expect(screen.getByText('Jackson')).toBeInTheDocument())
    expect(screen.getByText('Fowler')).toBeInTheDocument()
    expect(screen.getByText('C5/6 ACDF')).toBeInTheDocument()
    expect(screen.getByText('DAKOTA · Consignment')).toBeInTheDocument()

    // No label survives, and no raw line either.
    expect(screen.queryByText(/Surgeon:|Patient:|Procedure:|Kit:|Hospital:/)).not.toBeInTheDocument()
    expect(screen.queryByText('Dakota (Consignment)')).not.toBeInTheDocument()
    expect(screen.queryByText('Booking')).not.toBeInTheDocument()
  })

  it.each([
    ['full words', { Surgeon: 'Ibbett', Patient: 'Horne', Procedure: 'L4/5 TLIF', Kit: 'Mariner (Loan)' }],
    ['short forms', { Surg: 'Ibbett', Pt: 'Horne', Op: 'L4/5 TLIF', Kit: 'Mariner (Loan)' }],
    ['lower case', { surgeon: 'Ibbett', patient: 'Horne', surgery: 'L4/5 TLIF', kit: 'Mariner (Loan)' }],
    ['mixed', { surg: 'Ibbett', Patient: 'Horne', operation: 'L4/5 TLIF', Kit: 'Mariner (Loan)' }]
  ])('reads the same case written with %s', async (_style, fields) => {
    await show([booking('c1', notes(fields))])
    await waitFor(() => expect(screen.getByText('Horne')).toBeInTheDocument())
    expect(screen.getByText('Ibbett')).toBeInTheDocument()
    expect(screen.getByText('L4/5 TLIF')).toBeInTheDocument()
    expect(screen.getByText('MARINER · Loan')).toBeInTheDocument()
  })

  it('reads fields written on one line', async () => {
    await show([booking('c1',
      'Pt: Panthi | Surg: Gupta | Op: C4/5 ACDF | Kit: Shoreline (Consignment) | Hosp: RHH')])
    await waitFor(() => expect(screen.getByText('Panthi')).toBeInTheDocument())
    expect(screen.getByText('C4/5 ACDF')).toBeInTheDocument()
    expect(screen.getByText('SHORELINE · Consignment')).toBeInTheDocument()
    // No label leaked into a neighbouring value.
    expect(screen.queryByText(/Surg:|Kit:/)).not.toBeInTheDocument()
  })

  it('splits the kit into the system and how it is supplied', async () => {
    await show([
      booking('c1', notes({ Pt: 'Horne', Surg: 'Ibbett', Kit: 'Dakota (Consignment)' })),
      booking('c2', notes({ Pt: 'Gill', Surg: 'Fowler', Kit: 'Mariner (Loan)' }), { start: at(13), end: at(14) })
    ])
    await waitFor(() => expect(screen.getByText('DAKOTA · Consignment')).toBeInTheDocument())
    expect(screen.getByText('MARINER · Loan')).toBeInTheDocument()
  })

  it('omits a line it cannot read rather than showing raw text', async () => {
    // No procedure and no kit. Two of the three lines simply are not there.
    const { container } = await show([booking('c1', notes({ Pt: 'Kennedy', Surg: 'JPW' }))])
    await waitFor(() => expect(screen.getByText('Kennedy')).toBeInTheDocument())
    expect(screen.getByText('JPW')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Pt:|Surg:/)
  })

  it('shows the system alone when no supply was given', async () => {
    await show([booking('c1', notes({ Pt: 'Fox', Surg: 'Fowler', Kit: 'Stryker CCI' }))])
    await waitFor(() => expect(screen.getByText('Fox')).toBeInTheDocument())
    expect(screen.getByText('STRYKER CCI')).toBeInTheDocument()
  })

  it('never says the system on both the procedure and the system line', async () => {
    // Someone repeats the system inside the procedure field.
    await show([booking('c1', notes({
      Pt: 'Panthi', Surg: 'Gupta', Procedure: 'C4/5 ACDF Shoreline', Kit: 'Shoreline (Consignment)'
    }))])
    await waitFor(() => expect(screen.getByText('C4/5 ACDF')).toBeInTheDocument())
    expect(screen.getByText('SHORELINE · Consignment')).toBeInTheDocument()
    expect(screen.queryByText(/C4\/5 ACDF Shoreline/)).not.toBeInTheDocument()
  })

  it('leaves the surgeon in their own colour', async () => {
    await show([booking('c1', notes({ Pt: 'Jackson', Surg: 'Fowler', Kit: 'Dakota (Loan)' }))])
    await waitFor(() => expect(screen.getByText('Fowler')).toBeInTheDocument())
    expect(screen.getByText('Fowler')).toHaveStyle({ color: accentTextFor('Fowler') })
  })

  it('keeps working on a booking with no labels at all', async () => {
    // The old free-text shape. Still read, so nothing that works today breaks.
    await show([booking('c1', 'C5/6 ACDF Mariner, consignment', { title: 'Jackson MARINER - Fowler' })])
    await waitFor(() => expect(screen.getByText('Jackson')).toBeInTheDocument())
    expect(screen.getByText('MARINER · Consignment')).toBeInTheDocument()
  })
})

describe('grouping by hospital', () => {
  const day = [
    booking('c1', notes({ Pt: 'Jackson', Surg: 'Fowler', Kit: 'Dakota (Loan)', Hospital: 'RHH' })),
    booking('c2', notes({ Pt: 'Horne', Surg: 'Ibbett', Kit: 'Mariner (Loan)', Hosp: 'Calvary Lenah Valley' }),
      { start: at(12), end: at(13) }),
    booking('c3', notes({ Pt: 'Gill', Surg: 'Fowler', Kit: 'Shoreline (Consignment)', Hosp: 'RHH' }),
      { start: at(14), end: at(15) })
  ]

  it('puts a heading over each hospital, with RHH first', async () => {
    const { container } = await show(day)
    await waitFor(() => expect(screen.getByText('Jackson')).toBeInTheDocument())
    expect(screen.getByText('RHH · 2 cases')).toBeInTheDocument()
    expect(screen.getByText('CLV · 1 case')).toBeInTheDocument()
    // RHH's heading comes before Calvary's in the document.
    const text = container.textContent
    expect(text.indexOf('RHH · 2 cases')).toBeLessThan(text.indexOf('CLV · 1 case'))
  })

  it('does not repeat the hospital on the card', async () => {
    await show([day[1]])
    await waitFor(() => expect(screen.getByText('Horne')).toBeInTheDocument())
    // Once, as the heading — not again beneath it.
    expect(screen.getAllByText(/CLV/)).toHaveLength(1)
    expect(screen.queryByText(/Calvary Lenah Valley/)).not.toBeInTheDocument()
  })

  it('falls back to the event location when no hospital was labelled', async () => {
    await show([booking('c1', notes({ Pt: 'Streets', Surg: 'JPW', Kit: 'Lonestar (Loan)' }),
      { location: 'Royal Hobart Hospital' })])
    await waitFor(() => expect(screen.getByText('Streets')).toBeInTheDocument())
    expect(screen.getByText('RHH · 1 case')).toBeInTheDocument()
  })
})

describe('the left border', () => {
  it('uses the calendar colour', async () => {
    const { container } = await show([
      booking('c1', notes({ Pt: 'Jackson', Surg: 'Fowler', Kit: 'Dakota (Loan)' }), { colorId: '3' })
    ])
    await waitFor(() => expect(screen.getByText('Jackson')).toBeInTheDocument())
    expect(borderFor(container, 'Jackson')).toBe(asRgb(GRAPE))
  })

  it.each([
    ['Varioguide in the procedure', { Procedure: 'L3/4 decompression Varioguide' }],
    ['Brainlab in the procedure', { Procedure: 'L4/5 TLIF with Brainlab' }],
    ['AIRO in the procedure', { Procedure: 'L5/S1 ALIF, AIRO' }]
  ])('turns blueberry for %s', async (_name, extra) => {
    const { container } = await show([
      booking('c1', notes({ Pt: 'Horne', Surg: 'Ibbett', Kit: 'Dakota (Loan)', ...extra }), { colorId: '3' })
    ])
    await waitFor(() => expect(screen.getByText('Horne')).toBeInTheDocument())
    expect(borderFor(container, 'Horne')).toBe(asRgb(NAVIGATION_ACCENT))
  })

  it('turns blueberry for a platform named in the title', async () => {
    const { container } = await show([
      booking('c1', notes({ Pt: 'Horne', Surg: 'Ibbett', Kit: 'Dakota (Loan)' }),
        { title: 'Horne — Brainlab navigation', colorId: '3' })
    ])
    await waitFor(() => expect(screen.getByText('Horne')).toBeInTheDocument())
    expect(borderFor(container, 'Horne')).toBe(asRgb(NAVIGATION_ACCENT))
  })

  it('is not fooled by a word that merely contains "airo"', async () => {
    const { container } = await show([
      booking('c1', notes({ Pt: 'Horne', Surg: 'Ibbett', Kit: 'Dakota (Loan)' }),
        { title: 'Cairo conference debrief', colorId: '3' })
    ])
    await waitFor(() => expect(screen.getByText('Horne')).toBeInTheDocument())
    expect(borderFor(container, 'Horne')).toBe(asRgb(GRAPE))
  })
})

describe('everything that is not a case', () => {
  it('keeps its title and its time, since meetings do not move', async () => {
    await show([booking('m1', '', { title: 'Spine Logistics Meeting', start: at(8), end: at(9) })])
    await waitFor(() => expect(screen.getByText('Spine Logistics Meeting')).toBeInTheDocument())
    expect(screen.getByText(/8:00am/)).toBeInTheDocument()
  })

  it('sits after the hospitals rather than among them', async () => {
    const { container } = await show([
      booking('m1', '', { title: 'Spine Logistics Meeting', start: at(8), end: at(9) }),
      booking('c1', notes({ Pt: 'Jackson', Surg: 'Fowler', Kit: 'Dakota (Loan)', Hospital: 'RHH' }))
    ])
    await waitFor(() => expect(screen.getByText('Jackson')).toBeInTheDocument())
    const text = container.textContent
    expect(text.indexOf('RHH · 1 case')).toBeLessThan(text.indexOf('Also on'))
  })

  it('leaves an all-day entry alone', async () => {
    await show([{
      id: 'a1', title: 'Toni – WFH', description: '', location: null,
      start: '2026-08-24', end: '2026-08-25', allDay: true, colorId: '8'
    }])
    await waitFor(() => expect(screen.getByText('Toni – WFH')).toBeInTheDocument())
  })

  it('never shows a patient identifier', async () => {
    const { container } = await show([booking('c1', notes({
      Patient: 'Smith UR 4457821', Surgeon: 'Fowler',
      Procedure: 'C5/6 ACDF DOB 14/03/1958', Kit: 'Dakota (Loan)'
    }))])
    await waitFor(() => expect(screen.getByText('Smith')).toBeInTheDocument())
    expect(container.textContent).not.toMatch(/4457821|1958/)
  })
})
