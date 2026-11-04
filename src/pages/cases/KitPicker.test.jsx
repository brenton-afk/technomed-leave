import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import KitPicker from './KitPicker.jsx'

// "Why do we have Mariner and Mariner MIS? They are not two different things."
describe('choosing the Mariner set', () => {
  it('turns a plain Mariner into Mariner MIS, keeping where it is coming from', () => {
    const onChange = vi.fn()
    render(<KitPicker kit="Mariner (Distributor Loan)" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mariner MIS' }))
    expect(onChange).toHaveBeenCalledWith('Mariner MIS (Distributor Loan)')
  })

  it('adds a system that was not there, and takes off one that was', () => {
    const onChange = vi.fn()
    render(<KitPicker kit="Diplomat (Consignment)" onChange={onChange} />)
    // The booking has its system, so the rest are behind one tap.
    fireEvent.click(screen.getByRole('button', { name: 'Change or add a system' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mariner Open' }))
    expect(onChange).toHaveBeenLastCalledWith('Diplomat (Consignment) / Mariner Open')
    fireEvent.click(screen.getByRole('button', { name: 'Diplomat' }))
    expect(onChange).toHaveBeenLastCalledWith('')
  })
})

describe('a system written in the booking\'s own words (Toni, 4 Nov 2026)', () => {
  it('lights the Global BMD PLIF button for "E4 Global BMD PLIF cage"', () => {
    render(<KitPicker kit="Diplomat (Consignment) / (open screws) / E4 Global BMD PLIF cage (Consignment) / Spinal (Brainlab)" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Global BMD PLIF' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText(/Also written/)).toBeNull()
  })
  it('keeps Mariner MIS and Mariner Open as two buttons', () => {
    render(<KitPicker kit="Mariner MIS (Distributor Loan)" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Mariner MIS' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Mariner Open' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('fewer buttons (Brent, 4 Nov 2026: "still too many and it\'s too busy")', () => {
  it('shows only the systems that fit the operation, plus what is chosen', () => {
    render(<KitPicker kit="Lonestar" operation="T10-L2 posterior fixation" surgeon="Thani" hospital="RHH" onChange={() => {}} />)
    const names = screen.getAllByRole('button').map(b => b.textContent)
    expect(names).toEqual(expect.arrayContaining(['Diplomat', 'Mariner MIS', 'Mariner Open', 'Orthofix Firebird', 'Lonestar']))
    expect(names).not.toContain('CYLOX')
    expect(names).not.toContain('Dakota')
    fireEvent.click(screen.getByRole('button', { name: /All systems \(\d+ more\)/ }))
    expect(screen.getByRole('button', { name: 'CYLOX' })).toBeInTheDocument()
  })

  it('shows every system when nothing is chosen and the operation says nothing', () => {
    render(<KitPicker kit="" operation="Lumbar decompression" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'CYLOX' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Diplomat' })).toBeInTheDocument()
  })
})
