import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React, { useCallback, useState } from 'react'
import { useLiveRefresh, LIVE_POLL_MS } from './liveRefresh.js'

// "It's currently not up to date, as patient Streets has been cancelled for
// tomorrow." Several people move bookings around in Google during the day, and
// this app is read while that is happening.
//
// The week plan polled. The calendar view fetched once on mount and never again,
// so it showed whatever the calendar said at the moment it was opened — for as
// long as it was left open, with nothing on screen to say so. Both use one
// mechanism now, and these are the guarantees the mechanism owes them.

function Probe({ onRefresh }) {
  const [n, setN] = useState(0)
  useLiveRefresh(useCallback(() => { setN(v => v + 1); onRefresh() }, [onRefresh]), [onRefresh])
  return <span data-testid="count">{n}</span>
}

function visibility(state) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility('visible')
})

afterEach(() => {
  vi.useRealTimers()
  visibility('visible')
  vi.restoreAllMocks()
})

describe('following the calendar', () => {
  it('rechecks on a timer while the page is visible', async () => {
    const onRefresh = vi.fn()
    render(<Probe onRefresh={onRefresh} />)
    expect(onRefresh).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS + 10)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS)
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it('does not poll a page nobody is looking at', async () => {
    // A phone in a pocket should not be waking the radio every minute.
    const onRefresh = vi.fn()
    render(<Probe onRefresh={onRefresh} />)
    visibility('hidden')
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 3)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('rechecks the moment a backgrounded page is opened again', async () => {
    // The important half. A tab that has been in the background is the most
    // likely to be out of date, and waiting up to a full interval is exactly
    // when someone has picked the phone up to look at it.
    const onRefresh = vi.fn()
    render(<Probe onRefresh={onRefresh} />)
    visibility('hidden')
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 2)
    expect(onRefresh).not.toHaveBeenCalled()

    visibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    // Synchronously, not on the next tick: the point is that it does not wait.
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('rechecks on regaining focus', async () => {
    const onRefresh = vi.fn()
    render(<Probe onRefresh={onRefresh} />)
    window.dispatchEvent(new Event('focus'))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('stops when the screen goes away', async () => {
    const onRefresh = vi.fn()
    const view = render(<Probe onRefresh={onRefresh} />)
    view.unmount()
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 3)
    window.dispatchEvent(new Event('focus'))
    expect(onRefresh).not.toHaveBeenCalled()
  })
})

describe('both calendar screens use it', () => {
  // A list rather than a rule, because "reads the bookings calendar" is not
  // something a test can infer. The point is that the two cannot drift apart
  // again — the calendar view was the one that did not poll, and nothing
  // connected it to the plan that did.
  const screens = ['src/pages/TodayView.jsx', 'src/pages/ClinicalPlan.jsx']

  it.each(screens)('%s follows the calendar rather than snapshotting it', file => {
    const source = readFileSync(join(process.cwd(), file), 'utf8')
    expect(source).toMatch(/useLiveRefresh/)
  })

  it('keeps one poll interval, not one per screen', () => {
    for (const file of screens) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      expect(source, `${file} sets its own interval`).not.toMatch(/setInterval/)
    }
  })
})
