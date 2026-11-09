import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RegistrarText from './RegistrarText.jsx'

// Invented case. Brent, 4 Nov 2026: levels from the booking, sizes typed in,
// no codes in the text.
describe('registrar text form', () => {
  const caseRecord = {
    id: 'x', patientSurname: 'Sample', surgeonSurname: 'Fowler',
    items: [{ productName: 'Straight Ti rod', size: '150mm', referenceCode: 'R-150', lotNumber: 'LOT9' }]
  }
  it('lists the booking\'s levels and builds the text as it is filled in', () => {
    render(<RegistrarText caseRecord={caseRecord} booking={{ procedure: 'T12-L2 posterior fixation', kit: 'Diplomat (Consignment)' }} />)
    expect(screen.getByLabelText('L1 Left')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('T12 Left'), { target: { value: '6.5 x 45mm' } })
    const text = document.querySelector('pre').textContent
    expect(text).toContain('Patient: Sample')
    expect(text).toContain('Consultant: Mr Fowler')
    expect(text).toContain('System: Signus Diplomat')
    expect(text).toContain('T12 Left: 6.5 x 45mm')
    expect(text).not.toContain('L1 Left')
    expect(text).not.toMatch(/R-150|LOT9/)
  })

  // Brent, 9 Nov 2026: screw sizes and sides for pedicle / lateral mass
  // fixation only, not for an ACDF or ALIF.
  it('asks for no screw levels on an ACDF, unless the rep adds them', () => {
    render(<RegistrarText caseRecord={caseRecord} booking={{ procedure: 'C5/6 ACDF, fixation + decompression', kit: 'CYLOX' }} />)
    expect(screen.queryByLabelText('C5 Left')).toBeNull()
    expect(screen.queryByPlaceholderText('e.g. T12-L2')).toBeNull()
    fireEvent.click(document.querySelector('[data-add-screw-levels]'))
    expect(screen.getByLabelText('C5 Left')).toBeInTheDocument()
  })
})
