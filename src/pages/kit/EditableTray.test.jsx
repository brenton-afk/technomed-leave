import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import EditableTray from './EditableTray.jsx'

// Brent, 21 Nov 2026: "so you can read each item's full description, just make
// it a bit more compact". Invented items.
describe('editing a tray', () => {
  it('shows the whole description in a box that wraps, with code, kind, quantity and remove on one line', () => {
    const long = '7mm (8 degrees) x 24mm length widget cage, sterile packed, lordotic'
    render(<EditableTray tray={{ name: 'Widget Implants', lines: [{ code: 'WX0007', description: long, qty: 2, kind: 'implant' }] }}
      onEdit={vi.fn(async () => ({}))} onDone={() => {}} />)
    const desc = screen.getByLabelText('Description, line 1')
    expect(desc.tagName).toBe('TEXTAREA')
    expect(desc.value).toBe(long)
    const row = desc.closest('[data-edit-line]')
    const line = screen.getByLabelText('Code, line 1').parentElement
    expect(row.contains(line)).toBe(true)
    for (const label of [`One fewer ${long}`, `One more ${long}`, `Remove ${long}`, `Quantity of ${long}`]) {
      expect(line.contains(screen.getByLabelText(label))).toBe(true)
    }
  })
})
