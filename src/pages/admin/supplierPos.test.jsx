import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { SupplierPos } from './Invoices.jsx'

const REQUEST = { id: 'msg123456', mailbox: 'brenton@technomed.com.au', from: 'Cody Peng <cody.peng@macsurgical.com.au>', subject: 'Re: Kwire project 3.2mm x 500mm (updated 2.78mm x 500mm)', receivedAt: '2026-11-09T01:42:04Z', files: ['QUOTE0012501.pdf'], poNumber: 'PO-0147' }
const READING = {
  quote: { supplier: 'MAC Surgical', quoteNumber: '00012501', quoteDate: '2026-10-21', poNumber: 'PO-0147', freight: 0, totalExGst: 1980,
    lines: [{ code: 'MACTM28500', description: 'Kwire 3.2x500mm', quantity: 10, unitPrice: 198 }], checks: ['Description says 3.2mm; the order is 2.78mm'] },
  contacts: [{ id: 'mac', name: 'MAC SURGICAL' }],
  existing: { id: 'po-147', number: 'PO-0147', status: 'AUTHORISED', total: 1760, contact: { id: 'mac', name: 'MAC SURGICAL' }, lines: [{ quantity: 10, description: 'Kwire 3.2 x 500mm', unitPrice: 160 }] }
}

describe('supplier quote → PO screen', () => {
  it('checks email, reads the quote, shows what to check, and updates the named PO', async () => {
    const api = vi.fn(async (action, opts) => {
      if (action === 'supplier-quotes') return { requests: [REQUEST], errors: [] }
      if (action === 'supplier-quote-read') return READING
      if (action === 'supplier-po-save') return { po: { id: 'po-147', number: 'PO-0147', total: 2178 }, record: { status: 'updated' } }
      return {}
    })
    render(<SupplierPos api={api} onClose={() => {}} onPermission={() => {}} />)
    await waitFor(() => expect(screen.getByText(/Kwire project/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Read quote' }))
    await waitFor(() => expect(document.querySelector('[data-quote-checks]')).not.toBeNull())
    expect(document.querySelector('[data-po-total]').textContent).toMatch(/\$2,178\.00/)
    fireEvent.click(screen.getByRole('button', { name: 'Update PO-0147 in Xero' }))
    await waitFor(() => expect(document.querySelector('[data-po-done]')).not.toBeNull())
    const save = api.mock.calls.find(c => c[0] === 'supplier-po-save')[1].body
    expect(save).toMatchObject({ messageId: 'msg123456', update: 'PO-0147', quoteNumber: '00012501' })
    expect(document.querySelector('[data-po-done]').textContent).toMatch(/PO-0147.*updated.*\$2,178\.00/)
  })
})
