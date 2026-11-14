import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Timesheets from './Timesheets.jsx'

// Brent, 14 Nov 2026: on submit the portal asks — over: bank as TOIL or keep
// paid; under: take TOIL or leave it short. Submit waits for the answer.
const USER = { name: 'Test Rep', email: 'ben@technomed.com.au', token: 'tok', staff: { hasTimesheets: true } }
const CATEGORIES = [
  { key: 'ordinary', kind: 'ordinary', label: 'Ordinary Hours', unit: 'hours', colour: 'navy', earningsRateID: 'r1' },
  { key: 'toil_accrued', kind: 'toil', label: 'TOIL Accrued', unit: 'hours', colour: 'teal', earningsRateID: 'r2' }
]
const days = Array.from({ length: 14 }, (_, i) => { const d = new Date('2026-09-21T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10) })
let draft
const posted = []

beforeEach(() => {
  posted.length = 0
  window.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  global.fetch = vi.fn(async (url, opts) => {
    const u = String(url)
    if (u.includes('action=payitems')) return { ok: true, json: async () => ({ categories: CATEGORIES, period: { start: days[0], end: days[13], days }, periods: [] }) }
    if (u.includes('action=draft') && !opts?.method) return { ok: true, json: async () => ({ draft: { periodStart: days[0], entries: draft } }) }
    if (u.includes('action=leavedays')) return { ok: true, json: async () => ({ leave: { rows: [], pending: [], total: 0, byDay: {} }, toil: { available: 10, balance: 10, claimed: 0 }, earnsToil: true }) }
    if (u.includes('action=submit')) { posted.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ record: { periodStart: days[0], periodEnd: days[13], totals: { totalHours: 0, weekHours: [0, 0] } } }) } }
    return { ok: true, json: async () => ({ records: [], suggestions: [], me: null }) }
  })
})
afterEach(() => vi.restoreAllMocks())

const toReview = async () => {
  render(<Timesheets user={USER} onBack={() => {}} />)
  await waitFor(() => expect(screen.getByText('Ordinary Hours')).toBeInTheDocument())
  await waitFor(() => expect(screen.getByText('Submit').disabled).toBe(false))
  fireEvent.click(screen.getByText('Submit'))
}

describe('over or under the fortnight', () => {
  it('over: asks, and "Keep as paid hours" sends bankToil false', async () => {
    draft = { ordinary: Object.fromEntries(days.slice(0, 10).map(d => [d, 8])) } // 80h
    await toReview()
    await waitFor(() => expect(document.querySelector('[data-fortnight-question="over"]')).not.toBeNull())
    const submit = screen.getByText('Confirm and submit')
    expect(submit.disabled).toBe(true)
    fireEvent.click(document.querySelector('[data-keep-paid]'))
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].bankToil).toBe(false)
    expect(posted[0].entries.toil_accrued).toBeUndefined()
  })

  it('under: "Take TOIL" adds TOIL taken to cover the gap', async () => {
    draft = { ordinary: Object.fromEntries(days.slice(0, 10).map(d => [d, 7])) } // 70h
    await toReview()
    await waitFor(() => expect(document.querySelector('[data-fortnight-question="under"]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-take-toil]'))
    fireEvent.click(screen.getByText('Confirm and submit'))
    await waitFor(() => expect(posted).toHaveLength(1))
    const taken = Object.values(posted[0].entries.toil_taken || {}).reduce((a, b) => a + b, 0)
    expect(Math.round(taken * 100) / 100).toBe(6)
  })
})
