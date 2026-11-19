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

// Brent, 19 Nov 2026: "I can only move the page around … make it a seamless
// viewer like on Dropbox or Google Drive … download and print … at the press
// of a button". Checked in an iPhone-sized render: a Word document with a wide
// table and picture fits the width (no sideways scroll), a PDF counts its
// pages, zoom widens it, and Print gives the document alone, every page.
import { pageAt, clampZoom, cleanWordHtml, printAlone } from './DocViewer.jsx'

describe('the viewer, Drive-style', () => {
  it('has Share, Download and Print in one bar, and Dropbox when it knows the path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Term: 12 months')))
    render(<DocViewer name="notes.txt" url="u" path="/Kit Room/Test/notes.txt" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Term: 12 months')).toBeInTheDocument())
    for (const label of ['Share', 'Download', 'Print', 'Dropbox']) expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByLabelText('Zoom in')).toBeInTheDocument()
    // The download is the copy already on the phone, not a second fetch.
    expect(screen.getByText('Download').closest('a').getAttribute('href')).toMatch(/^blob:/)
  })

  it('counts the page on screen', () => {
    expect(pageAt([0, 500, 1000], 0, 600)).toBe(1)
    expect(pageAt([0, 500, 1000], 400, 600)).toBe(2)
    expect(pageAt([0, 500, 1000], 900, 600)).toBe(3)
  })

  it('zooms from fit to four times, never smaller than the screen', () => {
    expect(clampZoom(0.5)).toBe(1)
    expect(clampZoom(2.2)).toBe(2.2)
    expect(clampZoom(9)).toBe(4)
    expect(clampZoom(NaN)).toBe(1)
  })

  it('keeps a Word document\'s formatting and drops anything that could act', () => {
    const out = cleanWordHtml('<p onclick="x()">Hi <a href="javascript:alert(1)">link</a></p><script>bad()</script>'
      + '<img src="data:image/png;base64,AAAA" onerror="x()"><img src="https://evil.example/t.png"><table><tr><td colspan="2" style="x">A</td></tr></table>')
    expect(out).not.toMatch(/onclick|onerror|javascript|script|evil|style=/)
    expect(out).toContain('<a>link</a>')
    expect(out).toContain('src="data:image/png;base64,AAAA"')
    expect(out).toContain('colspan="2"')
  })

  it('prints the document alone, then tidies up', () => {
    const node = document.createElement('p')
    node.textContent = 'Clause 1'
    let during = null
    const win = { document, addEventListener: (e, f) => { win.after = f }, removeEventListener: () => {},
      print: () => { during = { cls: document.documentElement.classList.contains('tm-printing'), text: document.getElementById('tm-print-root')?.textContent } } }
    vi.useFakeTimers()
    printAlone(node, win)
    expect(during.cls).toBe(true)
    expect(during.text).toContain('Clause 1')
    win.after()
    expect(document.getElementById('tm-print-root')).toBeNull()
    expect(document.documentElement.classList.contains('tm-printing')).toBe(false)
    vi.useRealTimers()
  })
})
