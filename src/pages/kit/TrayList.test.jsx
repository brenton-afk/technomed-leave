import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Aimee, 4 Nov 2026: "Can only save one tray list document, trying to add
// another one replaces over the previous document. Would be ideal to be able
// to select multiple at once and they all save." Invented kit and trays.

vi.mock('./readTrayFile.js', () => ({
  trayFilePayload: vi.fn(async file => ({ text: `contents of ${file.name}`, photos: [] })),
  originalIfSmall: vi.fn(async () => 'base64')
}))
vi.mock('@vercel/blob/client', () => ({ upload: vi.fn() }))

import TrayList from './TrayList.jsx'

const kit = { id: 'k1', name: 'Diplomat', home: 'RHH' }
const reply = body => ({ ok: true, json: async () => body })

beforeEach(() => {
  global.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    if (u.includes('kits=traylist')) {
      return reply({ list: { trays: [{ name: 'Existing', lines: [{ code: 'E', description: 'X', qty: 1, kind: 'instrument' }] }], source: {} } })
    }
    if (u.includes('action=tray-read')) {
      const { filename } = JSON.parse(init.body)
      return reply({ trays: [{ name: filename.replace('.pdf', ''), lines: [{ code: 'A', description: 'B', qty: 1, kind: 'instrument' }] }] })
    }
    if (u.includes('action=tray-keep')) return reply({ dropboxPath: '/Tray Lists/Hospital Copies/RHH/x.pdf' })
    return reply({})
  })
})

describe('tray lists from several files', () => {
  it('reads every file chosen into one review, and saves by adding', async () => {
    const post = vi.fn(async (_what, body) => ({ list: { trays: body.trays, source: {} } }))
    render(<TrayList kit={kit} canEdit user={{ token: 't' }} post={post} />)
    await screen.findByText('Existing')
    const input = document.querySelector('input[type=file]')
    expect(input).toHaveAttribute('multiple')
    const files = ['Torque.pdf', 'Navigated.pdf'].map(n => new File(['x'], n, { type: 'application/pdf' }))
    fireEvent.change(input, { target: { files } })
    await screen.findByText(/Read from 2 files: 2 trays/)
    expect(screen.getByText('Torque')).toBeInTheDocument()
    expect(screen.getByText('Navigated')).toBeInTheDocument()
    expect(screen.getByText(/Adds to the 1 tray this kit has/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save to Diplomat' }))
    await waitFor(() => expect(post).toHaveBeenCalled())
    const [what, body] = post.mock.calls[0]
    expect(what).toBe('savelist')
    expect(body.mode).toBe('add')
    expect(body.trays.map(t => [t.name, t.file])).toEqual([['Torque', 'Torque.pdf'], ['Navigated', 'Navigated.pdf']])
  })

  it('can still start the list again when asked', async () => {
    const post = vi.fn(async (_what, body) => ({ list: { trays: body.trays, source: {} } }))
    render(<TrayList kit={kit} canEdit user={{ token: 't' }} post={post} />)
    await screen.findByText('Existing')
    fireEvent.change(document.querySelector('input[type=file]'), { target: { files: [new File(['x'], 'Only.pdf')] } })
    await screen.findByText(/Read from Only.pdf/)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Save to Diplomat' }))
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(post.mock.calls[0][1].mode).toBe('replace')
  })
})

describe('deleting a whole tray (Aimee, 16 Nov 2026)', () => {
  it('asks first, sends the delete with the tray as it was shown, and the tray goes', async () => {
    const calls = []
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url)
      if (u.includes('kits=traylist')) {
        return reply({ list: { trays: [
          { name: 'Keep', lines: [{ code: 'K', description: 'AWL', qty: 1, kind: 'instrument' }] },
          { name: 'Wrong kit', lines: [{ code: 'W1', description: 'PLATE', qty: 2, kind: 'implant' }, { code: 'W2', description: 'DRILL', qty: 1, kind: 'instrument' }] }
        ], source: {} } })
      }
      if (u.includes('kits=editlist')) {
        calls.push(JSON.parse(init.body))
        return reply({ list: { trays: [{ name: 'Keep', lines: [{ code: 'K', description: 'AWL', qty: 1, kind: 'instrument' }] }], source: {} } })
      }
      return reply({})
    })
    window.confirm = vi.fn(() => true)
    render(<TrayList kit={kit} canEdit user={{ token: 't' }} post={vi.fn()} />)
    await screen.findByText('Wrong kit')
    fireEvent.click(screen.getByText('Wrong kit'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Wrong kit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete this tray' }))
    expect(window.confirm).toHaveBeenCalledWith('Delete the whole tray "Wrong kit" (2 items) from this kit?')
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ kitId: 'k1', op: 'deleteTray', tray: 'Wrong kit', expect: { lines: 2 } })
    await waitFor(() => expect(screen.queryByText('Wrong kit')).not.toBeInTheDocument())
    expect(screen.getByText('Keep')).toBeInTheDocument()
  })

  it('does nothing when the question is answered no', async () => {
    const calls = []
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes('kits=editlist')) calls.push(init)
      return reply({ list: { trays: [{ name: 'Only', lines: [{ code: 'A', description: 'B', qty: 1, kind: 'instrument' }] }], source: {} } })
    })
    window.confirm = vi.fn(() => false)
    render(<TrayList kit={kit} canEdit user={{ token: 't' }} post={vi.fn()} />)
    await screen.findByText('Only')
    fireEvent.click(screen.getByText('Only'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Only' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete this tray' }))
    expect(calls).toHaveLength(0)
    expect(screen.getAllByText('Only').length).toBeGreaterThan(0)
  })
})

// Brent, 20 Nov 2026: "The list we want to see is the list of the interactive
// tray buttons … click all of the trays and edit them, as well as move
// individual trays … when we take an instrument off the kit for repair, it
// automatically emails the respective departments."
describe('every tray is a button: open, edit, move, repair', () => {
  const kit2 = { id: 'k1', name: 'Diplomat', home: 'RHH', at: 'RHH', trays: ['Existing', 'Empty tray'] }

  it('shows a tray the kit names even with nothing uploaded for it, and moves one tray on its own', async () => {
    const onMoveTray = vi.fn()
    render(<TrayList kit={kit2} canEdit user={{ token: 't' }} post={vi.fn()} onMoveTray={onMoveTray} />)
    expect(await screen.findByText('Empty tray')).toBeInTheDocument()
    expect(screen.getByText(/Nothing listed yet/)).toBeInTheDocument()
    expect(screen.getByText('Trays · 2')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Empty tray'))
    fireEvent.click(screen.getByRole('button', { name: 'Move Empty tray' }))
    expect(onMoveTray).toHaveBeenCalledWith('Empty tray')
    expect(screen.getByRole('button', { name: 'Edit Empty tray' })).toBeInTheDocument()
  })

  it('sends an instrument for repair: the email is shown first, then sent', async () => {
    const calls = []
    const email = { to: ['kirsty.patmore@ths.tas.gov.au'], cc: ['projects@technomed.com.au'], subject: 'Instrument for repair – Diplomat · Existing · X', text: 'Fault: bent' }
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url)
      if (u.includes('kits=traylist')) return reply({ list: { trays: [{ name: 'Existing', lines: [{ code: 'E', description: 'X', qty: 1, kind: 'instrument' }] }], source: {} } })
      if (u.includes('kits=repair')) {
        const body = JSON.parse(init.body); calls.push(body)
        return reply(body.preview ? { email } : { list: { trays: [{ name: 'Existing', lines: [{ code: 'E', description: 'X', qty: 1, kind: 'instrument', repair: { since: '2026-11-20T00:00:00Z', fault: 'bent' } }] }], source: {} } })
      }
      return reply({})
    })
    render(<TrayList kit={kit2} canEdit user={{ token: 't' }} post={vi.fn()} />)
    fireEvent.click(await screen.findByText('Existing'))
    fireEvent.click(screen.getByRole('button', { name: 'Send X for repair' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'What is wrong with it' }), { target: { value: 'bent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check the email' }))
    expect(await screen.findByText('kirsty.patmore@ths.tas.gov.au')).toBeInTheDocument()
    expect(calls[0]).toMatchObject({ preview: true, hospital: 'RHH', tray: 'Existing', index: 0, fault: 'bent' })
    fireEvent.click(screen.getByRole('button', { name: 'Send and mark it away for repair' }))
    expect(await screen.findByText('At repair · back?')).toBeInTheDocument()
    expect(calls[1].preview).toBe(false)
  })
})

// Brent, 21 Nov 2026: "when you open a tray that should open its own page …
// Then you tap back to go back to the rest of the list".
describe('a tray opens as its own page', () => {
  it('opens over the list and goes back with the back arrow', async () => {
    global.fetch = vi.fn(async () => reply({ list: { trays: [
      { name: 'Tray A', lines: [{ code: 'A1', description: '#1 Driver', qty: 2, kind: 'instrument' }] },
      { name: 'Tray B', lines: [{ code: 'B1', description: 'Rod', qty: 1, kind: 'implant' }] }
    ], source: {} } }))
    render(<TrayList kit={{ id: 'k1', name: 'Diplomat', home: 'RHH', trays: ['Tray A', 'Tray B'] }} canEdit user={{ token: 't' }} post={vi.fn()} onMoveTray={() => {}} />)
    fireEvent.click(await screen.findByText('Tray A'))
    const page = document.querySelector('[data-tray-page]')
    expect(page).toBeTruthy()
    expect(page.textContent).toContain('Driver')
    expect(page.textContent).not.toContain('Tray B')
    expect(page.querySelector('[data-move-tray]')).toBeTruthy()
    fireEvent.click(page.querySelector('[data-tray-back]'))
    expect(document.querySelector('[data-tray-page]')).toBeNull()
  })
})
