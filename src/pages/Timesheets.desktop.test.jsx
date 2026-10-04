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

describe('typing a decimal, one key at a time', () => {
  beforeEach(() => widthOf(1680))

  // "I can't enter a decimal point in the desktop version, it won't let me put
  // in 7.6 for example."
  //
  // The test above sets "7.6" in a single change event and passed happily,
  // which is why this survived: nobody types a number in one event. The cell
  // showed `value`, and the parent ran Number(raw) on every keystroke — so
  // "7." became Number("7.") = 7, and the point was wiped on the next render.
  // A full day is 7.6 hours, so the one number everybody needed most was the
  // one that could not be typed.
  const type = (box, keys) => {
    let far = ''
    for (const key of keys) {
      far += key
      fireEvent.change(box, { target: { value: far } })
    }
  }

  const firstCell = async () => {
    show()
    await waitFor(() => expect(screen.getByText('Ordinary Hours')).toBeInTheDocument())
    return document.querySelectorAll('input[inputmode="decimal"]')[0]
  }

  it('keeps the point while the rest of the number is still coming', async () => {
    const box = await firstCell()
    type(box, '7.')
    await waitFor(() => expect(box.value).toBe('7.'))
  })

  it('gets all the way to 7.6', async () => {
    const box = await firstCell()
    type(box, '7.6')
    await waitFor(() => expect(box.value).toBe('7.6'))
  })

  it('handles a number typed with no leading digit', async () => {
    const box = await firstCell()
    type(box, '.5')
    await waitFor(() => expect(box.value).toBe('.5'))
  })

  it('settles to the stored number once you leave the cell', async () => {
    const box = await firstCell()
    type(box, '7.60')
    fireEvent.blur(box)
    await waitFor(() => expect(box.value).toBe('7.6'))
  })

  it('still refuses a second point', async () => {
    const box = await firstCell()
    type(box, '7.6')
    fireEvent.change(box, { target: { value: '7.6.' } })
    await waitFor(() => expect(box.value).toBe('7.6'))
  })

  it('counts a half-typed number towards the total as the number so far', async () => {
    // "7." is seven hours until the 6 arrives. The fortnight total keeping up
    // while you type is the whole reason the parent still gets a number.
    const box = await firstCell()
    type(box, '7.')
    await waitFor(() => expect(screen.getAllByText(/^7h?$|7\.0/).length).toBeGreaterThan(0))
  })
})

describe('putting a wrong number back', () => {
  beforeEach(() => widthOf(1680))

  it('offers nothing to undo before anything is typed', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Ordinary Hours')).toBeInTheDocument())
    expect(screen.queryByText(/Undo last change/)).not.toBeInTheDocument()
  })

  it('puts a cell back the way it was', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Ordinary Hours')).toBeInTheDocument())
    const box = document.querySelectorAll('input[inputmode="decimal"]')[0]
    fireEvent.change(box, { target: { value: '7.6' } })
    fireEvent.blur(box)

    fireEvent.click(await screen.findByText(/Undo last change/))
    await waitFor(() => expect(box.value).toBe(''))
  })

  it('undoes one cell per press, not one keystroke', async () => {
    // Typing "7.6" fires three changes. An undo that walked back through "7."
    // and "7" would take three presses to clear one number.
    show()
    await waitFor(() => expect(screen.getByText('Ordinary Hours')).toBeInTheDocument())
    const boxes = document.querySelectorAll('input[inputmode="decimal"]')
    for (const key of ['7', '7.', '7.6']) {
      fireEvent.change(boxes[0], { target: { value: key } })
    }
    fireEvent.change(boxes[1], { target: { value: '4' } })

    fireEvent.click(await screen.findByText(/Undo last change/))
    await waitFor(() => expect(boxes[1].value).toBe(''))
    // The first cell is untouched: that was a separate step.
    expect(boxes[0].value).toBe('7.6')

    fireEvent.click(screen.getByText(/Undo last change/))
    await waitFor(() => expect(boxes[0].value).toBe(''))
  })

  it('stops offering an undo once everything is back', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Ordinary Hours')).toBeInTheDocument())
    const box = document.querySelectorAll('input[inputmode="decimal"]')[0]
    fireEvent.change(box, { target: { value: '7.6' } })
    fireEvent.click(await screen.findByText(/Undo last change/))
    await waitFor(() =>
      expect(screen.queryByText(/Undo last change/)).not.toBeInTheDocument())
  })
})
