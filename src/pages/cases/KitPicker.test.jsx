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
    fireEvent.click(screen.getByRole('button', { name: 'Mariner Open' }))
    expect(onChange).toHaveBeenLastCalledWith('Diplomat (Consignment) / Mariner Open')
    fireEvent.click(screen.getByRole('button', { name: 'Diplomat' }))
    expect(onChange).toHaveBeenLastCalledWith('')
  })
})
