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
    fireEvent.change(screen.getByLabelText('Product code'), { target: { value: 'AB0155-41058' } })
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '60mm' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check changes' }))
    await screen.findByText('Signus will be sent:')
    expect(calls.filter(([u]) => u.includes('action=amend')).every(([, b]) => b.preview)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Send correction' }))
    await waitFor(() => expect(screen.getByText(/Correction sent to Signus/)).toBeInTheDocument())
    const sent = calls.filter(([u]) => u.includes('action=amend')).at(-1)[1]
    expect(sent.items.at(-1)).toMatchObject({ productName: 'Diplomat cross link', referenceCode: 'AB0155-41058', size: '60mm', quantity: 1 })
    expect(sent.confirmGaps).toBeUndefined()
  })

  // Brent, 9 Nov 2026: "The portal should have picked up the missing size of
  // the rods before he sent it." Rods added as "Diplomat curved rods · 105"
  // with no code went to Signus.
  it('will not send a rod with no code until it is given one — and offers it', async () => {
    const calls = []
    global.fetch = vi.fn(async (url, init) => {
      calls.push([String(url), init?.body ? JSON.parse(init.body) : null])
      if (String(url).includes('action=record')) {
        return { ok: true, json: async () => ({ record: { id: 'u1', items: [] }, distributors: [{ key: 'signus', name: 'Signus' }] }) }
      }
      const body = JSON.parse(init.body)
      if (body.preview) return { ok: true, json: async () => ({ changes: [{ key: 'signus', name: 'Signus', lines: ['Added: 2 × Diplomat curved rods 105'] }] }) }
      return { ok: true, json: async () => ({ results: [{ key: 'signus', name: 'Signus', ok: true }] }) }
    })
    render(<AmendUsage usageId="u1" user={{ token: 't' }} onClose={() => {}} />)
    await screen.findByText(/Change a quantity/)
    fireEvent.change(screen.getByLabelText('Item'), { target: { value: 'Diplomat curved rods' } })
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '105' } })
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(document.querySelector('[data-amend-gaps]').textContent).toMatch(/no product code/)
    fireEvent.click(screen.getByRole('button', { name: 'Check changes' }))
    await screen.findByText('Signus will be sent:')
    expect(document.querySelector('[data-send-correction]').disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Use AB0955-00105' }))
    expect(document.querySelector('[data-amend-gaps]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Check changes' }))
    await screen.findByText('Signus will be sent:')
    fireEvent.click(screen.getByRole('button', { name: 'Send correction' }))
    await waitFor(() => expect(screen.getByText(/Correction sent to Signus/)).toBeInTheDocument())
    expect(calls.at(-1)[1].items[0]).toMatchObject({ productName: 'Diplomat curved rods', referenceCode: 'AB0955-00105', size: '105', quantity: 2 })
  })
})
