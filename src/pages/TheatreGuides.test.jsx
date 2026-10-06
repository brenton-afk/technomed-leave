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

describe('grouped by who we order from', () => {
  // "Organise the theatre guides into distributors." The old grouping put
  // eight of the nine spine guides in one undifferentiated list. Nobody looks
  // for "a spine guide" — they look for the Signus tray, or whatever KT
  // Medical sent for Thursday.
  const TAGGED = {
    guides: [
      { slug: 'diplomat', distributor: 'signus', name: 'DIPLOMAT', maker: 'SIGNUS', group: 'Spine' },
      { slug: 'athlet-ascot', distributor: 'signus', name: 'ATHLET + ASCOT', maker: 'SIGNUS', group: 'Spine' },
      { slug: 'mariner', distributor: 'device', name: 'MARINER MIS', maker: 'SeaSpine', group: 'Spine' },
      { slug: 'firebird-forza', distributor: 'kt', name: 'Firebird NXG + Forza XP', maker: 'Orthofix', group: 'Spine' },
      { slug: 'orphan', name: 'Something Untagged', maker: 'Somebody', group: 'Spine' },
      { slug: 'brainlab', name: 'Brainlab Navigation', maker: 'Brainlab', group: 'Navigation' }
    ],
    coming: []
  }

  const showTagged = () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => TAGGED }))
    return render(<TheatreGuides user={{ token: 'tok' }} onBack={() => {}} />)
  }

  it('heads each section with the distributor, not the manufacturer', async () => {
    showTagged()
    await waitFor(() => expect(screen.getByText('DIPLOMAT')).toBeInTheDocument())
    // SeaSpine makes Mariner; we buy it from Device Technologies. KT Medical
    // sells us Orthofix. The heading has to be who gets rung.
    expect(screen.getByText('Device Technologies')).toBeInTheDocument()
    expect(screen.getByText('KT Medical')).toBeInTheDocument()
    expect(screen.getByText('Signus')).toBeInTheDocument()
  })

  it('puts the two Signus systems together', async () => {
    const { container } = showTagged()
    await waitFor(() => expect(screen.getByText('DIPLOMAT')).toBeInTheDocument())
    const text = container.textContent
    expect(text.indexOf('Signus')).toBeLessThan(text.indexOf('DIPLOMAT'))
    expect(text.indexOf('DIPLOMAT')).toBeLessThan(text.indexOf('Device Technologies'))
    expect(text.indexOf('ATHLET + ASCOT')).toBeLessThan(text.indexOf('Device Technologies'))
  })

  it('never loses a guide that has no distributor on it', async () => {
    // The failure that actually happened while this was being written: the
    // fallback section was removed, and every untagged guide vanished from
    // the app rather than appearing in the wrong place.
    showTagged()
    await waitFor(() => expect(screen.getByText('Something Untagged')).toBeInTheDocument())
    expect(screen.getByText('Brainlab Navigation')).toBeInTheDocument()
  })

  it('finds a guide by its distributor', async () => {
    showTagged()
    await waitFor(() => expect(screen.getByText('MARINER MIS')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Search the guides'), { target: { value: 'device' } })
    expect(screen.getByText('MARINER MIS')).toBeInTheDocument()
    expect(screen.queryByText('DIPLOMAT')).not.toBeInTheDocument()
  })
})

describe('the proximal tibia guide', () => {
  const LISTED = {
    guides: [
      { slug: 'clavicle-2.7', name: 'VA LCP Clavicle Plate 2.7', maker: 'DePuy Synthes', group: 'Orthopaedics', revision: 'SE_825567 AF · 2025/07' },
      {
        slug: 'prox-tib-3.5', name: 'Proximal Tibia Plates 3.5', maker: 'DePuy Synthes',
        group: 'Orthopaedics', revision: 'SE_858604 AA (lateral) · J5954-A (medial)',
        keywords: 'Lateral VA-LCP and medial LCP plates in one app. '
          + 'Plate selector · Technique · Screw/drill/torque · Trays · RHH small frag'
      },
      { slug: 'diplomat', distributor: 'signus', name: 'DIPLOMAT', maker: 'SIGNUS', group: 'Spine' }
    ],
    coming: []
  }

  const showListed = () => {
    global.fetch = vi.fn(async url => (String(url).includes('guide=')
      ? { ok: true, status: 200, text: async () => '<html><body>Proximal tibia</body></html>' }
      : { ok: true, status: 200, json: async () => LISTED }))
    return render(<TheatreGuides user={{ token: 'tok' }} onBack={() => {}} />)
  }

  it('sits under Orthopaedics, beside the clavicle guide', async () => {
    const { container } = showListed()
    await waitFor(() => expect(screen.getByText('Proximal Tibia Plates 3.5')).toBeInTheDocument())
    const page = container.textContent
    expect(page.indexOf('Orthopaedics')).toBeLessThan(page.indexOf('Proximal Tibia Plates 3.5'))
    expect(page).toContain('VA LCP Clavicle Plate 2.7')
  })

  it('reads like every other card — the maker and the source revision', async () => {
    showListed()
    await waitFor(() => expect(screen.getByText('Proximal Tibia Plates 3.5')).toBeInTheDocument())
    expect(screen.getByText('DePuy Synthes · SE_858604 AA (lateral) · J5954-A (medial)'))
      .toBeInTheDocument()
  })

  it('is found by what is inside it, not only by its name', async () => {
    // The chips asked for have no slot on a card here — an existing card is a
    // name and a revision. They earn their keep in the search instead.
    showListed()
    await waitFor(() => expect(screen.getByText('Proximal Tibia Plates 3.5')).toBeInTheDocument())
    for (const term of ['torque', 'small frag', 'plate selector', 'medial LCP']) {
      fireEvent.change(screen.getByLabelText('Search the guides'), { target: { value: term } })
      expect(screen.queryByText('Proximal Tibia Plates 3.5'), term).toBeInTheDocument()
      expect(screen.queryByText('DIPLOMAT'), term).not.toBeInTheDocument()
    }
  })

  it('opens the guide itself', async () => {
    showListed()
    await waitFor(() => expect(screen.getByText('Proximal Tibia Plates 3.5')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Proximal Tibia Plates 3.5'))
    await waitFor(() =>
      expect(screen.getByTitle('Proximal Tibia Plates 3.5')).toBeInTheDocument())
    const asked = global.fetch.mock.calls.find(([u]) => String(u).includes('guide='))
    expect(String(asked[0])).toContain('guide=prox-tib-3.5')
  })
})
