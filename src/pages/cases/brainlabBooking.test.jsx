import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import BrainlabBilling from './BrainlabBilling.jsx'
import KitPicker from './KitPicker.jsx'

describe('a Varioguide biopsy at Calvary (Brent, 22 Nov 2026)', () => {
  const fields = { hospital: 'CLV', procedure: 'Brainlab Stereotactic Needle Biopsy', kit: 'Varioguide 2.0 (Consignment)' }

  it('shows Navigation suggested and what it waits on — never an amount (Brent, 22 Nov 2026)', () => {
    const { container } = render(<BrainlabBilling fields={fields} notes="" reps={[]} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Navigation' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector('[data-brainlab-status]').textContent).toMatch(/once a rep is marked as attended · suggested: varioguide biopsy at calvary/)
    expect(container.textContent).not.toMatch(/\$/)
  })

  it('a tap writes the line; tapping it again hands back to the rules', () => {
    const onChange = vi.fn()
    const { rerender } = render(<BrainlabBilling fields={fields} notes="" reps={['Brent']} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Not billed' }))
    expect(onChange).toHaveBeenLastCalledWith('Not billed')
    rerender(<BrainlabBilling fields={{ ...fields, brainlab: 'Not billed' }} notes="" reps={['Brent']} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Not billed' }))
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('says nothing on a Calvary PLIF', () => {
    const { container } = render(<BrainlabBilling fields={{ hospital: 'CLV', procedure: 'L4/5 PLIF', kit: 'Diplomat' }} notes="" reps={[]} onChange={() => {}} />)
    expect(container.querySelector('[data-brainlab-billing]')).toBeNull()
  })

  it('No F2F at RHH is tracked, not billed', () => {
    render(<BrainlabBilling fields={{ hospital: 'RHH', procedure: 'Stereotactic biopsy' }} notes="No F2F required" reps={[]} onChange={() => {}} />)
    expect(document.querySelector('[data-brainlab-status]').textContent).toMatch(/No F2F — tracked, not billed/)
  })

  it('does not offer implant systems for the biopsy until asked', () => {
    render(<KitPicker kit="Varioguide 2.0 (Consignment)" operation={fields.procedure} hospital="CLV" onChange={() => {}} />)
    expect(document.querySelector('[data-no-implant]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Diplomat' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '+ Add a system' }))
    expect(screen.getByRole('button', { name: 'Diplomat' })).toBeTruthy()
  })
})
