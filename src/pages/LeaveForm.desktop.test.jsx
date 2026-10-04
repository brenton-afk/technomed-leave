import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LeaveForm from './LeaveForm.jsx'

// "This is pretty ugly on desktop."
//
// It was one phone-width card adrift in an acre of empty page, with Continue
// pinned to the foot of the window a long way from the calendar it applied to
// and not even lined up with it. Three separate causes: a measure built for a
// week of columns rather than a form, a bar pinned for a phone's thumb on a
// screen where the whole form already fits, and the stylesheet's 640px block
// sitting below the 1024px one and overruling it.

const USER = { name: 'Brenton Lovering', email: 'brenton@technomed.com.au', token: 'tok' }

const widthOf = px => {
  window.matchMedia = q => ({
    matches: px >= 1024, media: q, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}
  })
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-10-04T02:00:00.000Z'))
  localStorage.clear()
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('the leave form on a desktop', () => {
  beforeEach(() => widthOf(1680))

  it('does not pin the actions to the foot of the window', async () => {
    // The visible complaint: Continue sat alone in the middle of an empty
    // page, hundreds of pixels below the calendar, lined up with nothing.
    const { container } = render(<LeaveForm user={USER} />)
    const action = screen.getByRole('button', { name: 'Continue' })
    const bar = action.parentElement
    expect(bar.className).not.toContain('tm-fixed')
    expect(bar.style.position).not.toBe('fixed')
    expect(container.querySelector('.tm-fixed')).toBe(null)
  })

  it('keeps a form to a form-sized column, not the week grid measure', async () => {
    // 1400px is right for seven columns of bookings and wrong for one field
    // at a time. Inline, because .tm-measure's cap is in a stylesheet and
    // jsdom resolves no cascade — and because inline wins either way.
    const { container } = render(<LeaveForm user={USER} />)
    const measure = container.querySelector('.tm-measure[style*="max-width"]')
    expect(measure).toBeTruthy()
    expect(measure.style.maxWidth).toBe('940px')
  })

  it('shows two months at once', async () => {
    // Leave crosses a month boundary more often than not, and picking the
    // first day in one and the last in another meant paging forward blind.
    render(<LeaveForm user={USER} />)
    expect(screen.getByText('October 2026')).toBeInTheDocument()
    expect(screen.getByText('November 2026')).toBeInTheDocument()
  })

  it('moves both months together', async () => {
    render(<LeaveForm user={USER} />)
    fireEvent.click(screen.getByLabelText('Next month'))
    await waitFor(() => expect(screen.getByText('November 2026')).toBeInTheDocument())
    expect(screen.getByText('December 2026')).toBeInTheDocument()
    expect(screen.queryByText('October 2026')).not.toBeInTheDocument()
  })

  it('asks for a click rather than a tap', async () => {
    render(<LeaveForm user={USER} />)
    expect(screen.getByText('Click a day to start')).toBeInTheDocument()
  })

  it('still picks a range across the two months', async () => {
    // The point of showing both: a first day in October and a last day in
    // November, chosen without paging.
    render(<LeaveForm user={USER} />)
    fireEvent.click(screen.getByLabelText('26 October'))
    await waitFor(() =>
      expect(screen.getByText('Now pick your last day')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('3 November'))
    await waitFor(() => expect(screen.getByText(/working days/)).toBeInTheDocument())
  })
})

describe('the leave form on a phone', () => {
  beforeEach(() => widthOf(390))

  it('still pins the actions, where the form is longer than the screen', () => {
    const { container } = render(<LeaveForm user={USER} />)
    expect(container.querySelector('.tm-fixed')).toBeTruthy()
  })

  it('shows one month, so the targets stay thumb-sized', () => {
    render(<LeaveForm user={USER} />)
    expect(screen.getByText('October 2026')).toBeInTheDocument()
    expect(screen.queryByText('November 2026')).not.toBeInTheDocument()
  })

  it('still asks for a tap', () => {
    render(<LeaveForm user={USER} />)
    expect(screen.getByText('Tap a day to start')).toBeInTheDocument()
  })
})
