import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ScanTab from './ScanTab.jsx'

// jsdom draws no PDFs: an uploaded PDF stands in as one picture of a page.
vi.mock('../scanner/redact.js', async orig => ({
  ...(await orig()),
  pdfToPages: async file => [{ id: `pdf-${file.name}`, mediaType: 'image/jpeg', data: 'JVBERi0xLjQgaW52ZW50ZWQ=', full: null, preview: null, name: file.name }]
}))

// Invented case and products — no real patient is named in a test.
const CASE = { id: 'u1', folderName: 'Testa_02112026_Ibbett_Fixation_RHH', patientSurname: 'Testa', surgeonSurname: 'Ibbett', hospital: 'RHH', date: '2026-11-02', filed: true }
const COMPARISON = {
  rows: [
    { key: 'RF4535', referenceCode: 'RF-4535', product: 'Reform polyaxial screw', used: 4, before: 0, now: 3, owing: 1 },
    { key: 'RFROD', referenceCode: 'RF-ROD-120', product: 'Reform rod', used: 2, before: 0, now: 2, owing: 0 }
  ],
  extras: [],
  totals: { used: 6, before: 0, now: 5, owing: 1 }
}
const RESUPPLY = {
  distributorKey: 'e4', distributor: 'E4 Surgical', documentNumber: 'DN-1001', documentDate: '2026-11-05',
  lines: [{ id: 'line-0', referenceCode: 'RF-4535', description: 'Reform polyaxial screw', quantity: 3 },
    { id: 'line-1', referenceCode: 'RF-ROD-120', description: 'Reform rod', quantity: 2 }]
}

let calls
beforeEach(() => {
  calls = []
  localStorage.clear()
  sessionStorage.clear()
  // The tab opens on Usage; a link may ask for Resupply for the next opening.
  sessionStorage.setItem('tm_scan_kind', 'resupply')
  global.fetch = vi.fn(async (url, init) => {
    const action = new URL(url, 'http://x').searchParams.get('action')
    calls.push({ action, body: init?.body ? JSON.parse(init.body) : null })
    const body = {
      'resupply-read': { resupply: RESUPPLY, candidates: [{ ...CASE, why: ['surname'] }], matchedId: 'u1', comparison: COMPARISON },
      'resupply-save': { entry: { id: 'x', distributor: 'E4 Surgical', filed: 'Testa partial E4 resupply 1.pdf' }, comparison: COMPARISON, case: CASE }
    }[action] || { records: [] }
    return { ok: true, json: async () => body }
  })
})
afterEach(() => vi.restoreAllMocks())

const pdf = () => new File(['%PDF-1.4 invented'], 'docket.pdf', { type: 'application/pdf' })

describe('the resupply scanner', () => {
  // Brent, 10 Nov 2026: matching to usage only; what is owed is followed in
  // the existing process, so there is no Still owed list.
  it('opens on the scan card, with no owed list', async () => {
    render(<ScanTab user={{ token: 't', name: 'Test Person' }} />)
    expect(screen.getByRole('tab', { name: 'Resupply' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText(/still owed/i)).not.toBeInTheDocument()
    expect(calls.some(c => c.action === 'resupply-owing')).toBe(false)
  })

  it('reads a docket and matches it to the usage, line by line', async () => {
    const { container } = render(<ScanTab user={{ token: 't' }} />)
    const input = container.querySelector('input[type=file]')
    fireEvent.change(input, { target: { files: [pdf()] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Read 1 page' }))
    await waitFor(() => expect(screen.getByText('Matched to the usage')).toBeInTheDocument())
    expect(screen.getByText('2 of 2 usage lines on this paper')).toBeInTheDocument()
    expect(screen.queryByText(/owed/)).not.toBeInTheDocument()
    expect(screen.getAllByText('Reform polyaxial screw').length).toBeGreaterThan(0)
    expect(screen.getByRole('radio', { checked: true })).toBeInTheDocument()
  })

  // Toni, 20 Nov 2026: a Boost resupply filed as "partial Device resupply".
  // The portal names it, from the paper and the usage; nobody types a name.
  it('shows the name it will be filed under, and the supplier it settled on', async () => {
    global.fetch = vi.fn(async (url) => {
      const action = new URL(url, 'http://x').searchParams.get('action')
      const body = {
        'resupply-read': {
          resupply: { ...RESUPPLY, distributorKey: 'device', distributor: 'Device Technologies' },
          candidates: [{ ...CASE, why: ['surname'] }], matchedId: 'u1', comparison: COMPARISON,
          naming: { distributorKey: 'device_boost', stage: 'complete', n: 1, fileName: 'Testa Boost resupply.pdf',
            why: ['Boost allograft — filed as Boost, apart from Device implants', 'everything used is back'] }
        }
      }[action] || { records: [] }
      return { ok: true, json: async () => body }
    })
    const { container } = render(<ScanTab user={{ token: 't' }} />)
    fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [pdf()] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Read 1 page' }))
    const name = await waitFor(() => { const el = container.querySelector('[data-resupply-name]'); expect(el).toBeTruthy(); return el })
    expect(name.textContent).toContain('Testa Boost resupply.pdf')
    expect(name.querySelector('input')).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Distributor' })).toHaveValue('device_boost')
  })

  // Toni, 20 Nov 2026: a photo of the usage page, no E4 implant on it, filed as E4's resupply.
  it('says so when nothing on the paper matches the usage', async () => {
    const none = { ...COMPARISON, rows: COMPARISON.rows.map(r => ({ ...r, now: 0, owing: r.used })), totals: { ...COMPARISON.totals, now: 0 } }
    global.fetch = vi.fn(async (url) => {
      const action = new URL(url, 'http://x').searchParams.get('action')
      const body = { 'resupply-read': { resupply: RESUPPLY, candidates: [{ ...CASE, why: ['surname'] }], matchedId: 'u1', comparison: none } }[action] || { records: [] }
      return { ok: true, json: async () => body }
    })
    const { container } = render(<ScanTab user={{ token: 't' }} />)
    fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [pdf()] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Read 1 page' }))
    expect(await screen.findByText(/Nothing on this paper matches this supplier's items/)).toBeInTheDocument()
  })

  it('records it once, against the chosen case, with the pages for filing', async () => {
    const { container } = render(<ScanTab user={{ token: 't' }} />)
    fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [pdf()] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Read 1 page' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Record and file in the case folder' }))
    await waitFor(() => expect(screen.getByText(/Filed in the case folder as/)).toBeInTheDocument())
    const save = calls.find(c => c.action === 'resupply-save')
    expect(save.body).toMatchObject({ usageId: 'u1' })
    expect(save.body.id).toMatch(/^rs-/)
    expect(save.body.pages).toHaveLength(1)
  })

  // Brent, 19 Nov 2026: "the resupply scanner must use the list also".
  it('checks the paper’s codes against the price list, and a near code is one tap', async () => {
    const checked = {
      ...RESUPPLY,
      lines: [
        { ...RESUPPLY.lines[0], priceCheck: { status: 'listed', code: 'RF-4535', range: 'Reform', rebate: 'EY001' } },
        { ...RESUPPLY.lines[1], priceCheck: { status: 'not-listed', code: 'RF-ROD-120', distributor: 'E4 Surgical', near: 'RF-ROD-12O' } }
      ]
    }
    global.fetch = vi.fn(async (url, init) => {
      const action = new URL(url, 'http://x').searchParams.get('action')
      const body = init?.body ? JSON.parse(init.body) : null
      calls.push({ action, body })
      if (action === 'resupply-read') return { ok: true, json: async () => ({ resupply: checked, candidates: [{ ...CASE, why: ['surname'] }], matchedId: 'u1', comparison: COMPARISON }) }
      if (action === 'resupply-compare') return { ok: true, json: async () => ({ comparison: COMPARISON, resupply: { ...body.resupply, lines: body.resupply.lines.map(l => ({ ...l, priceCheck: { status: 'listed', code: l.referenceCode } })) } }) }
      return { ok: true, json: async () => ({}) }
    })
    const { container } = render(<ScanTab user={{ token: 't' }} />)
    fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [pdf()] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Read 1 page' }))
    await screen.findByText('Codes on the price list')
    expect(screen.getByText(/1 of 2 codes on E4 Surgical's list/)).toBeInTheDocument()
    expect(screen.getByText(/Not on E4 Surgical's price list/)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\$/)
    fireEvent.click(screen.getByRole('button', { name: 'Use RF-ROD-12O' }))
    await waitFor(() => expect(screen.getByText(/2 of 2 codes/)).toBeInTheDocument())
    const compare = calls.find(c => c.action === 'resupply-compare')
    expect(compare.body.resupply.lines[1].referenceCode).toBe('RF-ROD-12O')
  })

  it('switches back to usage scanning', async () => {
    render(<ScanTab user={{ token: 't' }} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Usage' }))
    expect(screen.getByRole('tab', { name: 'Usage' })).toHaveAttribute('aria-selected', 'true')
  })

  it('always opens on Usage, whatever was scanned last (Brent, 18 Nov 2026)', () => {
    sessionStorage.clear()
    localStorage.setItem('tm_scan_kind', 'resupply') // what older builds remembered
    render(<ScanTab user={{ token: 't' }} />)
    expect(screen.getByRole('tab', { name: 'Usage' })).toHaveAttribute('aria-selected', 'true')
    expect(localStorage.getItem('tm_scan_kind')).toBeNull()
  })

  it('a usage form read here asks, and "Read it as a usage" reads the same pages there', async () => {
    const usageCase = { id: 'c1', patientSurname: 'Testa', surgeonSurname: 'Thani', hospital: 'CLV', date: '2026-11-05', items: [] }
    global.fetch = vi.fn(async (url, init) => {
      const action = new URL(url, 'http://x').searchParams.get('action')
      calls.push({ action, body: init?.body ? JSON.parse(init.body) : null })
      const body = {
        'resupply-read': { resupply: { ...RESUPPLY, documentKind: 'usage' }, candidates: [], matchedId: null },
        scan: { case: usageCase, documentKind: 'usage' }
      }[action] || { records: [] }
      return { ok: true, json: async () => body }
    })
    const { container } = render(<ScanTab user={{ token: 't' }} />)
    fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [pdf()] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Read 1 page' }))
    expect(await screen.findByText(/This looks like a usage form, not a resupply/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record and file in the case folder' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Read it as a usage' }))
    await waitFor(() => expect(calls.some(c => c.action === 'scan')).toBe(true))
    const scan = calls.find(c => c.action === 'scan')
    const read = calls.find(c => c.action === 'resupply-read')
    expect(scan.body.pages).toEqual(read.body.pages)
  })

  it('"It is a resupply — carry on" goes to the review', async () => {
    global.fetch = vi.fn(async (url, init) => {
      const action = new URL(url, 'http://x').searchParams.get('action')
      calls.push({ action })
      const body = { 'resupply-read': { resupply: { ...RESUPPLY, documentKind: 'usage' }, candidates: [{ ...CASE, why: ['surname'] }], matchedId: 'u1', comparison: COMPARISON } }[action] || { records: [] }
      return { ok: true, json: async () => body }
    })
    const { container } = render(<ScanTab user={{ token: 't' }} />)
    fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [pdf()] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Read 1 page' }))
    fireEvent.click(await screen.findByRole('button', { name: 'It is a resupply — carry on' }))
    expect(await screen.findByRole('button', { name: 'Record and file in the case folder' })).toBeInTheDocument()
  })

  it('a docket read in the Usage scanner asks, and "Read it as a resupply" reads it there', async () => {
    sessionStorage.clear()
    global.fetch = vi.fn(async (url, init) => {
      const action = new URL(url, 'http://x').searchParams.get('action')
      calls.push({ action, body: init?.body ? JSON.parse(init.body) : null })
      const body = {
        scan: { case: { id: 'c1', patientSurname: 'Testa', items: [] }, documentKind: 'resupply' },
        'resupply-read': { resupply: RESUPPLY, candidates: [{ ...CASE, why: ['surname'] }], matchedId: 'u1', comparison: COMPARISON }
      }[action] || { records: [] }
      return { ok: true, json: async () => body }
    })
    const { container } = render(<ScanTab user={{ token: 't' }} />)
    fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [pdf()] } })
    const read = await screen.findByRole('button', { name: /^Read 1 page/ })
    fireEvent.click(read)
    expect(await screen.findByText(/This looks like a resupply docket, not a usage form/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Read it as a resupply' }))
    expect(await screen.findByRole('button', { name: 'Record and file in the case folder' })).toBeInTheDocument()
    expect(calls.find(c => c.action === 'resupply-read').body.pages).toEqual(calls.find(c => c.action === 'scan').body.pages)
  })
})
