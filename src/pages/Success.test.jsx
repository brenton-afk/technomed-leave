import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('axios', () => ({ default: { post: vi.fn(async () => ({ data: { success: true } })) } }))

import App from '../App.jsx'

// Reported: "After you have submitted an application, there's no way to get
// back to the main portal, except by tapping submit another application."
//
// Two faults. The screen was rendered above the app shell, which took the
// bottom navigation off with it — so every other way out of every other
// screen was gone. And its one button read "Submit another application" while
// actually navigating to Cases, so the only way out was mislabelled and the
// thing it really did was not offered.

const BEN = {
  name: 'Ben Cassidy', email: 'ben@technomed.com.au',
  isAdmin: false, token: 'tok-ben',
  staff: { hasTimesheets: true, role: 'Clinical Support Specialist', division: 'Spine' }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-10-05T02:00:00.000Z'))
  localStorage.clear(); sessionStorage.clear()
  localStorage.setItem('tm_user', JSON.stringify(BEN))
  localStorage.setItem('tm_login_time', String(Date.now()))
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ me: null, events: [] }) }))
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

async function fileLeave() {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Me' }))
  fireEvent.click(screen.getByText('Leave'))
  fireEvent.click(await screen.findByRole('button', { name: '13 October' }))
  fireEvent.click(screen.getByRole('button', { name: '14 October' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByText('Annual Leave'))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Holiday' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Submit application' }))
  await waitFor(() => expect(screen.getByText('Application sent')).toBeInTheDocument())
}

describe('after a leave application has gone', () => {
  it('still has the tab bar on it', async () => {
    // The whole complaint. Every other screen is left by tapping a tab, and
    // there was no reason for this one to be the exception.
    await fileLeave()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect([...nav.querySelectorAll('button')].map(b => b.textContent))
      .toEqual(['Cases', 'Scan', 'Messages', 'Kit', 'Me'])
  })

  it('offers two ways on, both saying what they do', async () => {
    await fileLeave()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply for more leave' })).toBeInTheDocument()
  })

  it('does not still claim the only button submits another one', async () => {
    await fileLeave()
    expect(screen.queryByText('Submit another application')).not.toBeInTheDocument()
  })

  it('Done leaves the screen', async () => {
    await fileLeave()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByText('Application sent')).not.toBeInTheDocument())
  })

  it('and the other one really does start another application', async () => {
    await fileLeave()
    fireEvent.click(screen.getByRole('button', { name: 'Apply for more leave' }))
    await waitFor(() => expect(screen.getByText('Pick your first day')).toBeInTheDocument())
  })

  it('can be left by tapping a tab instead', async () => {
    await fileLeave()
    fireEvent.click(screen.getByRole('button', { name: 'Cases' }))
    await waitFor(() => expect(screen.queryByText('Application sent')).not.toBeInTheDocument())
  })
})
