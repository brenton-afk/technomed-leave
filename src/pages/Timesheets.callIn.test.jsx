import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Timesheets from './Timesheets.jsx'

// Brent, 14 Nov 2026: "tap call ins as a button on the day and that tallies
// the number of call ins for the day as you tap it." Invented person.
const USER = { name: 'Test Rep', email: 'ben@technomed.com.au', token: 'tok', staff: { hasTimesheets: true } }
const CATEGORIES = [
  { key: 'ordinary', label: 'Ordinary Hours', unit: 'hours', colour: 'navy', earningsRateID: 'r1' },
  { key: 'call_in', label: 'Call-in', unit: 'count', colour: 'purple', earningsRateID: 'r2' }
]
const days = Array.from({ length: 14 }, (_, i) => {
  const d = new Date('2026-09-21T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10)
})

beforeEach(() => {
  window.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  global.fetch = vi.fn(async url => {
    if (String(url).includes('action=payitems')) {
      return { ok: true, json: async () => ({ categories: CATEGORIES, period: { start: days[0], end: days[13], days }, periods: [] }) }
    }
    return { ok: true, json: async () => ({ records: [], suggestions: [], me: null }) }
  })
})
afterEach(() => vi.restoreAllMocks())

describe('call-ins by tapping', () => {
  it('each tap adds one, and − takes one off', async () => {
    render(<Timesheets user={USER} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText('Call-in')).toBeInTheDocument())
    const add = () => document.querySelector('[data-call-in-add]')
    fireEvent.click(add())
    fireEvent.click(add())
    expect(add().textContent).toBe('2')
    fireEvent.click(document.querySelector('[data-call-in-remove]'))
    expect(add().textContent).toBe('1')
    fireEvent.click(document.querySelector('[data-call-in-remove]'))
    expect(add().textContent).toBe('+')
    expect(document.querySelector('[data-call-in-remove]')).toBeNull()
  })
})
