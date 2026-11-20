import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import KitRoom from '../KitRoom.jsx'
import { startBackButton, resetBackButton } from '../../backButton.js'

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
    const dialog = await screen.findByRole('dialog', { name: 'Move Diplomat' })
    expect(dialog).toHaveTextContent('Diplomat')
    expect(dialog).not.toHaveTextContent('Diplomat 2')
  })

  it('shows a tray moved on its own under Transferred trays, not in the other set, and ticks several to move', async () => {
    const moved = [KITS[0], { ...KITS[1], trayAt: { 'Diplomat Pedicle Screws 2': { at: 'CLV', byName: 'Aimee', since: '2026-11-20T01:00:00Z' } } }]
    global.fetch = vi.fn(async url => {
      const u = String(url)
      if (u.includes('kits=traylist')) return { ok: true, json: async () => ({ list: null }) }
      return { ok: true, json: async () => ({ kits: moved, settings: { emailsOn: false }, canEdit: true, isAdmin: false, today: '2026-11-20' }) }
    })
    render(<KitRoom user={{ token: 't' }} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Diplomat' }))
    const box = document.querySelector('[data-transferred]')
    await waitFor(() => expect(box).toHaveTextContent('Diplomat Pedicle Screws 2'))
    expect(box).toHaveTextContent('Now at Calvary')
    expect(box).toHaveTextContent('From the RHH set · moved by Aimee')
    expect(box).not.toHaveTextContent('Diplomat Pedicle Screws 1')
    const rhh = document.querySelector('[data-system-set="d2"]')
    expect(rhh).toHaveTextContent('Diplomat Pedicle Screws 1')
    expect(rhh).not.toHaveTextContent('Diplomat Pedicle Screws 2')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Diplomat Pedicle Screws 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Diplomat Pedicle Screws 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move 2 trays' }))
    const dialog = await screen.findByRole('dialog', { name: 'Move Diplomat' })
    expect(dialog).toHaveTextContent('Diplomat')
  })

  it('opened from the RHH filter, shows RHH only, the rest one tap away', async () => {
    render(<KitRoom user={{ token: 't' }} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /RHH/, pressed: false }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open Diplomat' }))
    await waitFor(() => expect(document.querySelector('[data-system-set="d2"]')).toBeTruthy())
    expect(document.querySelector('[data-system-set="d1"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Also show Diplomat at the other places' }))
    expect(document.querySelector('[data-system-set="d1"]')).toBeTruthy()
  })

  // Brent, 20 Nov 2026: "When I hit move nothing happens." The system closed as
  // the move sheet opened, and its back-button step took the sheet with it.
  it('Move on a tray opens the move sheet, and it stays open', async () => {
    resetBackButton()
    const stop = startBackButton({ tab: 'kit', sub: 'kitroom' }, () => {})
    try {
      render(<KitRoom user={{ token: 't' }} onBack={() => {}} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Open Diplomat' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Move Diplomat Rods' }))
      expect(await screen.findByRole('dialog', { name: 'Move Diplomat' })).toBeInTheDocument()
      await new Promise(r => setTimeout(r, 100))
      // The system stays open underneath: closing it as the sheet opened is a
      // history.back() racing the sheet's pushState, which in a real browser
      // lands on the step before and closes the sheet (jsdom cannot show that).
      expect(screen.getByRole('dialog', { name: 'Diplomat' })).toBeInTheDocument()
      expect(screen.getByRole('dialog', { name: 'Move Diplomat' })).toBeInTheDocument()
      const sheet = screen.getByRole('dialog', { name: 'Move Diplomat' })
      fireEvent.click(within(sheet).getByRole('button', { name: /RHH/ }))
      expect(within(sheet).getByText(/Trays going · 1 of 1/)).toBeInTheDocument()
    } finally { stop(); resetBackButton() }
  })

  // Brent, 20 Nov 2026: "move the kit, send the email, and then have the
  // option to call the courier."
  it('after the move, offers to call a courier, and logs the call', async () => {
    const posted = []
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url)
      if (init?.body) posted.push([u.split('kits=')[1], JSON.parse(init.body)])
      if (u.includes('kits=traylist')) return { ok: true, json: async () => ({ list: null }) }
      if (u.includes('kits=move')) return { ok: true, json: async () => ({ id: 'mv1', to: 'CLV', from: 'RHH', trays: ['Diplomat Pedicle Screws 1'], email: null, isReturn: false }) }
      if (u.includes('kits=confirm')) return { ok: true, json: async () => ({ ok: true, emailed: false }) }
      if (u.includes('kits=courier-called')) return { ok: true, json: async () => ({ ok: true }) }
      return { ok: true, json: async () => ({ kits: KITS, settings: { emailsOn: false }, canEdit: true, isAdmin: false, today: '2026-11-20',
        couriers: [{ id: 'jet', name: 'Jet Couriers', phone: '03 6228 1900', note: 'Around Hobart' }, { id: 'c', name: 'Clayton (Smartways)', phone: '', note: '' }] }) }
    })
    render(<KitRoom user={{ token: 't' }} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Diplomat' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Move Diplomat Pedicle Screws 1' }))
    const sheet = await screen.findByRole('dialog', { name: 'Move Diplomat' })
    fireEvent.click(within(sheet).getByRole('button', { name: /Calvary/ }))
    fireEvent.click(within(sheet).getByRole('button', { name: /Next/ }))
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Move' }))
    expect(await within(sheet).findByText(/Moved to Calvary/)).toBeInTheDocument()
    const call = within(sheet).getByRole('link', { name: /Call Jet Couriers/ })
    expect(call).toHaveAttribute('href', 'tel:0362281900')
    expect(within(sheet).getByText(/Clayton \(Smartways\) — no number yet/)).toBeInTheDocument()
    fireEvent.click(call)
    await waitFor(() => expect(posted.some(([w, b]) => w === 'courier-called' && b.courierId === 'jet')).toBe(true))
    expect(within(sheet).getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })
})
