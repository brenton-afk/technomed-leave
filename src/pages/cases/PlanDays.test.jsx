import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import PlanDays from './PlanDays.jsx'
import { dayRuns, whosWhere } from '../../clinicalPlan/whosWhere.js'
import { cleanAway } from '../../clinicalPlan/away.js'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const USER = { name: 'Ben Cassidy', email: 'ben@technomed.com.au', token: 't' }

describe('plan days on a calendar (Brent, 28 Nov 2026)', () => {
  it('groups chosen days into runs of days in a row', () => {
    expect(dayRuns(['2026-12-03', '2026-12-01', '2026-12-02', '2026-12-07'])).toEqual([
      { from: '2026-12-01', to: '2026-12-03' }, { from: '2026-12-07', to: '2026-12-07' }])
  })

  it('saves several days at once, one entry per run, one after another', async () => {
    const posts = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      if (opts.method === 'POST') posts.push(JSON.parse(opts.body))
      return { ok: true, json: async () => (opts.method === 'POST' ? { entry: {} } : { entries: [] }) }
    }))
    const onSaved = vi.fn()
    render(<PlanDays user={USER} date="2026-12-01" onClose={() => {}} onSaved={onSaved} />)
    fireEvent.click(document.querySelector('[data-plan-kind="wfh"]'))
    for (const d of ['2026-12-01', '2026-12-02', '2026-12-04']) fireEvent.click(document.querySelector(`[data-plan-day="${d}"]`))
    expect(document.querySelector('[data-plan-save]').textContent).toMatch(/Set 3 days to Working from home · Ben/)
    fireEvent.click(document.querySelector('[data-plan-save]'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(posts).toEqual([
      expect.objectContaining({ email: 'ben@technomed.com.au', kind: 'wfh', from: '2026-12-01', to: '2026-12-02' }),
      expect.objectContaining({ kind: 'wfh', from: '2026-12-04', to: '2026-12-04' })])
  })

  it('offers Boys week for Ben only', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ entries: [] }) })))
    render(<PlanDays user={USER} date="2026-12-01" onClose={() => {}} />)
    expect(document.querySelector('[data-plan-kind="boysweek"]')).toBeTruthy()
    fireEvent.click(document.querySelector('[data-plan-person="Mat"]'))
    expect(document.querySelector('[data-plan-kind="boysweek"]')).toBeNull()
    expect(cleanAway({ email: 'mat@technomed.com.au', kind: 'boysweek', from: '2026-12-01' }).error).toBeTruthy()
    expect(cleanAway({ email: 'ben@technomed.com.au', kind: 'boysweek', from: '2026-12-01', to: '2026-12-05' }).error).toBeUndefined()
  })
})

describe("Ben's boys week on the strip", () => {
  const boys = { email: 'ben@technomed.com.au', kind: 'boysweek', from: '2026-11-30', to: '2026-12-04', at: '2026-11-28T00:00:00Z' }
  const ben = rows => rows.find(r => r.person.firstName === 'Ben')
  it('keeps where he is and adds the hours', () => {
    const day = { casesByHospital: [{ hospital: 'RHH', cases: [{ patient: 'X', surgeon: 'Fowler', planned: ['Ben'] }] }] }
    const row = ben(whosWhere({ date: '2026-12-01', day, entries: [boys] }))
    expect(row).toMatchObject({ kind: 'theatre', boysWeek: true })
    expect(row.note).toMatch(/late start, early finish/)
  })
  it('shows Boys week on its own when nothing else is known', () => {
    expect(ben(whosWhere({ date: '2026-12-02', day: {}, entries: [boys] }))).toMatchObject({ kind: 'boysweek', short: 'BOYS WK' })
    expect(ben(whosWhere({ date: '2026-12-07', day: {}, entries: [boys] })).kind).toBe(null)
  })
})
