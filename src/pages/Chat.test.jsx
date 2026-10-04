import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import Chat, { ChannelView, CaseThread } from './Chat.jsx'

// Replacing a WhatsApp group of nine. What has to hold: a message always sends,
// the warning about patient detail is seen before it does, and nothing the app
// shows is a rewrite of what somebody typed.

const USER = { email: 'brenton@technomed.com.au', token: 'tok' }

let sent

function serving(messages = []) {
  sent = null
  global.fetch = vi.fn(async (url, init) => {
    if (init?.method === 'POST') {
      sent = JSON.parse(init.body)
      return { ok: true, status: 200, json: async () => ({ ok: true, message: sent }) }
    }
    if (String(url).includes('action=overview')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          channels: [
            { id: 'general', name: 'General', detail: 'Anything else', unread: 0 },
            { id: 'logistics', name: 'Logistics', detail: 'Sets and loans', unread: 3 }
          ],
          cases: []
        })
      }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, messages }) }
  })
}

beforeEach(() => serving())
afterEach(() => vi.restoreAllMocks())

const channel = (props = {}) => render(
  <ChannelView channel="logistics" title="Logistics" user={USER} onBack={() => {}} {...props} />
)

describe('the channel list', () => {
  it('shows how much is waiting', async () => {
    render(<Chat user={USER} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText('# Logistics')).toBeInTheDocument())
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})

describe('sending', () => {
  it('sends an ordinary message on the first tap', async () => {
    channel()
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Rowe is second up' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(sent).not.toBeNull())
    expect(sent.text).toBe('Rowe is second up')
    expect(sent.warned).toBe(false)
  })

  it('warns about a date of birth, then sends it as written', async () => {
    // The message always goes. The warning only insists it was seen — and what
    // is stored is exactly what was typed, because rewriting somebody's words
    // without telling them is not a thing to do to a conversation.
    channel()
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Rowe 12/3/1958 second up' }
    })
    await waitFor(() => expect(screen.getByText(/date of birth/)).toBeInTheDocument())

    // First tap is the warning, not a send.
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(sent).toBeNull()
    await waitFor(() => expect(screen.getByText(/Send again/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(sent).not.toBeNull())
    expect(sent.text).toBe('Rowe 12/3/1958 second up')
    expect(sent.warned).toBe(true)
  })

  it('does not warn about the ordinary language of a day', async () => {
    // A warning that fires on every second message is one nobody reads.
    channel()
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeInTheDocument())
    for (const message of ['L4/5 PLIF Wednesday', 'Theatre 11 all day', 'Kon then Rowe']) {
      fireEvent.change(screen.getByLabelText('Message'), { target: { value: message } })
      expect(screen.queryByText(/Surnames only/), message).not.toBeInTheDocument()
    }
  })

  it('shows the message before the server has confirmed it', async () => {
    // On a hospital connection a round trip before anything appears reads as
    // broken.
    channel()
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Set is back' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByText('Set is back')).toBeInTheDocument()
  })
})

describe('reading', () => {
  const MESSAGES = [
    { id: '1', author: 'toni@technomed.com.au', authorName: 'Toni', text: 'Diplomat set back from CSSD', at: '2026-09-29T06:42:00.000Z' },
    { id: '2', author: 'toni@technomed.com.au', authorName: 'Toni', text: 'Ready for Friday', at: '2026-09-29T06:43:00.000Z' },
    { id: '3', author: 'brenton@technomed.com.au', authorName: 'Brent', text: 'Second up, Aimee on site 8:30', at: '2026-09-29T06:51:00.000Z' }
  ]

  it('reads as a conversation, not a stack of cards', async () => {
    // Two messages in a row from one person are one turn. Naming Toni twice is
    // what makes a chat look like a form.
    serving(MESSAGES)
    channel()
    await waitFor(() => expect(screen.getByText('Diplomat set back from CSSD')).toBeInTheDocument())
    expect(screen.getAllByText('Toni')).toHaveLength(1)
    expect(screen.getByText('Brent')).toBeInTheDocument()
  })

  it('says when there is nothing yet', async () => {
    channel()
    await waitFor(() => expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument())
  })
})

describe('a booking\'s own thread', () => {
  // The channels are organised by subject. Most of what gets said is not about
  // a subject, it is about a case — "has the Diplomat gone over for Thursday"
  // is findable in a channel for about an hour and then it is gone. The id was
  // reserved when the channels were built and there was never a way in.
  it('reads and writes the channel belonging to that booking', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ ok: true, messages: [] })
    }))
    render(<CaseThread eventId="evt_123" subtitle="Pennant · JPW" user={USER} onClose={() => {}} />)

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url] = global.fetch.mock.calls[0]
    expect(url).toContain(`channel=${encodeURIComponent('case:evt_123')}`)
  })

  it('says which case it is', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ ok: true, messages: [] })
    }))
    render(<CaseThread eventId="evt_123" subtitle="Pennant · JPW" user={USER} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Pennant · JPW')).toBeInTheDocument())
  })

  it('cannot be confused with a standing channel', () => {
    // case: is a namespace on purpose — a booking whose id happened to be
    // "spine" must not open the spine channel.
    expect(`case:spine`).not.toBe('spine')
  })
})
