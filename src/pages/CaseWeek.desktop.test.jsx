import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { readFileSync } from 'fs'
import { join } from 'path'
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
  ev('a', 'Mardon DIPLOMAT - Fowler',
    'Surg: Fowler\nPt: Mardon\nHosp: RHH\n'
    + 'Procedure: Re do transphenoidal Rathkes/pituitary abscess with drain', '21'),
  ev('b', 'Vellacott REFORM - Atallah (Aimee)',
    'Surg: Atallah\nPt: Vellacott\nHosp: RHH\nKit: Reform (Consignment)', '23'),
  // A second case at the same hospital on the same day. Without one there is
  // no running order to put in order, and the arrows correctly stay away.
  ev('c', 'Ashbury REFORM - Garg', 'Surg: Garg\nPt: Ashbury\nHosp: RHH', '21')
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
  await waitFor(() => expect(screen.getByText('Vellacott')).toBeInTheDocument())
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
    await waitFor(() => expect(screen.getByText('Mardon')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Week' }))
    await waitFor(() => expect(screen.getByText('Vellacott')).toBeInTheDocument())
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

  it('carries the list order, and no arrows', async () => {
    // The arrows were brought across when the day view went, because they
    // were the only way to order a list. They are gone now for a better
    // reason: the number they moved counted only our cases, so it disagreed
    // with the hospital's list the moment anybody else had one on.
    await toWeek()
    expect(screen.getAllByText(/List order|Change list order/).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText(/earlier on the list/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/later on the list/)).not.toBeInTheDocument()
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
    expect(screen.getByText('Mardon')).toBeInTheDocument()
    expect(screen.getByText('Vellacott')).toBeInTheDocument()
  })

  it('still opens a case', async () => {
    await toWeek()
    fireEvent.click(screen.getByText('Mardon'))
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Edit booking' })).toBeInTheDocument())
  })
})

describe('the list place, which says what a number could not', () => {
  beforeEach(() => widthOf(1680))

  // A number counts our cases. The hospital's list counts everybody's, so the
  // two disagree whenever another company has a case on — which is most days.
  // "Second on the AM list, after a competitor ALIF" is the fact that was
  // wanted, and it was already being recorded.
  it('opens the list place from a column', async () => {
    await toWeek()
    fireEvent.click(screen.getAllByText(/List order/)[0])
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /list/i })).toBeInTheDocument())
  })

  it('numbers nothing', async () => {
    await toWeek()
    const monday = document.querySelector('[data-week-column="2026-09-21"]')
    expect(monday.textContent).not.toMatch(/\b1\.\s/)
  })
})

describe('who is on the case', () => {
  beforeEach(() => widthOf(1680))

  // "I want to be able to see who attended the case in the desktop view like
  // we can on the phone view."
  //
  // The phone card has carried the rep all along and the week column did not,
  // so the one view that shows a whole week at once was the one that could
  // not answer "who has got Thursday".
  it('names the rep on a week card', async () => {
    await toWeek()
    expect(screen.getByText('Aimee')).toBeInTheDocument()
  })

  it('labels it, so it is not read straight past', async () => {
    // Reported as not being there at all when it was an unlabelled first name
    // among surnames and operations. "Rep:" is the word somebody scans for.
    const { container } = await toWeek()
    const wednesday = container.querySelector('[data-week-column="2026-09-23"]')
    expect(wednesday.textContent).toMatch(/Rep:\s*Aimee/)
  })

  it('leaves a case with nobody assigned unmarked, rather than blank-labelled', async () => {
    // Hollis has no rep in the fixtures. An empty "Rep:" line would read as
    // "nobody is going", which is a different fact from "not allocated yet".
    const { container } = await toWeek()
    const monday = container.querySelector('[data-week-column="2026-09-21"]')
    expect(monday.textContent).not.toMatch(/Rep:/)
  })
})

describe('the header earns its space', () => {
  beforeEach(() => widthOf(1680))

  // "Reduce the size of the blue banner at the top to make more space for the
  // calendar entries at the bottom. Change the proportions to prioritise the
  // information in the bookings themselves."
  it('runs the header compact on the week', () => {
    // Checked in the source, not the DOM. The padding is a calc() around
    // env(safe-area-inset-top); jsdom cannot parse that and drops the whole
    // declaration, so the rendered element carries no padding at all and an
    // assertion against it would pass whatever the value was.
    const page = readFileSync(join(__dirname, 'CaseWeek.jsx'), 'utf8')
    expect(page).toMatch(/<Header title="Cases" compact/)

    const shell = readFileSync(join(__dirname, '..', 'design', 'Shell.jsx'), 'utf8')
    // Compact is tighter than standard on both ends, or it is not compact.
    expect(shell).toMatch(/compact\s*\?[\s\S]*space\.md\}px\) \$\{space\.lg\}px \$\{space\.sm\}px/)
    expect(shell).toMatch(/text\(compact \? 'title' : 'display'\)/)
    expect(shell).toMatch(/marginTop: compact \? space\.sm : space\.lg/)
  })

  it('drops the standing subtitle, which said the same thing every day', async () => {
    await toWeek()
    expect(screen.queryByText('Every booking, as the calendar has it'))
      .not.toBeInTheDocument()
  })

  it('still says which week you are on', async () => {
    // Trimming the header must not take the navigation with it. The week
    // range and the arrows are the reason anybody looks up there.
    await toWeek()
    expect(screen.getByLabelText('Previous week')).toBeInTheDocument()
    expect(screen.getByLabelText('Next week')).toBeInTheDocument()
  })
})


describe('what is going in, on the week', () => {
  beforeEach(() => widthOf(1680))

  // "On the desktop version you can't see the name of the implant system
  // being used in the cases tab. So you have no idea what system is being
  // used, unless you go into the booking."
  //
  // The column carried the patient, the surgeon and the operation and not the
  // kit — so the one view that shows a whole week at once could not answer
  // "what am I packing for Thursday", which is most of why somebody opens a
  // week the day before.
  it('names the system on each card', async () => {
    await toWeek()
    expect(screen.getAllByText('Reform').length).toBeGreaterThan(0)
  })

  it('says where the kit is coming from', async () => {
    await toWeek()
    const wednesday = document.querySelector('[data-week-column="2026-09-23"]')
    expect(wednesday.textContent).toMatch(/Reform/)
    expect(wednesday.textContent).toMatch(/cons/)
  })

  it('shortens the supply to fit a column', async () => {
    // "Distributor Loan" is three times a week column's worth of patience.
    // The full words stay on the phone card, where there is room.
    await toWeek()
    const wednesday = document.querySelector('[data-week-column="2026-09-23"]')
    expect(wednesday.textContent).not.toMatch(/Consignment/)
  })

  it('puts the kit above the rep', async () => {
    // The kit decides what goes in the car; who is taking it is the next
    // question after that.
    await toWeek()
    const wednesday = document.querySelector('[data-week-column="2026-09-23"]')
    expect(wednesday.textContent.indexOf('Reform'))
      .toBeLessThan(wednesday.textContent.indexOf('Aimee'))
  })
})
