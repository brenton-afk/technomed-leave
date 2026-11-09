import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { Attachment, viewUrl, downloadUrl } from '../pages/Chat.jsx'
import { previewable } from './fileTypes.js'

// Brent, 9 Nov 2026: "it would be great if clicking on the image enlarges the
// image, rather than instantly downloading it … You need to be able to preview them."
const KEPT = '/api/chat?action=file&f=2026-11%2F12345678-1234-1234-1234-123456789abc-beach.jpg'

describe('previewing an attachment', () => {
  it('a photo opens full screen in the portal, with Download as its own button, and closes', () => {
    render(<Attachment file={{ url: KEPT, type: 'image/jpeg', name: 'beach.jpg' }} />)
    expect(document.querySelector('a[href*="action=file"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /View beach.jpg/ }))
    const viewer = document.querySelector('[data-file-viewer]')
    expect(viewer).not.toBeNull()
    expect(viewer.querySelector('img').getAttribute('src')).toBe(`${KEPT}&view=1`)
    expect(viewer.querySelector('[data-zoomable]')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Download' }).getAttribute('href')).toBe(KEPT)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(document.querySelector('[data-file-viewer]')).toBeNull()
  })

  it('a PDF opens in the viewer; a Word file still downloads', () => {
    render(<Attachment file={{ url: KEPT.replace('beach.jpg', 'form.pdf'), type: 'application/pdf', name: 'form.pdf' }} />)
    fireEvent.click(screen.getByText('form.pdf'))
    expect(document.querySelector('[data-file-viewer] iframe').getAttribute('src')).toMatch(/form\.pdf&view=1$/)
    render(<Attachment file={{ url: 'https://a.public.blob.vercel-storage.com/chat/notes.docx', type: 'application/msword', name: 'notes.docx' }} />)
    expect(screen.getByText('notes.docx').closest('a').getAttribute('href')).toMatch(/download=1$/)
  })

  it('only safe kinds are ever shown inline', () => {
    expect(previewable('image/png')).toBe(true)
    expect(previewable('application/pdf')).toBe(true)
    expect(previewable('image/svg+xml')).toBe(false)
    expect(previewable('text/html')).toBe(false)
    expect(viewUrl({ url: 'https://a.public.blob.vercel-storage.com/x.jpg' })).toBe('https://a.public.blob.vercel-storage.com/x.jpg')
    expect(downloadUrl({ url: KEPT })).toBe(KEPT)
  })
})
