import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import DocViewer, { viewKind } from './DocViewer.jsx'

// Brent, 11 Nov 2026: "a viewer built in so you don't need to download the
// consignment agreement". Invented content.

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the document viewer', () => {
  it('knows what it can show', () => {
    expect(viewKind('Agreement.PDF')).toBe('pdf')
    expect(viewKind('Agreement.docx')).toBe('docx')
    expect(viewKind('photo.jpeg')).toBe('image')
    expect(viewKind('old.doc')).toBe('')
    expect(viewKind('list.xlsx')).toBe('')
  })

  it('says plainly when a file cannot be shown, and offers Download', async () => {
    render(<DocViewer name="Old agreement.doc" url="https://dl.example/x" onClose={() => {}} />)
    expect(await screen.findByText(/cannot be shown in the portal/)).toBeInTheDocument()
    expect(screen.getByText('Download')).toHaveAttribute('href', 'https://dl.example/x')
  })

  it('shows a text file inside the portal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Term: 12 months')))
    render(<DocViewer name="notes.txt" url="u" onClose={() => {}} onShare={() => {}} />)
    await waitFor(() => expect(screen.getByText('Term: 12 months')).toBeInTheDocument())
    expect(screen.getByText('Share')).toBeInTheDocument()
  })
})
