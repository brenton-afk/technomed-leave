import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import SetAsideEmails, { outcomeLine } from './SetAsideEmails.jsx'

// Brent, 11 Nov 2026: a booking sat in bookings@ while the Inbox said nothing
// was outstanding. Every email that did not become a card is listed. Invented.

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const LIST = {
  ok: true,
  emails: [
    { messageId: 'm1', from: 'reception@rooms.com.au', subject: 'Theatre booking Pt Testb', receivedAt: '2026-11-10T01:00:00Z', why: 'not-a-booking-sender', looksLikeBooking: true },
    { messageId: 'm2', from: 'news@example.com', subject: 'Specials', receivedAt: '', why: 'not-a-booking-sender', looksLikeBooking: false }
  ],
  matched: [{ id: 'c1', patient: 'Testd', surgeon: 'Ibbett', date: '2026-11-12', matchedSummary: 'Testd PLIF - Ibbett' }]
}

describe('the set-aside list', () => {
  it('shows what was set aside, reads one on request and says what came of it', async () => {
    const fetchMock = vi.fn(async (url, init) => ({
      ok: true,
      json: async () => (String(url).includes('setaside') ? LIST
        : { ok: true, pending: [], outcomes: { m1: { found: 1, queued: 1, already: [] } } })
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SetAsideEmails headers={() => ({})} refreshKey={1} />)
    expect(await screen.findByText('Theatre booking Pt Testb')).toBeInTheDocument()
    expect(screen.getByText(/Set aside — 2 emails/)).toBeInTheDocument()
    // The newsletter is folded away, not hidden.
    expect(screen.queryByText('Specials')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(/Other emails \(1\)/))
    expect(screen.getByText('Specials')).toBeInTheDocument()

    fireEvent.click(screen.getAllByText('Read it as a booking')[0])
    await waitFor(() => expect(screen.getByText(/1 booking added above to confirm/)).toBeInTheDocument())
    const forced = fetchMock.mock.calls.find(([u]) => String(u).includes('action=ingest'))
    expect(JSON.parse(forced[1].body)).toEqual({ force: ['m1'] })
  })

  it('says so when every email is accounted for', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, emails: [], matched: [] }) })))
    render(<SetAsideEmails headers={() => ({})} refreshKey={1} />)
    expect(await screen.findByText('Every email accounted for')).toBeInTheDocument()
  })
})

describe('outcomeLine', () => {
  it('names the calendar entry a booking was matched to', () => {
    expect(outcomeLine({ found: 1, queued: 0, already: ['Testd PLIF - Ibbett'] })).toMatch(/already on the calendar as “Testd PLIF - Ibbett”/)
    expect(outcomeLine({ found: 0, queued: 0, already: [] })).toMatch(/No booking could be found/)
  })
})
