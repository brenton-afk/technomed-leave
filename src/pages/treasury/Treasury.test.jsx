import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MeHub } from '../Hubs.jsx'
import Treasury from './Treasury.jsx'

// ─── The Treasury, as other staff see it: not at all ─────────────────────────

const ERIN = { name: 'Erin', email: 'erin@technomed.com.au', token: 't', isAdmin: true, staff: { role: 'General Manager' } }

afterEach(() => vi.unstubAllGlobals())

describe('the card', () => {
  it('is not on the Me hub unless the server has said yes', () => {
    render(<MeHub user={ERIN} onNavigate={() => {}} onLogout={() => {}} />)
    expect(screen.queryByText('Treasury')).toBeNull()
  })

  it('appears when it has', () => {
    render(<MeHub user={ERIN} onNavigate={() => {}} onLogout={() => {}} treasury />)
    expect(screen.getByText('Treasury')).toBeInTheDocument()
  })

  it('appears for someone on the list who is not an admin, too', () => {
    render(<MeHub user={{ ...ERIN, isAdmin: false }} onNavigate={() => {}} onLogout={() => {}} treasury />)
    expect(screen.getByText('Treasury')).toBeInTheDocument()
    expect(screen.queryByText('Admin portal')).toBeNull()
  })
})

describe('landing on it anyway', () => {
  it('shows nothing but a way back when the server answers 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })))
    render(<Treasury user={ERIN} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText('Not available')).toBeInTheDocument())
    expect(screen.queryByText(/Cash at bank/)).toBeNull()
  })
})

describe('the code', () => {
  it('is not in the list of screens prefetched onto every signed-in phone', () => {
    const lazy = readFileSync(join(__dirname, '..', '..', 'lazyScreens.jsx'), 'utf8')
    expect(lazy).not.toMatch(/treasury/i)
  })
})

describe('trust investments', () => {
  it('shows each holding in its own currency, the statement check, and an annual preview shape', async () => {
    const { default: Investments } = await import('./Investments.jsx')
    const body = {
      today: '2026-11-04', fx: 0.65, roc: [], rocCfg: {},
      prices: { XYZ: { price: 50, at: '2026-11-04T00:00:00Z', source: 'live' }, GLD: { price: 30, at: '2025-06-30T00:00:00.000Z', source: 'statement' } },
      holdings: [
        { ticker: 'XYZ', currency: 'USD', units: 30, costUsd: 600, averageUsd: 20 },
        { ticker: 'GLD', currency: 'AUD', units: 10, costUsd: 200, averageUsd: 20 }
      ],
      checks: [{ date: '2025-06-30', ticker: 'XYZ', statement: 30, ledger: 30, matches: true }],
      statements: [{ market: 'USA', from: '2024-07-01', to: '2025-06-30' }],
      autoOpenings: [], ignored: { openings: [], actions: [] },
      income: [{ fy: 'FY26', ticker: 'XYZ', currency: 'USD', gross: 60, withholding: 9, fees: 1, refunds: 0, net: 50, payments: 1 }],
      conversions: [], openings: [], actions: [], suggestedOpenings: [], suggestedConsolidations: [], cash: null, reports: [], recent: []
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => body })))
    render(<Investments user={ERIN} onBack={() => {}} onLocked={() => {}} />)
    await waitFor(() => expect(screen.getByText(/Checked against SelfWealth/)).toBeInTheDocument())
    expect(screen.getByText('A$30.00')).toBeInTheDocument() // GLD's price, in A$
    expect(screen.getByText('US$50.00')).toBeInTheDocument()
    expect(document.body.textContent).toMatch(/A\$30\.00statement · 30 June? 2025/)
    // Value in A$: 1,500 US$ at 0.65 plus A$300.
    expect(screen.getByText('$2,608')).toBeInTheDocument()
  })
})

describe('return of capital section', () => {
  it('says what is checked and what is not known, and projects nothing without a share', async () => {
    const { default: RocSection } = await import('./RocSection.jsx')
    const { trackRoc, DEFAULT_ROC } = await import('../../treasury/roc.js')
    const row = (date, kind, extra) => ({ key: `${date}|${kind}`, at: `${date}T00:00:00`, date, kind, ticker: 'MSTY', ...extra })
    const rows = [
      row('2025-01-02', 'buy', { units: 100, amount: -1000, order: '1', settle: '2025-01-03' }),
      row('2025-06-09', 'distribution', { units: 100, perUnit: 1, amount: 100, recordDate: '2025-06-05' }),
      row('2025-06-09', 'withholding', { units: 100, amount: -15 }),
      row('2026-02-09', 'distribution', { units: 100, perUnit: 1, amount: 100, recordDate: '2026-02-05' }),
      row('2026-09-15', 'refund', { units: 100, amount: 15 })
    ]
    const roc = trackRoc({ rows, fx: () => 0.5, cfg: DEFAULT_ROC, today: '2026-10-01' })
    render(<RocSection roc={roc} cfg={DEFAULT_ROC} today="2026-10-01" onSave={async () => true} />)
    const text = document.body.textContent
    expect(text).toMatch(/Checked: each of the 2 payments was paid on exactly the units/)
    expect(text).toMatch(/not a tax position/)
    expect(text).toMatch(/1 had their US withholding refunded in full/)
    expect(text).toMatch(/No projection/)
    expect(text).not.toMatch(/Next to reach nil/)
  })
})
