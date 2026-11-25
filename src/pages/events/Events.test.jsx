import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import Events from './Events.jsx'

// "The events page isn't loading" (Brent, 25 Nov 2026): a row drawn with no
// icon crashed the whole screen. Invented events only.
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const start = new Date(Date.now() + 5 * 864e5).toISOString()
const event = { id: 'e1', title: 'Spine Dinner', kind: 'dinner', start, venue: 'Somewhere', organisers: [], form: [], cost: {}, guests: [] }

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async url => ({
    ok: true,
    json: async () => (String(url).includes('events=list') ? { events: [{ ...event, invited: 0, yes: 0 }], smsReady: false }
      : String(url).includes('events=get') ? { event, summary: {}, smsReady: false }
        : String(url).includes('events=contacts') ? { contacts: [] } : {})
  })))
}

describe('Me → Events', () => {
  it('opens on its list, with Contacts and the events', async () => {
    stubFetch()
    render(<Events user={{ token: 't', isAdmin: true }} onBack={() => {}} />)
    expect(await screen.findByText('Spine Dinner')).toBeInTheDocument()
    expect(screen.getByText('Contacts')).toBeInTheDocument()
    expect(document.querySelector('[data-new-event="dinner"]')).not.toBeNull()
  })
  it('opens an event and its sections', async () => {
    stubFetch()
    render(<Events user={{ token: 't', isAdmin: true }} onBack={() => {}} />)
    fireEvent.click(await screen.findByText('Spine Dinner'))
    await waitFor(() => expect(document.querySelector('[data-event-tab="guests"]')).not.toBeNull())
    for (const tab of ['details', 'form', 'venue', 'checkin', 'guests']) {
      fireEvent.click(document.querySelector(`[data-event-tab="${tab}"]`))
    }
    expect(screen.getByText(/No guests yet/)).toBeInTheDocument()
  })
  it('opens Contacts', async () => {
    stubFetch()
    render(<Events user={{ token: 't', isAdmin: true }} onBack={() => {}} />)
    fireEvent.click(await screen.findByText('Contacts'))
    expect(await screen.findByText(/No contacts yet/)).toBeInTheDocument()
  })
})
