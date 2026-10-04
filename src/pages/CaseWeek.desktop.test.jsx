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
  ev('a', 'Chalmers DIPLOMAT - Fowler',
    'Surg: Fowler\nPt: Chalmers\nHosp: RHH\n'
    + 'Procedure: Re do transphenoidal Rathkes/pituitary abscess with drain', '21'),
  ev('b', 'Marchetti REFORM - Atallah', 'Surg: Atallah\nPt: Marchetti\nHosp: RHH', '23'),
  // A second case at the same hospital on the same day. Without one there is
  // no running order to put in order, and the arrows correctly stay away.
  ev('c', 'Teale REFORM - Garg', 'Surg: Garg\nPt: Teale\nHosp: RHH', '21')
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
/**
 * The week, as a desktop meets it.
 *
 * It used to click the Week tab to get here. A desktop has no tabs any more —
 * the day view was a phone answer to a screen that cannot hold a week, and on
 * a laptop it was the same information in a narrower strip. The week is the
 * view, so the only thing to wait for is the week arriving.
 */
const toWeek = async () => {
  const rendered = show()
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

  it('offers no day view at all', async () => {
    // Asked for directly: the day view "is not really useful" on a desktop.
    // Both halves matter — the toggle is gone, and so is the view behind it,
    // so a 'day' preference saved on a phone cannot strand a laptop on a
    // screen the desktop no longer draws.
    const { container } = await toWeek()
    expect(screen.queryByRole('tab', { name: 'Day' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Week' })).not.toBeInTheDocument()
    expect(container.querySelectorAll('[data-week-column]').length).toBe(7)
  })

  it('ignores a day view carried over from a phone', async () => {
    window.localStorage.setItem('tm.prefs', JSON.stringify({ caseSpan: 'day' }))
    const { container } = await toWeek()
    expect(container.querySelectorAll('[data-week-column]').length).toBe(7)
  })

  it('does not pretend the day heading is a button', async () => {
    // It used to open the day view. A control that goes nowhere is worse
    // than no control, so it is a label now.
    const { container } = await toWeek()
    const column = container.querySelector('[data-week-column="2026-09-23"]')
    // The cases inside it are buttons, and should be — this is about the date
    // at the top of the column, which used to open a view that is now gone.
    const heading = [...column.querySelectorAll('span')]
      .find(el => el.textContent === 'Wednesday')
    expect(heading).toBeTruthy()
    expect(heading.closest('button')).toBe(null)
  })
})

describe('the week on a phone', () => {
  beforeEach(() => widthOf(390))

  // A phone keeps the toggle: a week cannot fit across the glass, so the day
  // view is the one that works there.
  const toPhoneWeek = async () => {
    const rendered = show()
    await waitFor(() => expect(screen.getByText('Chalmers')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Week' }))
    await waitFor(() => expect(screen.getByText('Marchetti')).toBeInTheDocument())
    return rendered
  }

  it('stays a list, because seven columns on a phone is nothing', async () => {
    const { container } = await toPhoneWeek()
    const grid = [...container.querySelectorAll('div')]
      .find(el => el.style.gridTemplateColumns === 'repeat(7, minmax(0, 1fr))')
    expect(grid).toBeFalsy()
  })
})

describe('a week column is readable, not a stretched phone card', () => {
  // "Super ugly, all stretched out and not really useful." It was: the phone's
  // day panel dropped into a 200px column, so cards built for 360px wrapped to
  // a word a line, and the leader chip and the "move a case with the arrows"
  // instruction repeated seven and fifteen times respectively.
  beforeEach(() => widthOf(1680))

  it('does not repeat the instruction text in every column', async () => {
    // Once per hospital per day — the single noisiest thing on the screen.
    await toWeek()
    expect(screen.queryByText(/Move a case with the arrows/)).not.toBeInTheDocument()
  })

  it('does not repeat the team leader seven times', async () => {
    // Same answer every day, and already on the strip above the grid.
    await toWeek()
    expect(screen.queryByText(/— team leader/)).not.toBeInTheDocument()
  })

  it('carries the running order controls, since nothing else does now', async () => {
    // These used to be left out on purpose — the day view had room for them.
    // Removing the day view without bringing them across would have quietly
    // taken list ordering off the desktop altogether, which is the opposite
    // of what was asked for.
    await toWeek()
    expect(screen.getAllByLabelText(/earlier on the list/).length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText(/later on the list/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/List order|Change list order/).length).toBeGreaterThan(0)
  })

  it('clamps a long operation rather than stacking it a word a line', async () => {
    const { container } = await toWeek()
    // Read off the attribute: jsdom does not expose -webkit-line-clamp as a
    // property on CSSStyleDeclaration.
    const clamped = [...container.querySelectorAll('span')]
      .filter(el => /line-clamp:\s*2/.test(el.getAttribute('style') || ''))
    expect(clamped.length).toBeGreaterThan(0)
  })

  it('still names the patient and the surgeon', async () => {
    await toWeek()
    expect(screen.getByText('Chalmers')).toBeInTheDocument()
    expect(screen.getByText('Marchetti')).toBeInTheDocument()
  })

  it('still opens a case', async () => {
    await toWeek()
    fireEvent.click(screen.getByText('Chalmers'))
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Edit booking' })).toBeInTheDocument())
  })
})

describe('ordering a list from the week, with no day view to fall back on', () => {
  beforeEach(() => widthOf(1680))

  // The day view was where the running order got changed. Taking it off the
  // desktop without moving these across would have removed list ordering from
  // every laptop in the company, silently — the arrows would simply not be
  // anywhere, and nothing would have failed.
  it('sends the new order to the calendar when an arrow is pressed', async () => {
    await toWeek()
    const calls = () => global.fetch.mock.calls
      .filter(([url]) => String(url).includes('reorder'))
    expect(calls()).toHaveLength(0)

    fireEvent.click(screen.getAllByLabelText(/later on the list/)[0])

    await waitFor(() => expect(calls().length).toBeGreaterThan(0))
    // The day is in the query, the order in the body. Both cases go, because
    // the calendar lays a day out end to end.
    expect(String(calls()[0][0])).toContain('date=2026-09-21')
    const body = JSON.parse(calls()[0][1].body)
    expect(body.order).toEqual(['c', 'a'])
  })

  it('opens the list-order sheet from a column', async () => {
    await toWeek()
    fireEvent.click(screen.getAllByText(/List order/)[0])
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /list/i })).toBeInTheDocument())
  })

  it('numbers a hospital with more than one case, and leaves a single alone', async () => {
    await toWeek()
    const monday = document.querySelector('[data-week-column="2026-09-21"]')
    expect(monday.textContent).toMatch(/1\. /)
    // Wednesday has one case at RHH. A running order of one is not an order.
    const wednesday = document.querySelector('[data-week-column="2026-09-23"]')
    expect(wednesday.textContent).not.toMatch(/1\. /)
  })
})
