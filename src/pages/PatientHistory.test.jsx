import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PatientHistory from './PatientHistory.jsx'

// ─── What this patient has had from us ───────────────────────────────────────
// Dropbox stays the store of record. The app's job is the question the folder
// tree cannot answer: the tree is filed by surgeon and then by month, so a
// patient who saw Thani in 2024 and Garg in 2026 is in two places years apart.

const USER = { name: 'Brenton Lovering', email: 'brenton@technomed.com.au', token: 'tok' }

const CASES = [
  {
    recognised: true, raw: 'Hollis_04102026_Garg_L4-5-PLIF_RHH',
    name: 'Hollis_04102026_Garg_L4-5-PLIF_RHH',
    path: '/all surgeon usage/spine/garg/october 2026/hollis_04102026_garg_l4-5-plif_rhh',
    patientSurname: 'Hollis', date: '2026-10-04', surgeonSurname: 'Garg',
    procedure: 'L4-5-PLIF', hospital: 'RHH', reviewed: null,
    files: [
      { kind: 'file', name: 'Hollis_04102026_Garg_L4-5-PLIF_RHH_Scan.pdf', path: '/a/scan.pdf' },
      { kind: 'file', name: 'Hollis_04102026_Garg_L4-5-PLIF_RHH_Usage_Sheet.xlsx', path: '/a/u.xlsx' }
    ]
  },
  {
    recognised: true, raw: 'Hollis_11032024_Thani_ACDF_Calvary',
    name: 'Hollis_11032024_Thani_ACDF_Calvary',
    path: '/all surgeon usage/spine/thani/march 2024/hollis_11032024_thani_acdf_calvary',
    patientSurname: 'Hollis', date: '2024-03-11', surgeonSurname: 'Thani',
    procedure: 'ACDF', hospital: 'Calvary',
    reviewed: { by: 'toni@technomed.com.au', at: '2024-03-12T00:00:00.000Z' },
    files: [{ kind: 'file', name: 'Hollis_11032024_Thani_ACDF_Calvary_Scan.pdf', path: '/b/scan.pdf' }]
  }
]

const answer = body => ({ ok: true, json: async () => body })

beforeEach(() => {
  window.matchMedia = q => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}
  })
  global.fetch = vi.fn(async url => {
    if (String(url).includes('action=history')) {
      return answer({ configured: true, cases: CASES })
    }
    if (String(url).includes('action=open')) return answer({ url: 'https://dl/x.pdf' })
    return answer({ ok: true, reviewed: { by: USER.email, at: '2026-10-04T00:00:00.000Z' } })
  })
  window.open = vi.fn()
})
afterEach(() => vi.restoreAllMocks())

const searchFor = async surname => {
  render(<PatientHistory user={USER} />)
  fireEvent.change(screen.getByLabelText('Patient surname'), { target: { value: surname } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() => expect(screen.getByText(/cases? filed under/)).toBeInTheDocument())
}

describe('looking a patient up', () => {
  it('shows every case across surgeons and years', async () => {
    // The whole point. Two cases, two surgeons, two years, one screen — the
    // folder tree has these in places that never appear together.
    await searchFor('Hollis')
    expect(screen.getByText('L4-5-PLIF')).toBeInTheDocument()
    expect(screen.getByText('ACDF')).toBeInTheDocument()
    expect(screen.getByText(/4 Oct 2026 · Garg · RHH/)).toBeInTheDocument()
    expect(screen.getByText(/11 Mar 2024 · Thani · Calvary/)).toBeInTheDocument()
  })

  it('asks the server for the surname and nothing else', async () => {
    await searchFor('Hollis')
    const [url] = global.fetch.mock.calls.find(([u]) => String(u).includes('history'))
    expect(String(url)).toContain('surname=Hollis')
  })

  it('refuses a single letter rather than returning half the practice', async () => {
    render(<PatientHistory user={USER} />)
    fireEvent.change(screen.getByLabelText('Patient surname'), { target: { value: 'B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(screen.getByText(/at least two letters/)).toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('names the file by what it is, not by repeating the case', async () => {
    // Every file in the folder starts with the whole case name. In a row of
    // chips that is the same forty characters twice and no information.
    await searchFor('Hollis')
    // Both cases have a scan, which is exactly why the chip must not repeat
    // the case name — it is the suffix that distinguishes the documents.
    expect(screen.getAllByText('Scan.pdf')).toHaveLength(2)
    expect(screen.getByText('Usage_Sheet.xlsx')).toBeInTheDocument()
  })

  it('opens a file through a fresh link rather than storing one', async () => {
    await searchFor('Hollis')
    fireEvent.click(screen.getByText('Usage_Sheet.xlsx'))
    await waitFor(() => expect(window.open).toHaveBeenCalledWith(
      'https://dl/x.pdf', '_blank', 'noopener'))
  })

  it('says who has already checked a case', async () => {
    await searchFor('Hollis')
    expect(screen.getByText('✓ Checked by Toni')).toBeInTheDocument()
  })

  it('ticks a case off against whoever is signed in', async () => {
    await searchFor('Hollis')
    fireEvent.click(screen.getAllByText('Mark checked')[0])
    await waitFor(() => {
      const call = global.fetch.mock.calls.find(([u]) => String(u).includes('reviewed'))
      expect(call).toBeTruthy()
      expect(JSON.parse(call[1].body)).toMatchObject({ reviewed: true })
    })
    expect(await screen.findByText('✓ Checked by Brenton')).toBeInTheDocument()
  })

  it('puts the tick back if it did not save', async () => {
    // An optimistic tick that silently fails is worse than no tick: the next
    // person reads it as "somebody has been through this" and nobody has.
    global.fetch = vi.fn(async url => {
      if (String(url).includes('action=history')) {
        return answer({ configured: true, cases: CASES })
      }
      return answer({ error: 'Redis is down' })
    })
    await searchFor('Hollis')
    fireEvent.click(screen.getAllByText('Mark checked')[0])
    await waitFor(() => expect(screen.getByText(/did not save/)).toBeInTheDocument())
    expect(screen.getAllByText('Mark checked').length).toBe(1)
  })

  it('still lists a case it cannot parse', async () => {
    // Years of folders predate the app. One the parser does not understand is
    // still part of a clinical history and must not be quietly dropped.
    global.fetch = vi.fn(async () => answer({
      configured: true,
      cases: [{
        recognised: false, raw: 'Hollis old notes', name: 'Hollis old notes',
        path: '/x', patientSurname: '', date: '', surgeonSurname: '',
        procedure: '', hospital: '', reviewed: null, files: []
      }]
    }))
    await searchFor('Hollis')
    expect(screen.getByText('Hollis old notes')).toBeInTheDocument()
    expect(screen.getByText(/Filed before the app/)).toBeInTheDocument()
  })

  it('says plainly when there is nothing, without blaming the search', async () => {
    global.fetch = vi.fn(async () => answer({ configured: true, cases: [] }))
    render(<PatientHistory user={USER} />)
    fireEvent.change(screen.getByLabelText('Patient surname'), { target: { value: 'Nobody' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText(/Nothing filed under "Nobody"/)).toBeInTheDocument()
  })

  it('does not put the surname in an error message', async () => {
    // Error strings travel further than screens do.
    global.fetch = vi.fn(async () => answer({ error: 'Dropbox said no' }))
    render(<PatientHistory user={USER} />)
    fireEvent.change(screen.getByLabelText('Patient surname'), { target: { value: 'Hollis' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    const banner = await screen.findByText(/did not work/)
    expect(banner.textContent).not.toContain('Hollis')
  })
})
