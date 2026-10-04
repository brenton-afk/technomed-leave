import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Timesheets from './Timesheets.jsx'

// "Entering the hours on her desktop is really painful as she has to click as
// opposed to just being able to add numbers on her laptop keypad."
//
// Every cell was a button that opened a number pad. Right on a phone, where a
// cell is about 40px wide and tapping a big keypad beats typing into it.
// Wrong on a laptop with a number pad under your hands: click a cell, click
// seven digits, click save, for every one of seventy cells.

const USER = {
  name: 'Toni Hoppitt', email: 'toni@technomed.com.au', token: 'tok',
  staff: { hasTimesheets: true, role: 'Operations Coordinator' }
}

const CATEGORIES = [
  { key: 'ordinary', label: 'Ordinary Hours', unit: 'hours', colour: 'navy', earningsRateID: 'r1' },
  { key: 'toil_accrued', label: 'TOIL Accrued', unit: 'hours', colour: 'teal', earningsRateID: 'r2' }
]

const widthOf = px => {
  window.matchMedia = q => ({
    matches: px >= 1024, media: q, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}
  })
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true })
}

beforeEach(() => {
  global.fetch = vi.fn(async url => {
    if (String(url).includes('action=payitems')) {
      return { ok: true, json: async () => ({
        categories: CATEGORIES,
        period: {
          start: '2026-09-21', end: '2026-10-04',
          days: Array.from({ length: 14 }, (_, i) => {
            const d = new Date('2026-09-21T00:00:00Z')
            d.setUTCDate(d.getUTCDate() + i)
            return d.toISOString().slice(0, 10)
          })
        },
        periods: []
      }) }
    }
    return { ok: true, json: async () => ({ records: [], suggestions: [], me: null }) }
  })
})

afterEach(() => vi.restoreAllMocks())

const show = () => render(<Timesheets user={USER} onBack={() => {}} />)

describe('entering hours on a laptop', () => {
  beforeEach(() => widthOf(1440))

  it('gives every cell a box you can type into', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Ordinary Hours')).toBeInTheDocument())
    const boxes = document.querySelectorAll('input[inputmode="decimal"]')
    // Seven days across, two categories.
    expect(boxes.length).toBe(14)
  })

  it('takes a typed number', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Ordinary Hours')).toBeInTheDocument())
    const box = document.querySelectorAll('input[inputmode="decimal"]')[0]
    fireEvent.change(box, { target: { value: '7.6' } })
    await waitFor(() => expect(box.value).toBe('7.6'))
  })

  it('ignores a keystroke that is not a number', async () => {
    // A stray key in a grid of boxes should do nothing — no error, no flash.
    show()
    await waitFor(() => expect(screen.getByText('Ordinary Hours')).toBeInTheDocument())
    const box = document.querySelectorAll('input[inputmode="decimal"]')[0]
    fireEvent.change(box, { target: { value: '7.6' } })
    fireEvent.change(box, { target: { value: '7.6x' } })
    expect(box.value).toBe('7.6')
  })

  it('clears a cell when it is emptied', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Ordinary Hours')).toBeInTheDocument())
    const box = document.querySelectorAll('input[inputmode="decimal"]')[0]
    fireEvent.change(box, { target: { value: '7.6' } })
    fireEvent.change(box, { target: { value: '' } })
    await waitFor(() => expect(box.value).toBe(''))
  })

  it('selects what is there when you tab in, so typing replaces it', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Ordinary Hours')).toBeInTheDocument())
    const box = document.querySelectorAll('input[inputmode="decimal"]')[0]
    fireEvent.change(box, { target: { value: '7.6' } })
    const select = vi.spyOn(box, 'select')
    fireEvent.focus(box)
    expect(select).toHaveBeenCalled()
  })

  it('does not open the number pad', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Ordinary Hours')).toBeInTheDocument())
    const box = document.querySelectorAll('input[inputmode="decimal"]')[0]
    fireEvent.click(box)
    expect(screen.queryByText('Number of callouts')).not.toBeInTheDocument()
  })
})

describe('entering hours on a phone', () => {
  beforeEach(() => widthOf(390))

  it('keeps the number pad, because a 40px box is worse', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Ordinary Hours')).toBeInTheDocument())
    expect(document.querySelectorAll('input[inputmode="decimal"]').length).toBe(0)
  })
})
