import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import KitRoom from '../KitRoom.jsx'
import KitDetail from './KitDetail.jsx'

// "Tapping 'it's here' makes it go green and acknowledges that the staff
// member has put it in the right place. At the moment you have to cancel out."

const KIT = { id: 'k1', name: 'Diplomat 1', system: 'Diplomat', distributor: 'signus', kind: 'consignment',
  home: 'CLV', at: 'CLV', trays: [], away: null, checkedAt: null }

let checked
beforeEach(() => {
  checked = false
  global.fetch = vi.fn(async (url, init) => {
    if (String(url).includes('kits=check')) { checked = true; return { ok: true, json: async () => ({ ok: true }) } }
    return { ok: true, json: async () => ({
      kits: [{ ...KIT, ...(checked ? { checkedAt: '2026-11-02T00:00:00Z', checkedBy: 'Ben' } : {}) }],
      settings: { emailsOn: false }, canEdit: false, isAdmin: false, today: '2026-11-02'
    }) }
  })
})

describe('the stock-take', () => {
  it('is one tap from the list, and the kit shows as checked', async () => {
    render(<KitRoom user={{ token: 't' }} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Diplomat 1 is here' }))
    await waitFor(() => expect(screen.getByText(/✓ checked by Ben/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Diplomat 1 is here' })).not.toBeInTheDocument()
  })

  it('in the kit sheet, confirms in green and closes itself', async () => {
    const onClose = vi.fn()
    const post = vi.fn(async () => ({ ok: true }))
    render(<KitDetail kit={KIT} canEdit={false} post={post} onClose={onClose} onChanged={async () => {}} onMove={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: "It's here" }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Checked — Diplomat 1 is at Calvary'))
    expect(post).toHaveBeenCalledWith('check', { kitId: 'k1', at: 'CLV' })
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 })
  })
})
