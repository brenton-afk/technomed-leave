import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Timesheets from './Timesheets.jsx'

// Brent, 14 Nov 2026: a fresh timesheet opens with the usual fortnight in;
// Toni chooses admin or science TOIL for extra hours.
const days = Array.from({ length: 14 }, (_, i) => { const d = new Date('2026-06-01T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10) })
let user, cats, draft
const posted = []

beforeEach(() => {
  posted.length = 0
  window.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  global.fetch = vi.fn(async (url, opts) => {
    const u = String(url)
    if (u.includes('action=payitems')) return { ok: true, json: async () => ({ categories: cats, period: { start: days[0], end: days[13], days }, periods: [] }) }
    if (u.includes('action=draft') && !opts?.method) return { ok: true, json: async () => ({ draft }) }
    if (u.includes('action=leavedays')) return { ok: true, json: async () => ({ leave: { rows: [], pending: [], total: 0, byDay: {} }, toil: { available: 10, balance: 10, claimed: 0 }, earnsToil: true }) }
    if (u.includes('action=submit')) { posted.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ record: { periodStart: days[0], periodEnd: days[13], totals: { totalHours: 0, weekHours: [0, 0] } } }) } }
    return { ok: true, json: async () => ({ records: [], suggestions: [], me: null }) }
  })
})
afterEach(() => vi.restoreAllMocks())

describe('the usual fortnight', () => {
  it('opens a fresh timesheet filled in, with the public holiday marked', async () => {
    user = { name: 'Ben', email: 'ben@technomed.com.au', token: 't', staff: { hasTimesheets: true } }
    cats = [{ key: 'ordinary', kind: 'ordinary', label: 'Ordinary Hours', unit: 'hours', colour: 'navy', earningsRateID: 'r1' }]
    draft = null
    render(<Timesheets user={user} onBack={() => {}} />)
    await waitFor(() => expect(document.querySelector('[data-prefilled]')).not.toBeNull())
    expect(document.querySelector('[data-prefilled]').textContent).toMatch(/public holiday/)
    await waitFor(() => expect(screen.getByText('Week 1 · 38h')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Week 2 · 38h'))
    expect(document.querySelector('[data-public-holiday="2026-06-08"]')).not.toBeNull()
  })

  it('does not overwrite a saved draft', async () => {
    user = { name: 'Ben', email: 'ben@technomed.com.au', token: 't', staff: { hasTimesheets: true } }
    cats = [{ key: 'ordinary', kind: 'ordinary', label: 'Ordinary Hours', unit: 'hours', colour: 'navy', earningsRateID: 'r1' }]
    draft = { periodStart: days[0], entries: { ordinary: { [days[0]]: 3 } } }
    render(<Timesheets user={user} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText('Week 1 · 3h')).toBeInTheDocument())
    expect(document.querySelector('[data-prefilled]')).toBeNull()
  })
})

describe('Toni banks TOIL as admin or science', () => {
  it('asks which, and sends it', async () => {
    user = { name: 'Toni', email: 'toni@technomed.com.au', token: 't', staff: { hasTimesheets: true } }
    cats = [
      { key: 'ordinary_toni_admin', kind: 'ordinary', label: 'Ordinary — Admin', unit: 'hours', colour: 'navy', earningsRateID: 'a' },
      { key: 'ordinary_toni_scientific', kind: 'ordinary', label: 'Ordinary — Scientific', unit: 'hours', colour: 'blue', earningsRateID: 's' },
      { key: 'toil_toni_admin', kind: 'toil', label: 'TOIL — Admin', unit: 'hours', colour: 'teal', earningsRateID: 'ta' },
      { key: 'toil_toni_scientific', kind: 'toil', label: 'TOIL — Scientific', unit: 'hours', colour: 'teal', earningsRateID: 'ts' }
    ]
    // 36h against her 33h fortnight
    draft = { periodStart: days[0], entries: { ordinary_toni_admin: { [days[0]]: 6, [days[2]]: 6, [days[3]]: 6, [days[7]]: 6, [days[9]]: 6, [days[10]]: 6 } } }
    render(<Timesheets user={user} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText('Submit').disabled).toBe(false))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(document.querySelector('[data-bank-toil="toil_toni_scientific"]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-bank-toil="toil_toni_scientific"]'))
    fireEvent.click(screen.getByText('Confirm and submit'))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].toilInto).toBe('toil_toni_scientific')
    expect(Object.values(posted[0].entries.toil_toni_scientific).reduce((a, b) => a + b, 0)).toBe(3)
  })
})
