import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ClinicalPlan from './ClinicalPlan.jsx'
import { planSignature, LIVE_POLL_MS } from '../clinicalPlan/provider.js'
import { buildWeekPlan } from '../clinicalPlan/buildWeekPlan.js'

// The plan is worked from while theatre lists are still being reordered, so it
// has to follow the calendar rather than snapshot it. These are the guarantees
// that makes: an edit appears without a reload, an unchanged calendar leaves the
// page alone, and a failed check never blanks a plan that is already readable.

const USER = { name: 'Brenton Lovering', email: 'brenton@technomed.com.au', token: 'tok', isAdmin: true }

const event = (id, summary, day, from, to, extra = {}) => ({
  id,
  summary,
  start: { dateTime: `2026-08-${day}T${from}:00+10:00` },
  end: { dateTime: `2026-08-${day}T${to}:00+10:00` },
  location: 'RHH',
  ...extra
})

let events

function mockCalendar() {
  global.fetch = vi.fn(url => {
    if (String(url).includes('action=week')) {
      return Promise.resolve({ json: () => Promise.resolve({ events, syncedAt: new Date().toISOString() }) })
    }
    return Promise.resolve({ json: () => Promise.resolve({}) })
  })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  events = [event('c1', 'Jackson MARINER - Fowler', '24', '10:00', '11:00')]
  mockCalendar()
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('following the calendar', () => {
  it('picks up a booking added to the calendar, without a reload', async () => {
    render(<ClinicalPlan user={USER} />)
    await waitFor(() => expect(screen.getByText('Jackson')).toBeInTheDocument())
    expect(screen.queryByText('Vanderheim')).not.toBeInTheDocument()

    // Someone adds a case in Google Calendar.
    events = [...events, event('c2', 'Vanderheim MARINER + E4 CAGES - Gupta', '24', '13:00', '14:00')]

    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS + 50)
    await waitFor(() => expect(screen.getByText('Vanderheim')).toBeInTheDocument())
    // The case that was already there is still there.
    expect(screen.getByText('Jackson')).toBeInTheDocument()
  })

  it('picks up an edit to a booking that was already showing', async () => {
    render(<ClinicalPlan user={USER} />)
    await waitFor(() => expect(screen.getByText('MARINER')).toBeInTheDocument())

    events = [event('c1', 'Jackson SHORELINE - Fowler', '24', '10:00', '11:00')]
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS + 50)

    await waitFor(() => expect(screen.getByText('SHORELINE')).toBeInTheDocument())
    expect(screen.queryByText('MARINER')).not.toBeInTheDocument()
  })

  it('notices a booking deleted from the calendar', async () => {
    render(<ClinicalPlan user={USER} />)
    await waitFor(() => expect(screen.getByText('Jackson')).toBeInTheDocument())

    events = []
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS + 50)
    await waitFor(() => expect(screen.queryByText('Jackson')).not.toBeInTheDocument())
  })

  it('leaves the page untouched when the calendar has not changed', async () => {
    // Rebuilding an identical plan every minute would throw away the reader's
    // scroll position on a long week, which is why the fetched plan is only
    // adopted when its content actually differs.
    render(<ClinicalPlan user={USER} />)
    await waitFor(() => expect(screen.getByText('Jackson')).toBeInTheDocument())
    const before = screen.getByText('Jackson')

    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 2 + 50)

    // Same DOM node, not merely the same text: React reused it because the plan
    // was never replaced.
    expect(screen.getByText('Jackson')).toBe(before)
  })

  it('rechecks straight away when the tab is returned to', async () => {
    render(<ClinicalPlan user={USER} />)
    await waitFor(() => expect(screen.getByText('Jackson')).toBeInTheDocument())
    const callsBefore = global.fetch.mock.calls.length

    events = [...events, event('c2', 'Horne DAKOTA - Ibbett', '24', '15:00', '16:00')]
    // A tab that has been in the background is the most likely to be out of date.
    document.dispatchEvent(new Event('visibilitychange'))

    await waitFor(() => expect(global.fetch.mock.calls.length).toBeGreaterThan(callsBefore))
    await waitFor(() => expect(screen.getByText('Horne')).toBeInTheDocument())
  })

  it('does not poll while the tab is hidden', async () => {
    render(<ClinicalPlan user={USER} />)
    await waitFor(() => expect(screen.getByText('Jackson')).toBeInTheDocument())

    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const callsBefore = global.fetch.mock.calls.length
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 3 + 50)
    expect(global.fetch.mock.calls.length).toBe(callsBefore)
    hidden.mockRestore()
  })

  it('keeps showing the plan when a check fails, and says so', async () => {
    render(<ClinicalPlan user={USER} />)
    await waitFor(() => expect(screen.getByText('Jackson')).toBeInTheDocument())

    global.fetch = vi.fn(() => Promise.reject(new Error('offline')))
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS + 50)

    // The plan a rep is standing in theatre reading must not vanish because a
    // background check failed.
    expect(screen.getByText('Jackson')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/Not updating/)).toBeInTheDocument())
  })

  it('says it is following the calendar, and when it last looked', async () => {
    render(<ClinicalPlan user={USER} />)
    await waitFor(() => expect(screen.getByText(/Following the calendar/)).toBeInTheDocument())
  })
})

describe('planSignature', () => {
  const WINDOW = {
    startDate: '2026-08-24',
    endDate: '2026-08-30',
    days: ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28']
  }
  const plan = evts => buildWeekPlan(evts, WINDOW, { generatedAt: '2026-08-23T07:00:00.000Z' })
  const base = [event('c1', 'Jackson MARINER - Fowler', '24', '10:00', '11:00')]

  it('ignores the sync timestamp, which changes on every fetch by definition', () => {
    const a = buildWeekPlan(base, WINDOW, { generatedAt: '2026-08-23T07:00:00.000Z' })
    const b = buildWeekPlan(base, WINDOW, { generatedAt: '2026-08-24T09:30:00.000Z' })
    expect(planSignature(a)).toBe(planSignature(b))
  })

  it('changes when a case is added, edited or removed', () => {
    const original = planSignature(plan(base))
    expect(planSignature(plan([]))).not.toBe(original)
    expect(planSignature(plan([...base, event('c2', 'Horne DAKOTA - Ibbett', '25', '09:00', '10:00')])))
      .not.toBe(original)
    expect(planSignature(plan([event('c1', 'Jackson SHORELINE - Fowler', '24', '10:00', '11:00')])))
      .not.toBe(original)
  })

  it('changes when the kit or its supply changes', () => {
    const withKit = supply => planSignature(plan([
      event('c1', 'Jackson MARINER - Fowler', '24', '10:00', '11:00', { description: `Kit: Mariner (${supply})` })
    ]))
    expect(withKit('consignment')).not.toBe(withKit('loan'))
  })

  it('changes when a non-case entry changes, not only cases', () => {
    const withMeeting = title => planSignature(plan([
      ...base, event('m1', title, '26', '08:00', '09:00')
    ]))
    expect(withMeeting('Spine Logistics Meeting')).not.toBe(withMeeting('Brent on call'))
  })

  it('survives an empty or missing plan', () => {
    expect(planSignature(null)).toBe('')
    expect(() => planSignature({})).not.toThrow()
  })
})
