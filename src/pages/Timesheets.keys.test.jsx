import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Timesheets from './Timesheets.jsx'

// Brent, 15 Nov 2026: type a number, then an arrow key keeps it and moves to
// the next box; on a phone the keypad has "Next day ›".
const days = Array.from({ length: 14 }, (_, i) => { const d = new Date('2026-06-15T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10) })
const cats = [
  { key: 'ordinary', kind: 'ordinary', label: 'Ordinary Hours', unit: 'hours', colour: 'navy', earningsRateID: 'r1' },
  { key: 'toil_accrued', kind: 'toil', label: 'TOIL Accrued', unit: 'hours', colour: 'teal', earningsRateID: 'r2' }
]
const user = { name: 'Ben', email: 'ben@technomed.com.au', token: 't', staff: { hasTimesheets: true } }
let desktop
beforeEach(() => {
  window.matchMedia = q => ({ matches: desktop, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  global.fetch = vi.fn(async (url, opts) => {
    const u = String(url)
    if (u.includes('action=payitems')) return { ok: true, json: async () => ({ categories: cats, period: { start: days[0], end: days[13], days }, periods: [] }) }
    if (u.includes('action=draft') && !opts?.method) return { ok: true, json: async () => ({ draft: null }) }
    if (u.includes('action=leavedays')) return { ok: true, json: async () => ({ leave: { rows: [], pending: [], total: 0, byDay: {} }, toil: { available: 5, balance: 5, claimed: 0 } }) }
    return { ok: true, json: async () => ({ records: [], suggestions: [], me: null }) }
  })
})
afterEach(() => vi.restoreAllMocks())

describe('moving round the grid', () => {
  it('on a computer, → keeps the number and moves to the next day; ↓ to the next row', async () => {
    desktop = true
    render(<Timesheets user={user} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ordinary Hours')).toBeInTheDocument())
    const boxes = () => [...document.querySelectorAll('input[inputmode="decimal"]')]
    const first = boxes()[0]
    first.focus()
    fireEvent.change(first, { target: { value: '8' } })
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(boxes()[1])
    fireEvent.change(boxes()[1], { target: { value: '7.5' } })
    fireEvent.keyDown(boxes()[1], { key: 'Enter' })
    expect(document.activeElement).toBe(boxes()[2])
    fireEvent.keyDown(boxes()[2], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(boxes()[9]) // TOIL Accrued, Wednesday
    await waitFor(() => expect(screen.getByText('Week 1 · 15.5h')).toBeInTheDocument())
  })

  it('on a phone, the keypad has Next day', async () => {
    desktop = false
    render(<Timesheets user={user} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ordinary Hours')).toBeInTheDocument())
    const cells = [...document.querySelectorAll('button')].filter(b => b.textContent === '·')
    fireEvent.click(cells[0])
    fireEvent.click(screen.getByText('8'))
    fireEvent.click(document.querySelector('[data-pad-next]'))
    fireEvent.click(screen.getByText('6'))
    fireEvent.click(screen.getByText('Done'))
    await waitFor(() => expect(screen.getByText('Week 1 · 14h')).toBeInTheDocument())
  })
})
