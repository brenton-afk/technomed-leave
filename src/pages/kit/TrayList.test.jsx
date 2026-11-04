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
