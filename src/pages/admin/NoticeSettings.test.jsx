import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import NoticeSettings from './NoticeSettings.jsx'

// "I tried to edit it, but it was really tricky to edit within the app."
// Fake addresses only.

const SETTINGS = {
  contacts: [{ id: 'device', name: 'Device', to: ['loans@example.com'], cc: ['one@example.com', 'two@example.com'] }],
  rules: [], loanRequests: []
}

let posted
beforeEach(() => {
  posted = null
  global.fetch = vi.fn(async (url, init) => {
    if (init?.method === 'POST') { posted = JSON.parse(init.body); return { ok: true, json: async () => posted } }
    return { ok: true, json: async () => SETTINGS }
  })
})

describe('editing a contact\'s addresses', () => {
  it('removes one person with one tap', async () => {
    render(<NoticeSettings user={{ token: 't' }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove one@example.com from Device Cc' }))
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted.contacts[0].cc).toEqual(['two@example.com'])
  })

  it('adds an address, and refuses one that is not an address', async () => {
    render(<NoticeSettings user={{ token: 't' }} />)
    const box = await screen.findByLabelText('Add to Device Cc')
    fireEvent.change(box, { target: { value: 'not an address' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[1])
    expect(screen.getByRole('alert')).toHaveTextContent('not an email address')
    fireEvent.change(box, { target: { value: 'three@example.com' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[1])
    expect(screen.getByText('three@example.com')).toBeInTheDocument()
  })
})
