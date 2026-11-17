import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InSituProvider, InSituFlag, inSituTag } from './InSitu.jsx'

// What is in situ on the week (Brent, 17 Nov 2026): the day's flag carries the
// answer and the rep confirms it. Invented patient.

const C = { id: 'evt1', patient: 'Testa', surgeon: 'Thani', date: '2026-11-24', inSitu: 'extension', who: 'Testa · Thani' }
const FLAG = { kind: 'inSitu', text: 'Check what is in situ', inSituCase: C }
const PLAN = { days: [{ date: '2026-11-24', flags: [FLAG] }] }
const reply = body => ({ ok: true, json: async () => body })

function draw() {
  return render(<InSituProvider plan={PLAN} token="t"><InSituFlag flag={FLAG} /></InSituProvider>)
}

beforeEach(() => { vi.clearAllMocks() })

describe('the in-situ flag', () => {
  it('shows the sentence and confirms it as the same patient', async () => {
    const sent = []
    global.fetch = vi.fn(async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body) })
      if (url.includes('insitu-confirm')) return reply({ confirmed: { answer: 'same', by: 'Aimee Vulinovich' } })
      return reply({ answers: { evt1: { status: 'found', sentence: 'Last usage (Thani, Calvary, 12 Mar 2025): Diplomat — 4 screws, 2 rods.', confirmed: null } } })
    })
    draw()
    await screen.findByText(/Diplomat — 4 screws, 2 rods/)
    expect(sent[0].body.cases[0]).toMatchObject({ id: 'evt1', patient: 'Testa' })
    fireEvent.click(screen.getByRole('button', { name: 'Same patient' }))
    await screen.findByText(/Same patient — confirmed by Aimee Vulinovich/)
    expect(sent.at(-1).body).toMatchObject({ answer: 'same', case: { id: 'evt1' } })
  })

  it('asks the rep to confirm when nothing was found', async () => {
    global.fetch = vi.fn(async () => reply({ answers: { evt1: { status: 'none', sentence: 'No usage in Dropbox.', confirmed: null } } }))
    draw()
    await screen.findByText('No usage in Dropbox.')
    expect(screen.getByRole('button', { name: "I've checked" })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Same patient' })).toBeNull()
  })

  it('keeps the week drawing when the lookup fails', async () => {
    global.fetch = vi.fn(async () => { throw new Error('offline') })
    draw()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.getByText('Looking for earlier usages…')).toBeTruthy()
  })
})

describe('the card tag', () => {
  it('says where the check stands', () => {
    expect(inSituTag(undefined)).toBe('In situ?')
    expect(inSituTag({ status: 'found' })).toBe('In situ: confirm')
    expect(inSituTag({ status: 'found', confirmed: { answer: 'same' } })).toBe('In situ ✓')
    expect(inSituTag({ status: 'none' })).toBe('No usage found')
    expect(inSituTag({ status: 'none', confirmed: { answer: 'none-confirmed' } })).toBe('In situ ✓')
  })
})
