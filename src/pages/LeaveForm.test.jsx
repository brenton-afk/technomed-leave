import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import LeaveForm from './LeaveForm.jsx'

// The dates step used to be two native pickers, one opening the other. A
// native picker is an operating-system sheet with no title we can set, so the
// jump from the first day to the last was a calendar blinking and reopening
// and nothing else — reported, fairly, as giving no indication the app had
// moved on.
//
// The calendar is ours now, so it can say what it is asking for.

const USER = {
  name: 'Ben Cassidy', email: 'ben@technomed.com.au', token: 'tok',
  staff: { division: 'Spine', role: 'Clinical Support Specialist' }
}

const show = (props = {}) => render(<LeaveForm user={USER} onSuccess={() => {}} {...props} />)

/** Tap a day in the month on screen. */
const day = n => fireEvent.click(screen.getByRole('button', { name: `${n} October` }))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-10-05T02:00:00.000Z'))
  global.fetch = vi.fn(async () => ({
    ok: true, json: async () => ({ me: { balance: 22.8 } })
  }))
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('the calendar says which day it wants', () => {
  it('asks for the first day to begin with', () => {
    show()
    expect(screen.getByText('Pick your first day')).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
  })

  it('says so, in words, the moment the first day is chosen', () => {
    // The whole point. Nothing about a native picker reopening said this.
    show()
    day(13)
    expect(screen.getByText('Now pick your last day')).toBeInTheDocument()
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument()
  })

  it('shows what was already chosen while asking for the second', () => {
    show()
    day(13)
    expect(screen.getByText(/Away from 13 Oct/)).toBeInTheDocument()
  })

  it('goes back to asking for the first day once both are set', () => {
    show()
    day(13); day(16)
    expect(screen.getByText('Pick your first day')).toBeInTheDocument()
  })
})

describe('choosing the range', () => {
  it('counts the working days as they are picked', () => {
    show()
    day(13)                                   // Tuesday
    expect(screen.queryByText(/working day/)).not.toBeInTheDocument()
    day(16)                                   // Friday
    expect(screen.getByText('4 working days')).toBeInTheDocument()
  })

  it('does not count the weekend in the middle', () => {
    show()
    day(16)   // Friday
    day(19)   // Monday
    expect(screen.getByText('2 working days')).toBeInTheDocument()
  })

  it('says day rather than days for one', () => {
    show()
    day(13); day(13)
    expect(screen.getByText('1 working day')).toBeInTheDocument()
  })

  it('treats a tap before the start as changing the start', () => {
    // Not a backwards range — somebody changing their mind about where it
    // begins, which is what that tap means.
    show()
    day(16)
    day(13)
    expect(screen.getByText('Now pick your last day')).toBeInTheDocument()
    expect(screen.getByText(/Away from 13 Oct/)).toBeInTheDocument()
  })

  it('lets you start again from the header', () => {
    show()
    day(13)
    fireEvent.click(screen.getByRole('button', { name: 'change' }))
    expect(screen.getByText('Pick your first day')).toBeInTheDocument()
  })

  it('moves between months', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByText('November 2026')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByText('October 2026')).toBeInTheDocument()
  })
})

describe('the return date', () => {
  it('appears filled in once the range is set', () => {
    show()
    day(13); day(16)                          // Friday 16th
    expect(screen.getByLabelText('Back at work').value).toBe('2026-10-19') // Monday
  })

  it('is not asked for before there is a range', () => {
    show()
    expect(screen.queryByLabelText('Back at work')).not.toBeInTheDocument()
  })

  it('stays editable', () => {
    show()
    day(13); day(16)
    fireEvent.change(screen.getByLabelText('Back at work'), { target: { value: '2026-10-21' } })
    expect(screen.getByLabelText('Back at work').value).toBe('2026-10-21')
  })
})

describe('the rest of the application', () => {
  const toTypes = () => {
    show()
    day(13); day(14)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  }

  it('will not go on without dates', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText(/Pick your first day of leave/)).toBeInTheDocument()
  })

  it('shows the TOIL balance where the type is chosen', async () => {
    toTypes()
    await waitFor(() => expect(screen.getByText(/22.8h in the bank/)).toBeInTheDocument())
  })

  it('reaches the review with what was chosen', () => {
    toTypes()
    fireEvent.click(screen.getByText('Annual Leave'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Holiday' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Ben Cassidy')).toBeInTheDocument()
    expect(screen.getByText('13 Oct 2026')).toBeInTheDocument()
    expect(screen.getByText('Holiday')).toBeInTheDocument()
  })
})
