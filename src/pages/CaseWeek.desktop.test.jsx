import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CaseWeek from './CaseWeek.jsx'

// "Make the case view for desktop similar to Google Calendar. It can stack the
// whole week across the page."
//
// A phone can only read a week as a list, so that is what it was everywhere —
// including on a 27in screen, where the same week became a long scroll of
// phone-width cards with most of the glass empty beside them.

const USER = { name: 'Brenton Lovering', email: 'brenton@technomed.com.au', token: 'tok' }

const ev = (id, summary, description, day) => ({
  id, summary, description, location: 'RHH',
  start: { dateTime: `2026-09-${day}T09:00:00+10:00` },
  end: { dateTime: `2026-09-${day}T10:00:00+10:00` }
})

const EVENTS = [
  ev('a', 'Chalmers DIPLOMAT - Fowler', 'Surg: Fowler\nPt: Chalmers\nHosp: RHH', '21'),
  ev('b', 'Marchetti REFORM - Atallah', 'Surg: Atallah\nPt: Marchetti\nHosp: RHH', '23')
]

const widthOf = px => {
  window.matchMedia = q => ({
    matches: px >= 1024, media: q, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}
  })
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-09-21T02:00:00.000Z'))
  localStorage.clear()
  global.fetch = vi.fn(async () => ({
    ok: true, json: async () => ({ events: EVENTS, syncedAt: '2026-09-21T02:00:00.000Z' })
  }))
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const show = () => render(<CaseWeek user={USER} />)
const toWeek = async () => {
  const rendered = show()
  await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('tab', { name: 'Week' }))
  await waitFor(() => expect(screen.getByText('Marchetti')).toBeInTheDocument())
  return rendered
}

describe('the week on a desktop', () => {
  beforeEach(() => widthOf(1680))

  it('lays the seven days out in columns', async () => {
    const { container } = await toWeek()
    const grid = [...container.querySelectorAll('div')]
      .find(el => el.style.gridTemplateColumns === 'repeat(7, minmax(0, 1fr))')
    expect(grid).toBeTruthy()
    expect(grid.children.length).toBe(7)
  })

  it('lets a column shrink below its content', async () => {
    // minmax(0, 1fr), not 1fr. Without it a long operation name pushes its
    // column wider and the week stops being a grid.
    const { container } = await toWeek()
    const grid = [...container.querySelectorAll('div')]
      .find(el => el.style.display === 'grid' && el.style.gridTemplateColumns?.includes('minmax(0'))
    expect(grid).toBeTruthy()
  })

  it('takes the whole window, with no measure capping it', async () => {
    // The gaps either side of the content were the reading measure, which is
    // right for prose and wrong for a week in columns.
    const { container } = await toWeek()
    expect(container.querySelector('.tm-page.tm-wide')).toBeTruthy()
  })

  it('keeps the measure on a single day', async () => {
    // A day stretched across a 27in screen is a row of 2000px-wide cards,
    // which is a worse answer than the bands.
    const { container } = show()
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
    expect(container.querySelector('.tm-page.tm-wide')).toBe(null)
  })

  it('still opens a day from its column', async () => {
    await toWeek()
    fireEvent.click(screen.getByText('Wednesday'))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Day' })).toHaveAttribute('aria-selected', 'true'))
  })
})

describe('the week on a phone', () => {
  beforeEach(() => widthOf(390))

  it('stays a list, because seven columns on a phone is nothing', async () => {
    const { container } = await toWeek()
    const grid = [...container.querySelectorAll('div')]
      .find(el => el.style.gridTemplateColumns === 'repeat(7, minmax(0, 1fr))')
    expect(grid).toBeFalsy()
  })
})
