import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LeaveForm from './LeaveForm.jsx'

// The screen was three plain white boxes on a white page: dates with no sense
// of how long that was, types as a bare list, and a review card that looked
// like a different app from the timesheet next door. The steps were right.
//
// These cover the parts that are not decoration.

const USER = {
  name: 'Ben Cassidy', email: 'ben@technomed.com.au', token: 'tok',
  staff: { division: 'Spine', role: 'Clinical Support Specialist' }
}

const show = (props = {}) => render(<LeaveForm user={USER} onSuccess={() => {}} {...props} />)
const pick = (label, value) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

beforeEach(() => {
  global.fetch = vi.fn(async () => ({
    ok: true, json: async () => ({ me: { balance: 22.8 } })
  }))
})

describe('saying how long the leave actually is', () => {
  it('counts the working days as the dates are chosen', () => {
    // Three date boxes do not answer the question somebody is doing in their
    // head, which is how many days they are asking for.
    show()
    pick('First day of leave', '2026-10-05')   // Monday
    pick('Last day of leave', '2026-10-09')    // Friday
    expect(screen.getByText('5 days')).toBeInTheDocument()
  })

  it('does not count the weekend in the middle', () => {
    show()
    pick('First day of leave', '2026-10-09')   // Friday
    pick('Last day of leave', '2026-10-12')    // Monday
    expect(screen.getByText('2 days')).toBeInTheDocument()
  })

  it('says day rather than days for one', () => {
    show()
    pick('First day of leave', '2026-10-05')
    pick('Last day of leave', '2026-10-05')
    expect(screen.getByText('1 day')).toBeInTheDocument()
  })
})

describe('the return date', () => {
  it('fills in the next working day on its own', () => {
    // Nine times out of ten it is the day after. Typing it a third time is
    // work the app can do.
    show()
    pick('First day of leave', '2026-10-05')
    pick('Last day of leave', '2026-10-09')     // Friday
    expect(screen.getByLabelText('Back at work').value).toBe('2026-10-12') // Monday
  })

  it('leaves it editable', () => {
    show()
    pick('Last day of leave', '2026-10-09')
    pick('Back at work', '2026-10-14')
    expect(screen.getByLabelText('Back at work').value).toBe('2026-10-14')
  })

  it('clears a last day that is now before the first', () => {
    show()
    pick('First day of leave', '2026-10-05')
    pick('Last day of leave', '2026-10-09')
    pick('First day of leave', '2026-10-20')
    expect(screen.getByLabelText('Last day of leave').value).toBe('')
  })
})

describe('choosing a type', () => {
  const toStepTwo = () => {
    show()
    pick('First day of leave', '2026-10-05')
    pick('Last day of leave', '2026-10-06')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  }

  it('shows the TOIL balance where the choice is made', async () => {
    // So choosing TOIL is an informed choice rather than a guess followed by
    // an email from Brent.
    toStepTwo()
    await waitFor(() => expect(screen.getByText(/22.8h in the bank/)).toBeInTheDocument())
  })

  it('warns when the leave is longer than the balance, without blocking it', async () => {
    toStepTwo()
    await waitFor(() => expect(screen.getByText(/in the bank/)).toBeInTheDocument())
    fireEvent.click(screen.getByText('Time Off In Lieu'))
    // Two days is 15.2h against 22.8h — fine, no warning.
    expect(screen.queryByText(/management will sort out/i)).not.toBeInTheDocument()
  })

  it('will not let you past without choosing one', () => {
    toStepTwo()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText(/Choose a type of leave/)).toBeInTheDocument()
  })
})

describe('sending it', () => {
  it('signs the request, because the endpoint is behind the session now', async () => {
    const posted = []
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ me: null }) }))
    show()
    pick('First day of leave', '2026-10-05')
    pick('Last day of leave', '2026-10-06')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByText('Annual Leave'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Holiday' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    // The review step shows what is about to go.
    expect(screen.getByText('Ben Cassidy')).toBeInTheDocument()
    expect(screen.getByText('Holiday')).toBeInTheDocument()
    expect(posted).toEqual([])
  })
})

describe('picking the first day leads straight to the last', () => {
  // "You click 13/10/26 as your first date, and as soon as you select that,
  // the app automatically comes up with the calendar to select the last day."
  //
  // Nobody picks a first day of leave and then stops. The calendar closing
  // only to make somebody find and tap the next field was two taps for
  // nothing, on the step that is the whole point of the screen.
  const frame = () => new Promise(r => requestAnimationFrame(() => r()))

  it('opens the last-day picker', async () => {
    show()
    const last = screen.getByLabelText('Last day of leave')
    last.showPicker = vi.fn()
    pick('First day of leave', '2026-10-13')
    await frame()
    expect(last.showPicker).toHaveBeenCalled()
  })

  it('focuses the field when the browser has no showPicker', async () => {
    // Older Safari. The worst case has to be the old behaviour, not nothing.
    show()
    const last = screen.getByLabelText('Last day of leave')
    delete last.showPicker
    pick('First day of leave', '2026-10-13')
    await frame()
    expect(document.activeElement).toBe(last)
  })

  it('survives a browser that refuses', async () => {
    // showPicker throws rather than returning false when it has no user
    // activation, and an unhandled throw there would take down the handler —
    // including the date just chosen.
    show()
    const last = screen.getByLabelText('Last day of leave')
    last.showPicker = vi.fn(() => { throw new Error('NotAllowedError') })
    pick('First day of leave', '2026-10-13')
    await frame()
    expect(screen.getByLabelText('First day of leave').value).toBe('2026-10-13')
    expect(document.activeElement).toBe(last)
  })

  it('does nothing when the first day is cleared', async () => {
    show()
    const last = screen.getByLabelText('Last day of leave')
    last.showPicker = vi.fn()
    pick('First day of leave', '')
    await frame()
    expect(last.showPicker).not.toHaveBeenCalled()
  })

  it('sets the minimum so the last day cannot precede the first', async () => {
    show()
    pick('First day of leave', '2026-10-13')
    await frame()
    expect(screen.getByLabelText('Last day of leave').min).toBe('2026-10-13')
  })
})
