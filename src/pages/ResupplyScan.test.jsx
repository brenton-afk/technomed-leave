import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ScanTab from './ScanTab.jsx'

// Invented case and products — no real patient is named in a test.
const CASE = { id: 'u1', folderName: 'Testa_02112026_Ibbett_Fixation_RHH', patientSurname: 'Testa', surgeonSurname: 'Ibbett', hospital: 'RHH', date: '2026-11-02', filed: true }
const COMPARISON = {
  rows: [
    { key: 'RF4535', referenceCode: 'RF-4535', product: 'Reform polyaxial screw', used: 4, before: 0, now: 3, owing: 1 },
    { key: 'RFROD', referenceCode: 'RF-ROD-120', product: 'Reform rod', used: 2, before: 0, now: 2, owing: 0 }
  ],
  extras: [],
  totals: { used: 6, before: 0, now: 5, owing: 1 }
}
const RESUPPLY = {
  distributorKey: 'e4', distributor: 'E4 Surgical', documentNumber: 'DN-1001', documentDate: '2026-11-05',
  lines: [{ id: 'line-0', referenceCode: 'RF-4535', description: 'Reform polyaxial screw', quantity: 3 },
    { id: 'line-1', referenceCode: 'RF-ROD-120', description: 'Reform rod', quantity: 2 }]
}

let calls
beforeEach(() => {
  calls = []
  localStorage.clear()
  localStorage.setItem('tm_scan_kind', 'resupply')
  global.fetch = vi.fn(async (url, init) => {
    const action = new URL(url, 'http://x').searchParams.get('action')
    calls.push({ action, body: init?.body ? JSON.parse(init.body) : null })
    const body = {
      'resupply-read': { resupply: RESUPPLY, candidates: [{ ...CASE, why: ['surname'] }], matchedId: 'u1', comparison: COMPARISON },
      'resupply-save': { entry: { id: 'x', distributor: 'E4 Surgical', filed: 'Testa partial E4 resupply 1.pdf' }, comparison: COMPARISON, case: CASE }
    }[action] || { records: [] }
    return { ok: true, json: async () => body }
  })
})
afterEach(() => vi.restoreAllMocks())

const pdf = () => new File(['%PDF-1.4 invented'], 'docket.pdf', { type: 'application/pdf' })

describe('the resupply scanner', () => {
  // Brent, 10 Nov 2026: matching to usage only; what is owed is followed in
  // the existing process, so there is no Still owed list.
  it('opens on the scan card, with no owed list', async () => {
    render(<ScanTab user={{ token: 't', name: 'Test Person' }} />)
    expect(screen.getByRole('tab', { name: 'Resupply' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText(/still owed/i)).not.toBeInTheDocument()
    expect(calls.some(c => c.action === 'resupply-owing')).toBe(false)
  })

  it('reads a docket and matches it to the usage, line by line', async () => {
    const { container } = render(<ScanTab user={{ token: 't' }} />)
    const input = container.querySelector('input[type=file]')
    fireEvent.change(input, { target: { files: [pdf()] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Read 1 page' }))
    await waitFor(() => expect(screen.getByText('Matched to the usage')).toBeInTheDocument())
    expect(screen.getByText('2 of 2 usage lines on this paper')).toBeInTheDocument()
    expect(screen.queryByText(/owed/)).not.toBeInTheDocument()
    expect(screen.getAllByText('Reform polyaxial screw').length).toBeGreaterThan(0)
    expect(screen.getByRole('radio', { checked: true })).toBeInTheDocument()
  })

  it('records it once, against the chosen case, with the pages for filing', async () => {
    const { container } = render(<ScanTab user={{ token: 't' }} />)
    fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [pdf()] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Read 1 page' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Record and file in the case folder' }))
    await waitFor(() => expect(screen.getByText(/Filed in the case folder as/)).toBeInTheDocument())
    const save = calls.find(c => c.action === 'resupply-save')
    expect(save.body).toMatchObject({ usageId: 'u1' })
    expect(save.body.id).toMatch(/^rs-/)
    expect(save.body.pages).toHaveLength(1)
  })

  it('switches back to usage scanning', async () => {
    render(<ScanTab user={{ token: 't' }} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Usage' }))
    expect(localStorage.getItem('tm_scan_kind')).toBe('usage')
  })
})
