import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import KitRoom from '../KitRoom.jsx'

// Brent, 20 Nov 2026: "We will just have Diplomat and then under that … No set
// numbers"; "the add kit button to be an add tray button … from within
// Diplomat … add a tray"; "an entire kit button so you can choose it all at
// once". Invented kits.
const KITS = [
  { id: 'd1', name: 'Diplomat 1', system: 'Diplomat', distributor: 'signus', kind: 'consignment', home: 'CLV', at: 'CLV', trays: ['Diplomat Rods'] },
  { id: 'd2', name: 'Diplomat 2', system: 'Diplomat', distributor: 'signus', kind: 'consignment', home: 'RHH', at: 'RHH', trays: ['Diplomat Pedicle Screws 1', 'Diplomat Pedicle Screws 2'] }
]
let saved
beforeEach(() => {
  saved = []
  global.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    if (u.includes('kits=save')) { saved.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ok: true }) } }
    if (u.includes('kits=traylist')) return { ok: true, json: async () => ({ list: null }) }
    return { ok: true, json: async () => ({ kits: KITS, settings: { emailsOn: false }, canEdit: true, isAdmin: false, today: '2026-11-20' }) }
  })
})

describe('one tile per system', () => {
  it('shows Diplomat once, never Diplomat 1 or 2', async () => {
    render(<KitRoom user={{ token: 't' }} onBack={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Open Diplomat' })).toBeInTheDocument()
    expect(screen.queryByText('Diplomat 1')).not.toBeInTheDocument()
    expect(screen.getByText('3 trays')).toBeInTheDocument()
    expect(screen.queryByText('+ Add a kit')).not.toBeInTheDocument()
  })

  it('adds a tray from inside the system, to the set at the place chosen', async () => {
    render(<KitRoom user={{ token: 't' }} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Diplomat' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add a tray to Diplomat' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Tray name' }), { target: { value: 'Diplomat Pedicle Screws 3' } })
    fireEvent.click(screen.getByRole('button', { name: 'RHH' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add the tray' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0].kit).toMatchObject({ id: 'd2', trays: ['Diplomat Pedicle Screws 1', 'Diplomat Pedicle Screws 2', 'Diplomat Pedicle Screws 3'] })
  })

  it('moves a whole hospital set with Move all, every tray ticked, Entire kit to toggle', async () => {
    render(<KitRoom user={{ token: 't' }} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Diplomat' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Move all RHH trays' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Diplomat')
    expect(dialog).not.toHaveTextContent('Diplomat 2')
  })
})
