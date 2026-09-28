import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import TheatreGuides from './TheatreGuides.jsx'

// Field references read on a phone in theatre. The one thing that must hold
// however the rest changes: Surgeon Preferences names individual surgeons and
// records how each likes theatre set up, and it is never fetched without the
// session header.

const LIST = {
  guides: [
    { slug: 'diplomat', name: 'DIPLOMAT', maker: 'SIGNUS', group: 'Spine', revision: 'Rev. 2015-08' },
    { slug: 'clavicle-2.7', name: 'VA LCP Clavicle Plate 2.7', maker: 'DePuy Synthes', group: 'Orthopaedics' },
    { slug: 'surgeon-preferences', name: 'Surgeon Preferences', maker: 'TechnoMed', group: 'Restricted', restricted: true }
  ],
  coming: [{ name: 'Dakota ACDF', maker: 'Precision Spine', group: 'Spine' }]
}

let calls

beforeEach(() => {
  calls = []
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers || {} })
    if (String(url).includes('guide=')) {
      return { ok: true, status: 200, text: async () => '<html><body>A guide</body></html>' }
    }
    return { ok: true, status: 200, json: async () => LIST }
  })
})

afterEach(() => vi.restoreAllMocks())

const show = (props = {}) =>
  render(<TheatreGuides user={{ token: 'tok' }} onBack={() => {}} {...props} />)

describe('the list', () => {
  it('groups the guides the way the team thinks of them', async () => {
    show()
    await waitFor(() => expect(screen.getByText('DIPLOMAT')).toBeInTheDocument())
    expect(screen.getByText('Spine')).toBeInTheDocument()
    expect(screen.getByText('Orthopaedics')).toBeInTheDocument()
  })

  it('shows the source revision each was built from', async () => {
    // How anyone tells whether a guide still matches the manufacturer's current
    // technique document.
    show()
    await waitFor(() => expect(screen.getByText(/Rev\. 2015-08/)).toBeInTheDocument())
  })

  it('marks the restricted one as restricted', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Restricted', { selector: 'span' })).toBeTruthy())
  })

  it('lists what is not built yet, so it does not read as missing', async () => {
    show()
    await waitFor(() => expect(screen.getByText('Being packaged')).toBeInTheDocument())
    expect(screen.getByText('Dakota ACDF')).toBeInTheDocument()
  })

  it('searches across name and manufacturer', async () => {
    show()
    await waitFor(() => expect(screen.getByText('DIPLOMAT')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Search the guides/), { target: { value: 'depuy' } })
    await waitFor(() => expect(screen.queryByText('DIPLOMAT')).not.toBeInTheDocument())
    expect(screen.getByText('VA LCP Clavicle Plate 2.7')).toBeInTheDocument()
  })

  it('says so when the list cannot be loaded', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 500, json: async () => ({ error: 'Could not load the guides' })
    }))
    show()
    await waitFor(() => expect(screen.getByText(/Could not load the guides/)).toBeInTheDocument())
  })
})

describe('opening one', () => {
  it('sends the session with every request, restricted or not', async () => {
    // The whole reason these are not static files. An iframe cannot send a
    // header, which is why the page is fetched and inlined rather than linked.
    show()
    await waitFor(() => expect(screen.getByText('Surgeon Preferences')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Surgeon Preferences'))
    await waitFor(() => expect(calls.some(c => c.url.includes('guide=surgeon-preferences'))).toBe(true))
    for (const call of calls) {
      expect(call.headers.Authorization, call.url).toBe('Bearer tok')
    }
  })

  it('renders the guide inside a sandboxed frame', async () => {
    // The guides need scripts — sections and tables expand — and nothing else.
    // No forms, no popups, and no reach back into the portal that framed them.
    show()
    await waitFor(() => expect(screen.getByText('DIPLOMAT')).toBeInTheDocument())
    fireEvent.click(screen.getByText('DIPLOMAT'))
    // The viewer portals to document.body, so the render container cannot see
    // it — the same portal that keeps it clear of the iOS scroll container.
    const frame = await waitFor(() => {
      const found = document.body.querySelector('iframe')
      expect(found).toBeTruthy()
      return found
    })
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain('A guide')
  })

  it('offers a way back to the list', async () => {
    show()
    await waitFor(() => expect(screen.getByText('DIPLOMAT')).toBeInTheDocument())
    fireEvent.click(screen.getByText('DIPLOMAT'))
    await waitFor(() => expect(screen.getByRole('button', { name: /All guides/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /All guides/ }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /All guides/ })).not.toBeInTheDocument())
  })
})
