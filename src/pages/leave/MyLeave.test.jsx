import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import MyLeave from './MyLeave.jsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('MyLeave', () => {
  it('lists waiting and approved leave, each with where it came from', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      today: '2026-11-26',
      leave: [
        { id: 'portal-b', from: '2026-12-01', to: '2026-12-01', label: 'Personal leave', status: 'pending', source: 'portal', days: 1, hours: 5.5 },
        { id: 'cal-x', from: '2027-02-08', to: '2027-02-12', label: 'Annual leave', status: 'approved', source: 'calendar', days: 3, hours: 16.5 }
      ]
    }) })))
    render(<MyLeave user={{ token: 't' }} onBack={() => {}} onApply={() => {}} />)
    expect(await screen.findByText('Tue 1 Dec')).toBeTruthy()
    expect(screen.getByText('Mon 8 Feb – Fri 12 Feb')).toBeTruthy()
    expect(screen.getByText(/Annual leave · 3 working days · 16.5h/)).toBeTruthy()
    expect(screen.getByText('From the Staff Leave calendar')).toBeTruthy()
    expect(document.querySelector('[data-my-leave-status="pending"]').textContent).toBe('Waiting for approval')
    expect(fetch.mock.calls[0][0]).toContain('action=myleave')
  })

  it('says so when there is none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ today: '2026-11-26', leave: [] }) })))
    render(<MyLeave user={{ token: 't' }} onBack={() => {}} />)
    expect(await screen.findByText('No leave coming up')).toBeTruthy()
  })
})
