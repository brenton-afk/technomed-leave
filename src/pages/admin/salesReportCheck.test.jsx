import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SalesReportCheck } from './Invoices.jsx'

// Brent, 9 Nov 2026: a distributor's sales report checked against the portal.
// Invented data.
const result = {
  distributor: 'Signus', file: btoa('xlsx'),
  totals: { lines: 3, invoices: 2, sales: 4000, dated: 2, withChecks: 1 },
  invoices: [
    { invoice: '9001', invoiceDate: '2026-10-01', patient: 'SAMPLEA', surgeon: 'IBBETT', hospital: 'CLV', sales: 2944, surgeryDate: '2026-09-22', source: 'Portal usage', checks: [] },
    { invoice: '9004', invoiceDate: '2026-10-19', patient: 'SAMPLED', surgeon: 'ATALLAH', hospital: 'RHH', sales: 1056, surgeryDate: '2026-10-08', source: 'Bookings calendar', checks: ['No usage record in the portal — date from the bookings calendar'] }
  ],
  notBilled: [{ date: '2026-09-30', patient: 'Samplez', surgeon: 'Thani', hospital: 'CLV', note: 'Missing from this report' }]
}

afterEach(() => vi.restoreAllMocks())

describe('Check a sales report', () => {
  it('uploads the report and shows what to check, the cases not billed, and the download', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => result })
    render(<SalesReportCheck user={{ token: 't' }} onClose={() => {}} />)
    const file = new File(['x'], 'October.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    fireEvent.change(document.querySelector('[data-sales-file]'), { target: { files: [file] } })
    await waitFor(() => expect(document.querySelector('[data-sales-summary]')).toBeTruthy())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/usage/agent?action=sales-check')
    expect(screen.getByText(/Surgery date found for 2 of 2 invoices · 1 to check/)).toBeInTheDocument()
    expect(document.querySelector('[data-not-billed]').textContent).toMatch(/Samplez/)
    // Only the invoice with something to check, until All is chosen.
    expect(document.querySelector('[data-sales-invoice="9001"]')).toBeNull()
    expect(document.querySelector('[data-sales-invoice="9004"]').textContent).toMatch(/No usage record/)
    fireEvent.click(screen.getByText(/All invoices/))
    expect(document.querySelector('[data-sales-invoice="9001"]').textContent).toMatch(/22\/09\/2026/)
    expect(screen.getByText('Download the checked spreadsheet')).toBeInTheDocument()
  })
})
