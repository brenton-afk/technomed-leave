import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RebateCodes from './RebateCodes.jsx'

// Brent, 21 Nov 2026: the price list's rebate codes under each system. Invented lines.
const reply = withPrices => ({
  withPrices, readAt: '2026-11-18T00:00:00Z',
  lists: [
    { key: 'kt-rhh', label: 'KT Medical (RHH)', hospital: 'RHH', lines: [{ code: 'A1', description: 'Test screw 5.5 x 40', type: 'Implant', rebate: 'PLX1', ...(withPrices ? { price: 12.5 } : {}) }, { code: 'A2', description: 'Test rod', type: 'Implant', rebate: 'PLX2' }] },
    { key: 'kt-private', label: 'KT Medical (Private)', hospital: 'private', lines: [{ code: 'A1', description: 'Test screw 5.5 x 40', type: 'Implant', rebate: 'PLX1' }] }
  ]
})

describe('a system’s rebate codes', () => {
  it('lists codes and rebate codes with a search, and no price for staff', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => reply(false) }))
    render(<RebateCodes system="Orthofix Firebird" user={{ token: 't' }} onClose={() => {}} />)
    await waitFor(() => expect(document.querySelectorAll('[data-code-line]')).toHaveLength(2))
    expect(document.querySelector('[data-rebate]')).toHaveTextContent('PLX1')
    expect(document.querySelector('[data-price]')).toBeNull()
    fireEvent.change(screen.getByLabelText('Find a code'), { target: { value: 'rod' } })
    expect(document.querySelectorAll('[data-code-line]')).toHaveLength(1)
    fireEvent.click(document.querySelector('[data-codes-list="kt-private"]'))
    fireEvent.change(screen.getByLabelText('Find a code'), { target: { value: '' } })
    expect(document.querySelectorAll('[data-code-line]')).toHaveLength(1)
  })
  it('shows the price to an admin', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => reply(true) }))
    render(<RebateCodes system="Orthofix Firebird" user={{ token: 't' }} onClose={() => {}} />)
    await waitFor(() => expect(document.querySelector('[data-price]')).toHaveTextContent('$12.50'))
  })
})
