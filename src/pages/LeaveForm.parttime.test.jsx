import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import axios from 'axios'
import LeaveForm from './LeaveForm.jsx'

// ─── Task 14 on screen: part-time leave in hours ─────────────────────────────

const TONI = { name: 'Toni Hoppitt', email: 'toni@technomed.com.au', token: 'tok', staff: { division: 'Operations' } }
const ERIN = { name: 'Erin Smallbon', email: 'erin@technomed.com.au', token: 'tok', staff: { division: 'Operations' } }

const day = n => fireEvent.click(screen.getByRole('button', { name: `${n} October` }))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-10-05T02:00:00.000Z'))
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ me: { balance: 10 } }) }))
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('Toni', () => {
  it('Mon to Fri shows only her three days, at 5.5 each — 16.5 hours', () => {
    render(<LeaveForm user={TONI} onSuccess={() => {}} />)
    day(12); day(16) // Mon 12 – Fri 16 Oct
    expect(screen.getByLabelText(/Hours on Mon 12 Oct/)).toHaveValue(5.5)
    expect(screen.getByLabelText(/Hours on Wed 14 Oct/)).toHaveValue(5.5)
    expect(screen.getByLabelText(/Hours on Thu 15 Oct/)).toHaveValue(5.5)
    expect(screen.queryByLabelText(/Hours on Tue 13 Oct/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Hours on Fri 16 Oct/)).not.toBeInTheDocument()
    expect(screen.getByText('16.5h')).toBeInTheDocument()
  })

  it('sends the hours with the application', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { success: true } })
    render(<LeaveForm user={TONI} onSuccess={() => {}} />)
    day(12); day(16)
    fireEvent.change(screen.getByLabelText(/Hours on Thu 15 Oct/), { target: { value: '2.75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: /Personal/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(screen.getByPlaceholderText(/Family holiday/), { target: { value: 'Surgery' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('13.75 hours')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Submit application/ }))
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(post.mock.calls[0][1].hours).toEqual([
      { date: '2026-10-12', hours: 5.5 }, { date: '2026-10-14', hours: 5.5 }, { date: '2026-10-15', hours: 2.75 }
    ])
  })
})

describe('Erin', () => {
  it('asks for her hours each day and will not go on with none', () => {
    render(<LeaveForm user={ERIN} onSuccess={() => {}} />)
    day(12); day(16)
    expect(screen.getByText(/Your days change/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Hours on Tue 13 Oct/)).toHaveValue(0)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText(/at least one day/)).toBeInTheDocument()
  })
})

describe('everyone else', () => {
  it('keeps the plain date range', () => {
    render(<LeaveForm user={{ name: 'Ben Cassidy', email: 'ben@technomed.com.au', token: 't' }} onSuccess={() => {}} />)
    day(12); day(16)
    expect(screen.queryByText('Hours')).not.toBeInTheDocument()
  })
})
