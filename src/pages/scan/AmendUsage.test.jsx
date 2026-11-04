import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AmendUsage from './AmendUsage.jsx'

// Aimee, 4 Nov 2026: a cross link missed off a usage already sent. Invented items.
describe('amending a sent usage', () => {
  it('adds the missed item, shows who will be told, and sends only on request', async () => {
    const calls = []
    global.fetch = vi.fn(async (url, init) => {
      calls.push([String(url), init?.body ? JSON.parse(init.body) : null])
      if (String(url).includes('action=record')) {
        return { ok: true, json: async () => ({
          record: { id: 'u1', items: [{ id: 'i1', productName: 'DIPLOMAT screw', size: '6.5 x 45mm', quantity: 4, distributor: 'Signus', distributorKey: 'signus' }] },
          distributors: [{ key: 'signus', name: 'Signus' }]
        }) }
      }
      const body = JSON.parse(init.body)
      if (body.preview) return { ok: true, json: async () => ({ changes: [{ key: 'signus', name: 'Signus', lines: ['Added: 1 × Diplomat cross link 60mm'] }] }) }
      return { ok: true, json: async () => ({ results: [{ key: 'signus', name: 'Signus', ok: true }], test: false }) }
    })
    render(<AmendUsage usageId="u1" user={{ token: 't' }} onClose={() => {}} />)
    await screen.findByText(/DIPLOMAT screw/)
    fireEvent.change(screen.getByLabelText('Item'), { target: { value: 'Diplomat cross link' } })
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '60mm' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check changes' }))
    await screen.findByText('Signus will be sent:')
    expect(calls.filter(([u]) => u.includes('action=amend')).every(([, b]) => b.preview)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Send correction' }))
    await waitFor(() => expect(screen.getByText(/Correction sent to Signus/)).toBeInTheDocument())
    const sent = calls.filter(([u]) => u.includes('action=amend')).at(-1)[1]
    expect(sent.items.at(-1)).toMatchObject({ productName: 'Diplomat cross link', size: '60mm', quantity: 1 })
  })
})
