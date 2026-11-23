import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import OtherMoveSheet from './OtherMoveSheet.jsx'
import { startBackButton, resetBackButton } from '../../backButton.js'

// Move something else (Brent, 23 Nov 2026): typed in, the email checked, then
// the courier buttons — the same as moving one of our kits.

beforeEach(() => {
  resetBackButton(); startBackButton()
  globalThis.fetch = vi.fn(async () => ({ json: async () => ({ events: [] }) }))
})

const COURIERS = [{ id: 'jet', name: 'Jet Couriers', phone: '03 6228 1900' }]

it('types in what is moving, checks the email, sends it and offers the courier', async () => {
  const post = vi.fn(async (what, body) => {
    if (what === 'move-other') return { id: 'other-1', item: body.item, from: body.from, to: body.to, trays: ['Cranial instruments'],
      email: { to: ['loans@example.test'], cc: ['bookings@technomed.com.au'], subject: 'TechnoMed transfer — Brainlab trays to Calvary', text: 'Hi Sharon,' } }
    if (what === 'confirm-other') return { ok: true, emailed: true }
    return { ok: true }
  })
  const done = vi.fn()
  render(<OtherMoveSheet user={{ token: 't' }} today="2026-11-24" post={post} couriers={COURIERS} onClose={() => {}} onDone={done} />)

  const next = document.querySelector('[data-other-next]')
  expect(next.disabled).toBe(true)
  fireEvent.change(document.querySelector('[data-other-item]'), { target: { value: 'Brainlab trays' } })
  fireEvent.click(screen.getAllByRole('button', { name: 'RHH' })[0]) // whose: the owner chips come first
  fireEvent.click(document.querySelector('[data-place="from-RHH"]'))
  fireEvent.click(document.querySelector('[data-place="to-CLV"]'))
  // RHH is where it comes from, so it cannot also be where it goes.
  expect(document.querySelector('[data-place="to-RHH"]').disabled).toBe(true)
  fireEvent.change(document.querySelector('[data-other-trays]'), { target: { value: 'Cranial instruments' } })
  fireEvent.click(next)

  await screen.findByText('Check before it goes')
  expect(post.mock.calls[0]).toEqual(['move-other', expect.objectContaining({ item: 'Brainlab trays', owner: 'RHH', from: 'RHH', to: 'CLV', trays: 'Cranial instruments' })])
  expect(screen.getByText('loans@example.test')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Email to the hospital'), { target: { value: 'Edited' } })
  fireEvent.click(document.querySelector('[data-other-send]'))

  await screen.findByText('Book a courier')
  expect(post).toHaveBeenCalledWith('confirm-other', { id: 'other-1', send: true, text: 'Edited' })
  expect(screen.getByText(/email sent/)).toBeTruthy()
  const call = document.querySelector('[data-call-courier="jet"]')
  expect(call.getAttribute('href')).toBe('tel:0362281900')
  fireEvent.click(call)
  await waitFor(() => expect(post).toHaveBeenCalledWith('courier-called', { itemName: 'Brainlab trays', courierId: 'jet' }))
  fireEvent.click(document.querySelector('[data-courier-done]'))
  expect(done).toHaveBeenCalled()
})
