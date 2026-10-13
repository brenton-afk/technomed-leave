import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import { useToday, useReturn, AWAY_LONG_ENOUGH_MS, LIVE_POLL_MS } from './liveRefresh.js'

// ─── A clock that ticks ──────────────────────────────────────────────────────
// "The auto refresh to the current day is also not working. The app needs to
// constantly refresh back to today's date."
//
// The week screen worked today out once, at mount, and never again. Left open
// overnight it was still on yesterday in the morning — with the date
// highlighted, and nothing on the screen to say it was stale.

const visibility = state => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

let clock

const Today = ({ read }) => <span>day:{useToday(read)}</span>

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  clock = 0
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('following the date', () => {
  it('starts on today', () => {
    render(<Today read={() => '2026-10-13'} />)
    expect(screen.getByText('day:2026-10-13')).toBeInTheDocument()
  })

  it('follows the date over midnight, without a reload', () => {
    let day = '2026-10-13'
    render(<Today read={() => day} />)
    day = '2026-10-14'
    act(() => { vi.advanceTimersByTime(LIVE_POLL_MS + 10) })
    expect(screen.getByText('day:2026-10-14')).toBeInTheDocument()
  })

  it('catches up the moment the phone is picked up', () => {
    // The likeliest case by far: the app was in a pocket all night.
    let day = '2026-10-13'
    render(<Today read={() => day} />)
    act(() => visibility('hidden'))
    day = '2026-10-14'
    act(() => visibility('visible'))
    expect(screen.getByText('day:2026-10-14')).toBeInTheDocument()
  })

  it('does nothing at all while nobody is looking', () => {
    // A phone in a pocket should not be waking up to recompute a date.
    const read = vi.fn(() => '2026-10-13')
    render(<Today read={read} />)
    read.mockClear()
    act(() => visibility('hidden'))
    act(() => { vi.advanceTimersByTime(LIVE_POLL_MS * 5) })
    expect(read).not.toHaveBeenCalled()
  })

  it('does not redraw on the ticks where the day has not changed', () => {
    // Which is every tick but one, once a day.
    let draws = 0
    const Counting = () => { useToday(() => '2026-10-13'); draws += 1; return null }
    render(<Counting />)
    const atFirst = draws
    act(() => { vi.advanceTimersByTime(LIVE_POLL_MS * 3) })
    expect(draws).toBe(atFirst)
  })
})

// ─── And coming back to it ───────────────────────────────────────────────────
describe('being picked up again', () => {
  const Back = ({ onBack }) => { useReturn(onBack, () => clock); return null }

  it('goes back to today after a real absence', () => {
    const back = vi.fn()
    render(<Back onBack={back} />)
    act(() => visibility('hidden'))
    clock += AWAY_LONG_ENOUGH_MS + 1
    act(() => visibility('visible'))
    expect(back).toHaveBeenCalled()
  })

  it('leaves the screen alone for a quick flick away', () => {
    // A photo picker closing, a notification dismissed. Resetting somebody's
    // week out from under them part-way through adding a booking for next
    // Thursday is worse than the staleness it would prevent.
    const back = vi.fn()
    render(<Back onBack={back} />)
    act(() => visibility('hidden'))
    clock += 5 * 1000
    act(() => visibility('visible'))
    expect(back).not.toHaveBeenCalled()
  })

  it('does not fire on the way out, only on the way back', () => {
    const back = vi.fn()
    render(<Back onBack={back} />)
    clock += AWAY_LONG_ENOUGH_MS * 2
    act(() => visibility('hidden'))
    expect(back).not.toHaveBeenCalled()
  })

  it('does not fire for a screen that was never left', () => {
    const back = vi.fn()
    render(<Back onBack={back} />)
    act(() => visibility('visible'))
    expect(back).not.toHaveBeenCalled()
  })
})
