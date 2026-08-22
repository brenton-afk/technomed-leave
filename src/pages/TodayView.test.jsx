import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import TodayView from './TodayView.jsx'
import { NAVIGATION_ACCENT } from '../clinicalPlan/theme.js'
import { accentTextFor } from '../clinicalPlan/theme.js'

// This screen used to print the calendar's event title exactly as it was typed,
// which is why the system and kit showed through raw and, when the notes repeated
// them, twice over. It now reads a booking through the same reader as the case
// plan, so a case says the same thing wherever it appears.

const USER = { name: 'Brenton Lovering', email: 'brenton@technomed.com.au', token: 'tok' }

let events

const at = (hour, day = 24) => `2026-08-${day}T${String(hour).padStart(2, '0')}:00:00+10:00`

const booking = (id, title, extra = {}) => ({
  id, title, description: '', location: 'RHH',
  start: at(10), end: at(11), allDay: false, colorId: null, ...extra
})

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

/** Renders the day list and waits for it to settle. */
async function show(list) {
  events = list
  const view = render(<TodayView user={USER} />)
  await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  return view
}

describe('a case on the calendar view', () => {
  it('shows the surname, the surgeon, and the system — and nothing else', async () => {
    await show([booking('c1', 'Jackson MARINER - Fowler', {
      description: 'C5/6 ACDF Mariner\nKit: Mariner (consignment)'
    })])

    await waitFor(() => expect(screen.getByText('Jackson')).toBeInTheDocument())
    expect(screen.getByText('Fowler')).toBeInTheDocument()
    expect(screen.getByText('MARINER · Consignment')).toBeInTheDocument()

    // The raw title is gone, and so is everything it used to drag in.
    expect(screen.queryByText('Jackson MARINER - Fowler')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Kit:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/C5\/6 ACDF/)).not.toBeInTheDocument()
  })

  it('never says the system twice, however the booking repeated it', async () => {
    // The exact shape reported: the systems in the title, and again as a
    // reordered list in the notes.
    await show([booking('c1', 'Kennedy REFORM/ASCOT/ATHLET - JPW', {
      description: 'Kit: Athlet, Ascot + Reform'
    })])

    await waitFor(() => expect(screen.getByText('Kennedy')).toBeInTheDocument())
    expect(screen.getByText('REFORM/ASCOT/ATHLET')).toBeInTheDocument()
    expect(screen.queryByText(/Athlet, Ascot/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Kit:/)).not.toBeInTheDocument()
  })

  it('merges a separate kit line into the one system line', async () => {
    await show([booking('c1', 'Fox STRYKER CCI - Fowler', {
      description: 'Kit: Stryker PSI\nConsignment'
    })])

    await waitFor(() => expect(screen.getByText('Fox')).toBeInTheDocument())
    expect(screen.getByText('STRYKER CCI · Consignment')).toBeInTheDocument()
    expect(screen.queryByText('Stryker PSI')).not.toBeInTheDocument()
  })

  it('reads the supply wherever it was written', async () => {
    await show([
      booking('c1', 'Panthi LONESTAR (consignment) - Gupta'),
      booking('c2', 'Horne DAKOTA - Ibbett', { description: 'DAKOTA loan kit', start: at(13), end: at(14) })
    ])
    await waitFor(() => expect(screen.getByText('Panthi')).toBeInTheDocument())
    expect(screen.getByText('LONESTAR · Consignment')).toBeInTheDocument()
    expect(screen.getByText('DAKOTA · Loan')).toBeInTheDocument()
  })

  it('leaves the surgeon in their own colour', async () => {
    await show([booking('c1', 'Jackson MARINER - Fowler')])
    await waitFor(() => expect(screen.getByText('Fowler')).toBeInTheDocument())
    expect(screen.getByText('Fowler')).toHaveStyle({ color: accentTextFor('Fowler') })
  })

  it('shows a case with no system as just the two names', async () => {
    await show([booking('c1', 'Kennedy - JPW')])
    await waitFor(() => expect(screen.getByText('Kennedy')).toBeInTheDocument())
    expect(screen.getByText('JPW')).toBeInTheDocument()
  })
})

describe('navigation cases override the surgeon colour', () => {
  it.each([
    ['Varioguide', 'Horne DAKOTA Varioguide - Ibbett', ''],
    ['Brainlab', 'Horne DAKOTA - Ibbett', 'L4/5 TLIF with Brainlab'],
    ['AIRO', 'Horne DAKOTA - Ibbett', 'AIRO scanner booked']
  ])('colours a %s case blueberry', async (_platform, title, description) => {
    await show([booking('c1', title, { description })])
    await waitFor(() => expect(screen.getByText('Horne')).toBeInTheDocument())
    // Ibbett's own accent is a yellow; the override has to win.
    expect(screen.getByText('Ibbett')).toHaveStyle({ color: NAVIGATION_ACCENT })
  })

  it('leaves an ordinary case on its surgeon colour', async () => {
    await show([booking('c1', 'Horne DAKOTA - Ibbett')])
    await waitFor(() => expect(screen.getByText('Ibbett')).toBeInTheDocument())
    expect(screen.getByText('Ibbett')).toHaveStyle({ color: accentTextFor('Ibbett') })
  })

  it('is not fooled by a word that merely contains "airo"', async () => {
    // "Cairo" must not turn a case blue.
    await show([booking('c1', 'Horne DAKOTA - Ibbett', { description: 'Cairo conference follow-up' })])
    await waitFor(() => expect(screen.getByText('Ibbett')).toBeInTheDocument())
    expect(screen.getByText('Ibbett')).toHaveStyle({ color: accentTextFor('Ibbett') })
  })
})

describe('everything that is not a case', () => {
  it('keeps its title and its time, since meetings do not move', async () => {
    await show([booking('m1', 'Spine Logistics Meeting', { start: at(8), end: at(9) })])
    await waitFor(() => expect(screen.getByText('Spine Logistics Meeting')).toBeInTheDocument())
    expect(screen.getByText(/8:00am/)).toBeInTheDocument()
  })

  it('leaves an all-day entry alone', async () => {
    await show([{
      id: 'a1', title: 'Toni – WFH', description: '', location: null,
      start: '2026-08-24', end: '2026-08-25', allDay: true, colorId: '8'
    }])
    await waitFor(() => expect(screen.getByText('Toni – WFH')).toBeInTheDocument())
  })

  it('never shows a patient identifier', async () => {
    const { container } = await show([booking('c1', 'Smith UR 4457821 MARINER - Fowler', {
      description: 'C5/6 ACDF DOB 14/03/1958'
    })])
    await waitFor(() => expect(screen.getByText('Smith')).toBeInTheDocument())
    expect(container.textContent).not.toMatch(/4457821|1958/)
  })
})
