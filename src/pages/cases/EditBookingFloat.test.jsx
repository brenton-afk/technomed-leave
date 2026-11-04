import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import EditBooking from './EditBooking.jsx'

// Toni, 4 Nov 2026: on a laptop, Edit booking can be dragged aside to see the
// other cases that day. A floating panel over an undimmed page; a phone keeps
// the bottom sheet.
function width(px) {
  window.matchMedia = q => ({ matches: px >= 1024, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
}

describe('Edit booking on a laptop', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('floats, leaves the page undimmed, and drags by its title bar', () => {
    width(1400)
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) })
    render(<EditBooking eventId="e1" user={{ token: 't' }} onClose={() => {}} />)
    const panel = screen.getByRole('dialog', { name: 'Edit booking' })
    expect(panel.style.position).toBe('fixed')
    expect(panel.parentElement.style.pointerEvents).toBe('none')
    expect(panel.parentElement.style.background).toBe('')
    expect(panel.querySelector('[title="Drag to move"]')).toBeTruthy()
  })

  it('stays a dimmed bottom sheet on a phone', () => {
    width(390)
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) })
    render(<EditBooking eventId="e1" user={{ token: 't' }} onClose={() => {}} />)
    const panel = screen.getByRole('dialog', { name: 'Edit booking' })
    expect(panel.className).toBe('tm-sheet')
    expect(panel.querySelector('[title="Drag to move"]')).toBeNull()
  })
})
