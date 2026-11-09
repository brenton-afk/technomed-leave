import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CaseFiles from './CaseFiles.jsx'

// Brent, 9 Nov 2026: "You should be able to tap the usage from past scanned
// usages and see your scanned files." Invented case.
const usage = {
  id: 'u1', dropboxPath: '/ALL SURGEON USAGE/SPINE/Thani/November 2026/Sample_09112026_Thani_ALIF_CLV',
  filesSaved: ['Sample_09112026_Thani_ALIF_CLV_Usage_Scan.pdf', 'Sample_09112026_Thani_ALIF_CLV_Usage_Sheet.xlsx']
}

afterEach(() => vi.restoreAllMocks())

describe('a past usage\'s files', () => {
  it('lists what the portal filed, and shows the scan in the portal', async () => {
    global.URL.createObjectURL = vi.fn(() => 'blob:scan')
    global.URL.revokeObjectURL = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
      if (String(url).startsWith('/api/usage/agent?action=open')) return { ok: true, json: async () => ({ url: 'https://dl.example/scan' }) }
      return { blob: async () => new Blob(['%PDF']) }
    })
    render(<CaseFiles usage={usage} user={{ token: 't' }} />)
    expect(screen.getByText('Scanned form')).toBeInTheDocument()
    expect(screen.getByText('Usage sheet')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Scanned form'))
    await waitFor(() => expect(document.querySelector('[data-file-viewer]')).toBeTruthy())
    expect(decodeURIComponent(fetchMock.mock.calls[0][0])).toContain(`${usage.dropboxPath}/Sample_09112026_Thani_ALIF_CLV_Usage_Scan.pdf`)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer t')
  })

  it('says so when nothing was filed', () => {
    render(<CaseFiles usage={{ id: 'u2', filesSaved: [] }} user={{ token: 't' }} />)
    expect(screen.getByText(/No files were filed/)).toBeInTheDocument()
  })
})
