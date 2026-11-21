import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SayMove from './SayMove.jsx'

// Brent, 21 Nov 2026: "I want to move the Diplomat torque and reduction tray
// from RHH to Calvary." Typed here; the recording only fills the same box.
const kits = [
  { id: 'dip-rhh', name: 'Diplomat 2', system: 'Diplomat', home: 'RHH', at: 'RHH', trays: ['Diplomat Torque & Reduction', 'Diplomat Rods'] },
  { id: 'dip-clv', name: 'Diplomat 1', system: 'Diplomat', home: 'CLV', at: 'CLV', trays: ['Diplomat Rods'] }
]

describe('Say a move', () => {
  it('offers the tray with its places, and Move it opens the move for that tray and place', () => {
    const onMove = vi.fn()
    render(<SayMove kits={kits} user={{ token: 't' }} onClose={() => {}} onMove={onMove} />)
    fireEvent.change(screen.getByLabelText('The move, in words'), { target: { value: 'I want to move the Diplomat torque and reduction tray from RHH to Calvary' } })
    const first = document.querySelector('[data-say-choice]')
    expect(first).toHaveTextContent('Diplomat Torque & Reduction')
    expect(first).toHaveTextContent('now at RHH → Calvary')
    expect(document.querySelector('[data-say-to="CLV"]').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(first.querySelector('[data-say-go]'))
    expect(onMove).toHaveBeenCalledWith(kits[0], ['Diplomat Torque & Reduction'], 'CLV')
  })
  it('says so when nothing matches', () => {
    render(<SayMove kits={kits} user={{ token: 't' }} onClose={() => {}} onMove={() => {}} />)
    fireEvent.change(screen.getByLabelText('The move, in words'), { target: { value: 'the blue thing' } })
    expect(screen.getByText(/No tray or kit matches/)).toBeTruthy()
  })
})
